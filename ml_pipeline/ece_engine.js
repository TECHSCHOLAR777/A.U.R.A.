'use strict';

/**
 * ==============================================================================
 *  A.U.R.A — ECE Engine: Multi-Model Risk Inference with Database Integration
 * ==============================================================================
 *
 * Connects the four trained LightGBM edge models from the Models-ECE Engine
 * folder to the aura_local.db SQLite database. Assembles per-child feature
 * vectors by querying live data and runs offline inference for:
 *
 *   1. Malnutrition Risk       (Low / Moderate / High)
 *   2. Dropout Risk            (binary: 0 / 1)
 *   3. Developmental Delay     (Low / Moderate / High)
 *   4. Social Participation    (Low / Moderate / High)
 *
 * Design principles:
 *   - All inference is offline — no network calls.
 *   - Model files are loaded once at module initialisation and cached.
 *   - Feature assembly mirrors the TASK_SPECS in the Training Scripts exactly.
 *   - Multiclass output uses softmax over summed leaf scores per class.
 *   - Binary output uses sigmoid over the summed single log-odds score.
 *   - Safe defaults (0.0) are used for any feature not available in the DB.
 *
 * ==============================================================================
 */

const fs   = require('fs');
const path = require('path');

// ── Model file paths ──────────────────────────────────────────────────────────
const MODELS_DIR = path.resolve(__dirname, '..', 'Models-ECE Engine');

const MODEL_PATHS = {
  malnutrition : path.join(MODELS_DIR, 'malnutrition_lgb_model.txt'),
  dropout      : path.join(MODELS_DIR, 'dropout_lgb_model.txt'),
  dev_delay    : path.join(MODELS_DIR, 'dev_delay_lgb_model.txt'),
  social       : path.join(MODELS_DIR, 'social_lgb_model.txt'),
};

// ── Label maps (match Training Scripts encode_target ORDER) ──────────────────
const LABEL_MAP_3CLASS = { 0: 'Low', 1: 'Moderate', 2: 'High' };
const LABEL_MAP_BINARY = { 0: 'No', 1: 'Yes' };

// ── Feature sets (mirror TASK_SPECS in Training Scripts exactly) ─────────────
const FEATURES = {
  malnutrition: [
    'zwei', 'zwfl', 'zbmi',
    'meal_completion_pct',
    'missed_meals_30d',
    'illness_frequency_90d',
    'vitamin_A_status',
    'deworming_status',
  ],
  dropout: [
    'attendance_last_30d',
    'attendance_percentage_month',
    'consecutive_absence_days',
    'missed_meals_30d',
    'illness_frequency_90d',
    'distance_to_anganwadi',
    'mother_education',
    'caregiver_engagement_score',
    'home_visit_received',
    'parent_meeting_attended',
    'age_months',
    'recent_illness',
  ],
  dev_delay: [
    'age_months',
    'fine_motor_score',
    'gross_motor_score',
    'problem_solving_score',
    'zwei', 'zwfl', 'zbmi',
    'meal_completion_pct',
    'missed_meals_30d',
    'vitamin_A_status',
    'deworming_status',
    'attendance_last_30d',
    'attendance_percentage_month',
    'consecutive_absence_days',
    'attention_span',
    'withdrawal_score',
    'separation_anxiety',
  ],
  social: [
    'participates_in_group',
    'speaks_to_peers',
    'initiates_play',
    'responds_to_teacher',
    'eye_contact',
    'withdrawal_score',
    'separation_anxiety',
    'tantrums',
    'attention_span',
  ],
};

// ── Model cache (loaded once) ─────────────────────────────────────────────────
const _modelCache = {};

// =============================================================================
//  SECTION 1: LightGBM Parser
//  (Supports both binary and multiclass native text format)
// =============================================================================

/**
 * Parses a LightGBM plain-text booster file.
 * Handles binary (single objective) and multiclass (num_class > 1) models.
 *
 * @param {string} modelText - Raw content of the .txt model file.
 * @returns {{ featureNames: string[], numClass: number, trees: Object[] }}
 */
function parseLightGBMModel(modelText) {
  const lines = modelText.split(/\r?\n/);
  let featureNames = [];
  let numClass     = 1;
  const trees      = [];
  let currentTree  = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('feature_names=')) {
      featureNames = trimmed.slice('feature_names='.length).split(/\s+/).filter(Boolean);
      continue;
    }

    if (trimmed.startsWith('num_class=')) {
      numClass = parseInt(trimmed.slice('num_class='.length), 10) || 1;
      continue;
    }

    if (trimmed.startsWith('Tree=')) {
      if (currentTree) trees.push(currentTree);
      currentTree = {
        id          : parseInt(trimmed.slice('Tree='.length), 10),
        num_leaves  : 0,
        split_feature: [],
        threshold   : [],
        left_child  : [],
        right_child : [],
        leaf_value  : [],
      };
      continue;
    }

    if (currentTree) {
      if (trimmed.startsWith('num_leaves=')) {
        currentTree.num_leaves = parseInt(trimmed.slice('num_leaves='.length), 10);
      } else if (trimmed.startsWith('split_feature=')) {
        currentTree.split_feature = trimmed.slice('split_feature='.length).split(/\s+/).map(Number);
      } else if (trimmed.startsWith('threshold=')) {
        currentTree.threshold = trimmed.slice('threshold='.length).split(/\s+/).map(Number);
      } else if (trimmed.startsWith('left_child=')) {
        currentTree.left_child = trimmed.slice('left_child='.length).split(/\s+/).map(Number);
      } else if (trimmed.startsWith('right_child=')) {
        currentTree.right_child = trimmed.slice('right_child='.length).split(/\s+/).map(Number);
      } else if (trimmed.startsWith('leaf_value=')) {
        currentTree.leaf_value = trimmed.slice('leaf_value='.length).split(/\s+/).map(Number);
      }
    }
  }

  if (currentTree) trees.push(currentTree);

  return { featureNames, numClass, trees };
}

/**
 * Traverses a single decision tree for one input feature vector.
 *
 * @param {Object} tree        - Parsed tree object.
 * @param {number[]} fVec      - Feature vector (ordered by featureNames index).
 * @returns {number}           - Leaf value for this tree.
 */
function traverseTree(tree, fVec) {
  let node = 0;
  while (node >= 0) {
    const featIdx = tree.split_feature[node];
    const val     = fVec[featIdx] !== undefined ? fVec[featIdx] : 0.0;
    node = val <= tree.threshold[node]
      ? tree.left_child[node]
      : tree.right_child[node];
  }
  return tree.leaf_value[~node];
}

/**
 * Runs inference on a parsed LightGBM model.
 * Returns raw class probabilities (softmax for multiclass, sigmoid for binary).
 *
 * @param {{ featureNames: string[], numClass: number, trees: Object[] }} model
 * @param {Object} featureObj - { featureName: value, ... }
 * @returns {number[]} Array of class probabilities (length = numClass).
 */
function runInference(model, featureObj) {
  const { featureNames, numClass, trees } = model;

  // Build ordered feature vector; default to 0.0 for missing features
  const fVec = featureNames.map(name => {
    const v = featureObj[name];
    return (v !== undefined && v !== null && !Number.isNaN(Number(v))) ? Number(v) : 0.0;
  });

  if (numClass === 1) {
    // Binary model: sum all tree leaf values → sigmoid
    let logOdds = 0.0;
    for (const tree of trees) logOdds += traverseTree(tree, fVec);
    const prob = 1 / (1 + Math.exp(-logOdds));
    return [1 - prob, prob]; // [P(class=0), P(class=1)]
  }

  // Multiclass model: LightGBM interleaves trees by class
  // trees[0..numClass-1] → iter 0 for each class
  // trees[numClass..2*numClass-1] → iter 1 for each class, etc.
  const rawScores = new Array(numClass).fill(0.0);
  for (let t = 0; t < trees.length; t++) {
    rawScores[t % numClass] += traverseTree(trees[t], fVec);
  }

  // Softmax
  const maxScore = Math.max(...rawScores);
  const exps     = rawScores.map(s => Math.exp(s - maxScore));
  const sumExps  = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sumExps);
}

// =============================================================================
//  SECTION 2: Model Loader (with cache)
// =============================================================================

/**
 * Loads and parses a model file, using an in-memory cache so the file is
 * only read once per process lifetime.
 *
 * @param {string} taskKey - One of: 'malnutrition' | 'dropout' | 'dev_delay' | 'social'
 * @returns {{ featureNames: string[], numClass: number, trees: Object[] }}
 */
function loadModel(taskKey) {
  if (_modelCache[taskKey]) return _modelCache[taskKey];

  const modelPath = MODEL_PATHS[taskKey];
  if (!fs.existsSync(modelPath)) {
    throw new Error(`[ECE Engine] Model file not found: ${modelPath}`);
  }

  const modelText  = fs.readFileSync(modelPath, 'utf8');
  const parsed     = parseLightGBMModel(modelText);
  _modelCache[taskKey] = parsed;

  console.log(
    `[ECE Engine] Loaded ${taskKey} model — ` +
    `${parsed.trees.length} trees, ${parsed.numClass} class(es), ` +
    `${parsed.featureNames.length} features`
  );

  return parsed;
}

// =============================================================================
//  SECTION 3: Feature Assembly from SQLite
// =============================================================================

/**
 * Converts a birthdate string to age in months at today's date.
 *
 * @param {string} dobStr - ISO date string e.g. '2020-04-12'
 * @returns {number}
 */
function ageInMonths(dobStr) {
  const dob  = new Date(dobStr);
  const now  = new Date();
  return (now.getFullYear() - dob.getFullYear()) * 12
       + (now.getMonth()    - dob.getMonth());
}

/**
 * Builds WHO Z-score proxies from growth_monitoring data.
 * Uses the stored z_score as zwfl; approximates zwei and zbmi.
 *
 * @param {Object|null} latestGrowth - Most recent growth record from DB.
 * @returns {{ zwei: number, zwfl: number, zbmi: number }}
 */
function buildZScores(latestGrowth) {
  if (!latestGrowth) return { zwei: 0.0, zwfl: 0.0, zbmi: 0.0 };
  const zwfl = latestGrowth.z_score   || 0.0;
  // Approximate: zwei (weight-for-age) is typically ~0.3 better than wasting
  const zwei = zwfl + 0.3;
  // zbmi mirrors zwfl closely for under-5 children
  const zbmi = zwfl - 0.1;
  return { zwei, zwfl, zbmi };
}

/**
 * Queries SQLite to build a complete feature object for a single child,
 * covering all four task feature sets.
 *
 * Features that have no corresponding DB column (e.g. fine_motor_score,
 * social scores) default to 0.0. These would be populated by future
 * voice-log or observation modules.
 *
 * @param {Object} db         - better-sqlite3 database instance.
 * @param {string} beneficiaryId
 * @returns {Object}          - Flat feature map { featureName: number }
 */
function assembleFeatures(db, beneficiaryId) {
  // ── 1. Beneficiary baseline ─────────────────────────────────────────────
  const child = db.prepare(`
    SELECT dob, gender, migrant_flag, missed_vaccine_streak
    FROM beneficiary_directory
    WHERE beneficiary_id = ?
  `).get(beneficiaryId);

  if (!child) throw new Error(`[ECE Engine] Beneficiary ${beneficiaryId} not found.`);

  const ageMos = ageInMonths(child.dob);

  // ── 2. Latest growth record ─────────────────────────────────────────────
  const latestGrowth = db.prepare(`
    SELECT weight_kg, height_cm, z_score, sam_mam_status
    FROM growth_monitoring
    WHERE beneficiary_id = ?
    ORDER BY date DESC LIMIT 1
  `).get(beneficiaryId);

  const { zwei, zwfl, zbmi } = buildZScores(latestGrowth);

  // ── 3. Attendance metrics (last 30 days) ────────────────────────────────
  const last30 = db.prepare(`
    SELECT attendance, morning_snacks, hot_cooked_meal
    FROM daily_tracking
    WHERE beneficiary_id = ?
    ORDER BY record_date DESC LIMIT 30
  `).all(beneficiaryId);

  const attendanceLast30d        = last30.filter(r => r.attendance === 1).length;
  const attendancePctMonth       = last30.length > 0
    ? attendanceLast30d / last30.length
    : 0.0;

  // Consecutive absence days (count from the most recent backward)
  let consecutiveAbsenceDays = 0;
  for (const row of last30) {
    if (row.attendance === 0) consecutiveAbsenceDays++;
    else break;
  }

  // Missed meals = days present but hot_cooked_meal = 0, over last 30 days
  const missedMeals30d = last30.filter(
    r => r.attendance === 1 && r.hot_cooked_meal === 0
  ).length;

  // Meal completion pct = (days fed / days present) over last 30 days
  const presentDays      = attendanceLast30d;
  const mealCompletionPct = presentDays > 0
    ? last30.filter(r => r.attendance === 1 && r.hot_cooked_meal === 1).length / presentDays
    : 0.0;

  // ── 4. Health & vaccine records ─────────────────────────────────────────
  const vaccines = db.prepare(`
    SELECT vitamin_a_dose, deworming_pill
    FROM health_and_vaccines
    WHERE beneficiary_id = ?
    ORDER BY date DESC LIMIT 1
  `).get(beneficiaryId);

  const vitaminAStatus  = vaccines ? (vaccines.vitamin_a_dose  || 0) : 0;
  const dewormingStatus = vaccines ? (vaccines.deworming_pill   || 0) : 0;

  // Illness frequency: proxy via missed_vaccine_streak (available from DB)
  const illnessFrequency90d = child.missed_vaccine_streak || 0;
  const recentIllness       = illnessFrequency90d > 0 ? 1 : 0;

  // ── 5. Home visit record ─────────────────────────────────────────────────
  const homeVisit = db.prepare(`
    SELECT COUNT(*) AS cnt FROM home_visits_and_referrals
    WHERE beneficiary_id = ?
  `).get(beneficiaryId);
  const homeVisitReceived = homeVisit && homeVisit.cnt > 0 ? 1 : 0;

  // ── 6. Assemble full feature object ─────────────────────────────────────
  // Fields with no current DB source default to 0.0.
  // These slots are intentionally left open for future ECE observation inputs.
  return {
    // Anthropometric
    zwei,
    zwfl,
    zbmi,

    // Nutrition
    meal_completion_pct   : parseFloat(mealCompletionPct.toFixed(4)),
    missed_meals_30d      : missedMeals30d,

    // Health
    illness_frequency_90d : illnessFrequency90d,
    vitamin_A_status      : vitaminAStatus,
    deworming_status      : dewormingStatus,
    recent_illness        : recentIllness,

    // Attendance
    attendance_last_30d         : attendanceLast30d,
    attendance_percentage_month : parseFloat(attendancePctMonth.toFixed(4)),
    consecutive_absence_days    : consecutiveAbsenceDays,

    // Child demographics
    age_months : ageMos,

    // Home & family (defaults — no current DB source)
    distance_to_anganwadi   : 0.0,
    mother_education        : 0.0,  // encoded ordinal; 0 = unknown
    caregiver_engagement_score: 0.0,
    home_visit_received     : homeVisitReceived,
    parent_meeting_attended : 0.0,

    // ECE behavioural observation scores (defaults — collected via future voice log)
    fine_motor_score        : 0.0,
    gross_motor_score       : 0.0,
    problem_solving_score   : 0.0,
    attention_span          : 0.0,
    withdrawal_score        : 0.0,
    separation_anxiety      : 0.0,

    // Social participation scores (defaults — collected via ECE observation)
    participates_in_group   : 0.0,
    speaks_to_peers         : 0.0,
    initiates_play          : 0.0,
    responds_to_teacher     : 0.0,
    eye_contact             : 0.0,
    tantrums                : 0.0,
  };
}

// =============================================================================
//  SECTION 4: Per-Task Inference Helpers
// =============================================================================

/**
 * Runs a single task model and returns a structured result.
 *
 * @param {string} taskKey     - Task identifier.
 * @param {Object} featureObj  - Assembled feature map.
 * @param {Object} labelMap    - { 0: 'label', ... }
 * @returns {{ label: string, probabilities: Object, confidence: number }}
 */
function runTask(taskKey, featureObj, labelMap) {
  const model  = loadModel(taskKey);
  const probs  = runInference(model, featureObj);
  const predIdx = probs.indexOf(Math.max(...probs));
  const label   = labelMap[predIdx] || String(predIdx);

  const probsLabelled = {};
  for (let i = 0; i < probs.length; i++) {
    probsLabelled[labelMap[i] || String(i)] = parseFloat(probs[i].toFixed(4));
  }

  return {
    label,
    probabilities: probsLabelled,
    confidence: parseFloat(probs[predIdx].toFixed(4)),
  };
}

// =============================================================================
//  SECTION 5: Public API
// =============================================================================

/**
 * Runs all four ECE models for a single child and returns a consolidated
 * risk profile sourced entirely from live database data.
 *
 * @param {Object} db             - better-sqlite3 database instance.
 * @param {string} beneficiaryId  - e.g. 'JH-003'
 * @returns {Object} Structured risk profile for the child.
 */
function runECERiskProfile(db, beneficiaryId) {
  const features = assembleFeatures(db, beneficiaryId);

  const malnutrition = runTask('malnutrition', features, LABEL_MAP_3CLASS);
  const dropout      = runTask('dropout',      features, LABEL_MAP_BINARY);
  const devDelay     = runTask('dev_delay',    features, LABEL_MAP_3CLASS);
  const social       = runTask('social',       features, LABEL_MAP_3CLASS);

  // Derive an overall alert level
  const highRiskFlags = [
    malnutrition.label === 'High',
    dropout.label      === 'Yes',
    devDelay.label     === 'High',
    social.label       === 'High',
  ].filter(Boolean).length;

  const overallAlert = highRiskFlags >= 2 ? 'critical'
    : highRiskFlags === 1               ? 'warning'
    : 'stable';

  return {
    beneficiary_id : beneficiaryId,
    overall_alert  : overallAlert,
    features_used  : features,
    predictions    : {
      malnutrition_risk     : malnutrition,
      dropout_risk          : dropout,
      developmental_delay   : devDelay,
      social_participation  : social,
    },
  };
}

/**
 * Runs ECE risk profiling for all active child beneficiaries in the database.
 * Errors for individual children are caught and reported without halting others.
 *
 * @param {Object} db - better-sqlite3 database instance.
 * @returns {Object[]} Array of risk profiles, one per child.
 */
function runECEBatchRiskProfiles(db) {
  const children = db.prepare(`
    SELECT beneficiary_id, child_name
    FROM beneficiary_directory
    WHERE type = 'child'
    ORDER BY child_name ASC
  `).all();

  const results = [];

  for (const child of children) {
    try {
      const profile = runECERiskProfile(db, child.beneficiary_id);
      results.push({ ...profile, child_name: child.child_name });
    } catch (err) {
      results.push({
        beneficiary_id : child.beneficiary_id,
        child_name     : child.child_name,
        error          : err.message,
        overall_alert  : 'unknown',
      });
    }
  }

  return results;
}

// =============================================================================
//  SECTION 6: Preload models at module load time
//  (avoids cold-start latency on first API call)
// =============================================================================
(function preloadModels() {
  for (const taskKey of Object.keys(MODEL_PATHS)) {
    try {
      loadModel(taskKey);
    } catch (err) {
      console.warn(`[ECE Engine] Could not preload model "${taskKey}": ${err.message}`);
    }
  }
})();

// =============================================================================
//  Exports
// =============================================================================
module.exports = {
  runECERiskProfile,
  runECEBatchRiskProfiles,
  assembleFeatures,
  loadModel,
  runInference,
};

/**
 * server.js
 * Node.js Express server for the AURA PWA.
 *
 * Exposes three REST endpoints:
 *   POST /api/mastery/tap
 *   GET  /api/mastery/aggregate/:node_id
 *   POST /api/activity/next
 *
 * Architecture note:
 *   bkt_engine.js uses IndexedDB (a browser API) for persistence.  On the
 *   server side we replicate the BKT logic using an in-memory Map for state,
 *   importing the pure algorithmic functions (updateBKT, computeTrajectoryFlag)
 *   from bkt_engine.js as named exports.  GuardrailEngine is a pure synchronous
 *   module with no browser dependencies and is imported directly.
 *
 * Satisfies Req 7.5, 7.6, 7.7, 7.8, 8.1–8.5
 */

import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { updateBKT, computeTrajectoryFlag } from './bkt_engine.js';
import { GuardrailEngine } from './guardrail_engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/** Default BKT parameters (mirrors bkt_engine.js constants). */
const DEFAULT_BKT_PARAMS = Object.freeze({
  p_l0: 0.15,
  p_t:  0.20,
  p_g:  0.20,
  p_s:  0.10,
});

/** A child with p_mastery >= MASTERY_THRESHOLD is considered to have mastered the node. */
const MASTERY_THRESHOLD = 0.80;

/** Maximum length of the rolling p_history window. */
const HISTORY_WINDOW = 5;

/** Standard age bands in months. Lower-bound inclusive, upper-bound exclusive (except last). */
const AGE_BANDS = ['0-12', '12-24', '24-36', '36-48', '48-60', '60-72'];

// ─────────────────────────────────────────────────────────────────────────────
// In-memory mastery state (server-side substitute for IndexedDB)
// Key: "child_id|node_id" → MasteryRecord
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
const masteryStore = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Activity bank — loaded once at startup
// ─────────────────────────────────────────────────────────────────────────────

let activityBank = [];

try {
  const bankPath = join(__dirname, 'data', 'activity_bank.json');
  const raw = readFileSync(bankPath, 'utf8');
  activityBank = JSON.parse(raw);
  console.log(`[server] Loaded ${activityBank.length} activities from activity_bank.json`);
} catch (err) {
  console.error('[server] Failed to load activity_bank.json:', err.message);
  // Continue with an empty bank — static fallback will handle all requests
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.6 — cacheKey (djb2 hash)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * cacheKey — Produce a deterministic cache key for a (activity_id, node_id, age_band) triple.
 *
 * Uses the djb2 hashing algorithm over the concatenated string.
 * No random or time-based input; identical inputs always produce the same key.
 *
 * @param {string} activity_id
 * @param {string} node_id
 * @param {string} age_band  — e.g. "36-48"
 * @returns {string}  — unsigned 32-bit integer expressed as a hex string
 *
 * Satisfies Req 7.4
 */
function cacheKey(activity_id, node_id, age_band) {
  const str = activity_id + '|' + node_id + '|' + age_band;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(16); // unsigned hex
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side BKT helpers (in-memory, no IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * serverTapMastery — Server-side equivalent of BKTEngine.tapMastery.
 *
 * Uses the pure updateBKT and computeTrajectoryFlag functions from bkt_engine.js
 * but persists state to an in-memory Map instead of IndexedDB.
 *
 * @param {string}  child_id
 * @param {string}  node_id
 * @param {boolean} got_it
 * @returns {{ p_mastery: number, trajectory_flag: string }}
 */
function serverTapMastery(child_id, node_id, got_it) {
  const key = `${child_id}|${node_id}`;
  const existing = masteryStore.get(key);

  let prior;
  let observation_count;
  let p_history;

  if (!existing) {
    // Cold start — initialise from P_L0 (Req 1.1)
    prior             = DEFAULT_BKT_PARAMS.p_l0;
    observation_count = 0;
    p_history         = [];
  } else {
    prior             = existing.p_mastery;
    observation_count = existing.observation_count || 0;
    p_history         = Array.isArray(existing.p_history) ? existing.p_history : [];
  }

  // Compute updated p_mastery using the pure BKT function (Req 1.2, 1.3, 1.4)
  const new_p_mastery = updateBKT(prior, got_it, DEFAULT_BKT_PARAMS);

  // Derive trajectory flag (Req 2.1–2.5)
  const trajectory_flag = computeTrajectoryFlag(p_history, new_p_mastery);

  // Update rolling p_history window
  const updated_p_history = [...p_history, new_p_mastery].slice(-HISTORY_WINDOW);

  // Build and store the updated record
  const record = {
    child_node_key:    key,
    child_id,
    node_id,
    p_mastery:         new_p_mastery,
    last_updated:      new Date().toISOString(),
    trajectory_flag,
    observation_count: observation_count + 1,
    p_history:         updated_p_history,
  };

  masteryStore.set(key, record);

  return { p_mastery: new_p_mastery, trajectory_flag };
}

/**
 * serverGetRoomAggregate — Server-side equivalent of BKTEngine.getRoomAggregate.
 *
 * @param {string} node_id
 * @returns {{ node_id: string, mastered_count: number, total_count: number, avg_p_mastery: number }}
 */
function serverGetRoomAggregate(node_id) {
  const records = [];
  for (const record of masteryStore.values()) {
    if (record.node_id === node_id) {
      records.push(record);
    }
  }

  const total_count = records.length;

  if (total_count === 0) {
    return { node_id, mastered_count: 0, total_count: 0, avg_p_mastery: 0 };
  }

  let mastered_count = 0;
  let sum = 0;
  for (const record of records) {
    sum += record.p_mastery;
    if (record.p_mastery >= MASTERY_THRESHOLD) {
      mastered_count++;
    }
  }

  return {
    node_id,
    mastered_count,
    total_count,
    avg_p_mastery: sum / total_count,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity selection helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * selectCandidates — Filter the activity bank by node_id and optionally age_band.
 *
 * Filters by matching `aadharshila_ref` to `node_id`.  If no activities match
 * the node, the full bank is returned as fallback candidates.  When
 * `age_band_months` is provided, activities with differentiation entries for
 * that band are preferred (ranked first), but all matching activities are
 * returned so the reject loop can try them all.
 *
 * @param {object[]} bank             — Full activity bank array
 * @param {string}   node_id          — Curriculum node identifier
 * @param {string}   [age_band_months] — Optional age band string (e.g. "36-48")
 * @returns {object[]}  — Ordered array of activity candidates
 */
function selectCandidates(bank, node_id, age_band_months) {
  if (!Array.isArray(bank) || bank.length === 0) return [];

  // Prefer activities whose aadharshila_ref matches node_id
  let matched = bank.filter(a => a.aadharshila_ref === node_id);
  if (matched.length === 0) {
    matched = [...bank]; // fall back to all activities
  }

  if (age_band_months) {
    // Map "36-48" band string to differentiation key format "3-4"
    const diffKey = ageBandToDiffKey(age_band_months);

    // Sort: activities with a matching differentiation key come first
    matched.sort((a, b) => {
      const aHas = a.differentiation && diffKey && a.differentiation[diffKey] ? 1 : 0;
      const bHas = b.differentiation && diffKey && b.differentiation[diffKey] ? 1 : 0;
      return bHas - aHas;
    });
  }

  return matched;
}

/**
 * ageBandToDiffKey — Convert a month-based age band string to a year-based
 * differentiation key used in activity_bank.json.
 *
 * e.g. "36-48" → "3-4",  "24-36" → "2-3",  "48-60" → "4-5"
 *
 * @param {string} band — e.g. "36-48"
 * @returns {string|null}
 */
function ageBandToDiffKey(band) {
  if (typeof band !== 'string') return null;
  const parts = band.split('-');
  if (parts.length !== 2) return null;
  const lo = parseInt(parts[0], 10);
  const hi = parseInt(parts[1], 10);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return `${Math.floor(lo / 12)}-${Math.floor(hi / 12)}`;
}

/**
 * selectSafeSubstitute — Pick a substitute activity that has no exclusion_tags
 * and no choking_hazard, preferring a different domain than the candidate.
 *
 * @param {object[]} bank    — Full activity bank
 * @param {string}   node_id — Curriculum node (used to prefer matching activities)
 * @param {string}   [excludeId] — Activity id to exclude (the one being substituted)
 * @returns {object|null}
 */
function selectSafeSubstitute(bank, node_id, excludeId) {
  const safe = bank.filter(a =>
    a.id !== excludeId &&
    a.choking_hazard === false &&
    (!Array.isArray(a.exclusion_tags) || a.exclusion_tags.length === 0)
  );
  // Return the first safe activity, or the first activity if none qualify
  return safe.length > 0 ? safe[0] : (bank.length > 0 ? bank[0] : null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.4 — buildC1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deriveBand — Derive the standard age band from an array of child profiles.
 *
 * Computes the average age_months across all profiles and returns the
 * standard band string (e.g. "36-48") that the average falls into.
 * Falls back to "36-48" when no profiles are provided.
 *
 * Standard bands: 0-12, 12-24, 24-36, 36-48, 48-60, 60-72
 * (upper bound inclusive for last band; otherwise lower-inclusive, upper-exclusive)
 *
 * @param {object[]} childProfiles — Array of ChildProfile objects
 * @returns {string}  — Age band string
 */
function deriveBand(childProfiles) {
  if (!Array.isArray(childProfiles) || childProfiles.length === 0) {
    return '36-48'; // default per spec
  }

  const ages = childProfiles
    .map(p => (typeof p.age_months === 'number' ? p.age_months : null))
    .filter(a => a !== null);

  if (ages.length === 0) return '36-48';

  const avg = ages.reduce((s, a) => s + a, 0) / ages.length;

  // Find the standard band that covers the average age
  const boundaries = [0, 12, 24, 36, 48, 60, 72];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const lo = boundaries[i];
    const hi = boundaries[i + 1];
    if (avg >= lo && avg < hi) {
      return `${lo}-${hi}`;
    }
  }
  // avg >= 72: use last band
  return '60-72';
}

/**
 * buildInclusionModifications — Look up inclusion adaptations for INC_-prefixed rules.
 *
 * For each INC_ rule_id in rules_fired, maps it to a candidate.inclusion_adaptations key
 * and returns a InclusionModifications object.
 *
 * @param {string[]} rules_fired           — Array of rule_id strings
 * @param {object}   candidate             — ActivityCandidate
 * @returns {object}  — InclusionModifications or empty object
 */
function buildInclusionModifications(rules_fired, candidate) {
  if (!Array.isArray(rules_fired) || rules_fired.length === 0) return {};

  // Map rule IDs to adaptation keys in candidate.inclusion_adaptations
  const ruleToAdaptationKey = {
    'INC_ATTUNE_01': ['stutter', 'non_verbal'],
    'INC_ATTUNE_02': ['stutter', 'non_verbal'],
    'INC_MOTOR_01':  ['motor_delay'],
    'INC_MOTOR_02':  ['motor_delay'],
    'INC_VISUAL_01': ['visual_impaired'],
    'INC_SHY_01':    ['shy'],
    'INC_LANG_01':   ['language'],
  };

  const adaptations = candidate.inclusion_adaptations || {};
  let instruction_override = '';
  let vast_parameter = 'V'; // default VAST axis

  for (const rule_id of rules_fired) {
    if (!rule_id.startsWith('INC_')) continue;

    const keys = ruleToAdaptationKey[rule_id] || [];
    for (const k of keys) {
      if (adaptations[k]) {
        instruction_override = adaptations[k];
        // Map rule to VAST axis
        if (rule_id === 'INC_ATTUNE_01' || rule_id === 'INC_ATTUNE_02') vast_parameter = 'A';
        else if (rule_id === 'INC_MOTOR_01' || rule_id === 'INC_MOTOR_02') vast_parameter = 'S';
        else if (rule_id === 'INC_VISUAL_01') vast_parameter = 'V';
        else if (rule_id === 'INC_SHY_01') vast_parameter = 'T';
        else if (rule_id === 'INC_LANG_01') vast_parameter = 'A';
        break;
      }
    }
    if (instruction_override) break; // use the first adaptation found
  }

  return { vast_parameter, instruction_override };
}

/**
 * buildC1 — Assemble a C1ActivityObject from a passing candidate and its validation result.
 *
 * @param {object}   candidate         — ActivityCandidate from the activity bank
 * @param {object}   validationResult  — ValidationResult from GuardrailEngine.validate
 * @param {object[]} childProfiles     — Array of ChildProfile objects
 * @param {string}   nodeId            — Curriculum node id
 * @param {boolean}  offline           — Whether this is generated offline
 * @returns {object}  — C1ActivityObject
 *
 * Satisfies Req 7.1, 7.2, 7.3, 7.8
 */
function buildC1(candidate, validationResult, childProfiles, nodeId, offline) {
  const age_band = deriveBand(childProfiles);
  const diffKey  = ageBandToDiffKey(age_band);
  const diffText = (diffKey && candidate.differentiation && candidate.differentiation[diffKey])
    ? candidate.differentiation[diffKey]
    : `Perform the activity "${(candidate.keywords || ['activity'])[0]}" appropriate for the age group.`;

  // Split differentiation text into step-by-step instructions
  const step_by_step_instructions = diffText
    .split('. ')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Build inclusion_modifications from INC_-prefixed fired rules (Req 7.1)
  const inclusion_modifications = buildInclusionModifications(
    validationResult.rules_fired,
    candidate
  );

  // safety_guard_applied = true iff rules_fired is non-empty (Req 7.2, 7.3)
  const safety_guard_applied = Array.isArray(validationResult.rules_fired) &&
                               validationResult.rules_fired.length > 0;

  // activity_id uses candidate.id + "_" + nodeId + "_" + timestamp
  const activity_id = `${candidate.id}_${nodeId}_${Date.now()}`;

  // source is always "activity_bank" when serving from the bank
  const source = 'activity_bank';

  // adapted_title: first keyword + domain
  const adapted_title = `${(candidate.keywords || ['activity'])[0]} — ${candidate.targeted_domain || 'general'}`;

  return {
    activity_id,
    source,
    targeted_domain:             candidate.targeted_domain || '',
    age_band_months:             age_band,
    milestone_targeted:          nodeId,
    adapted_title,
    step_by_step_instructions,
    required_materials:          candidate.materials || [],
    safety_guard_applied,
    inclusion_modifications,
    provenance: {
      generated_offline: offline === true,
      rules_fired:       validationResult.rules_fired || [],
      cache_key:         cacheKey(candidate.id, nodeId, age_band),
      fallback_tier:     'none', // primary
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.5 — Static fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildStaticFallback — Return a hardcoded safe C1 object when all candidates
 * are exhausted without a passing result.
 *
 * provenance.fallback_tier = 2, source = "safe_default"
 *
 * @param {string}   nodeId        — Curriculum node
 * @param {object[]} childProfiles — Child profiles (for age_band derivation)
 * @returns {object}  — C1ActivityObject
 *
 * Satisfies Req 7.7
 */
function buildStaticFallback(nodeId, childProfiles) {
  const age_band = deriveBand(childProfiles);

  return {
    activity_id:   `SAFE_FALLBACK_${nodeId}_${Date.now()}`,
    source:        'safe_default',
    targeted_domain:             'socio_emotional',
    age_band_months:             age_band,
    milestone_targeted:          nodeId,
    adapted_title:               'Free Play — socio_emotional',
    step_by_step_instructions: [
      'Allow children to engage in free, child-led play.',
      'Observe and take notes on interactions.',
      'Ensure the environment is safe and supervised.',
    ],
    required_materials:          [],
    safety_guard_applied:        false,
    inclusion_modifications:     { vast_parameter: 'V', instruction_override: '' },
    provenance: {
      generated_offline: false,
      rules_fired:       [],
      cache_key:         cacheKey('SAFE_FALLBACK', nodeId, age_band),
      fallback_tier:     'safe_default',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Express app setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.1 — POST /api/mastery/tap
// Satisfies Req 8.1, 8.4
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/mastery/tap', (req, res) => {
  const { child_id, node_id, got_it } = req.body || {};

  // Input validation (Req 8.4)
  if (typeof child_id !== 'string' || child_id.trim() === '') {
    return res.status(400).json({
      error: 'Invalid input: child_id must be a non-empty string.',
    });
  }
  if (typeof node_id !== 'string' || node_id.trim() === '') {
    return res.status(400).json({
      error: 'Invalid input: node_id must be a non-empty string.',
    });
  }
  if (typeof got_it !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid input: got_it must be a boolean (true or false).',
    });
  }

  try {
    const result = serverTapMastery(child_id.trim(), node_id.trim(), got_it);
    return res.status(200).json(result); // { p_mastery, trajectory_flag }
  } catch (err) {
    console.error('[/api/mastery/tap] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.2 — GET /api/mastery/aggregate/:node_id
// Satisfies Req 8.2
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/mastery/aggregate/:node_id', (req, res) => {
  const { node_id } = req.params;

  try {
    const aggregate = serverGetRoomAggregate(node_id);
    return res.status(200).json(aggregate);
  } catch (err) {
    console.error('[/api/mastery/aggregate] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 5.3 — POST /api/activity/next
// Satisfies Req 7.5, 7.6, 8.3, 8.5
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/activity/next', (req, res) => {
  const { child_profiles, node_id, age_band_months } = req.body || {};

  // Input validation (Req 8.5)
  if (!Array.isArray(child_profiles) || child_profiles.length === 0) {
    return res.status(400).json({
      error: 'Invalid input: child_profiles must be a non-empty array.',
    });
  }
  if (typeof node_id !== 'string' || node_id.trim() === '') {
    return res.status(400).json({
      error: 'Invalid input: node_id must be a non-empty string.',
    });
  }

  try {
    const cleanNodeId = node_id.trim();

    // Select candidate activities from the bank
    const candidates = selectCandidates(activityBank, cleanNodeId, age_band_months);

    // Reject/substitute loop (per design pseudocode)
    for (const candidate of candidates) {
      const result = GuardrailEngine.validate(candidate, child_profiles);

      if (result.action === null || result.action === 'flag_modify') {
        // Passed — assemble and return C1
        const c1 = buildC1(candidate, result, child_profiles, cleanNodeId, false);
        return res.status(200).json(c1);

      } else if (result.action === 'block_and_substitute') {
        // Substitute with a safe activity
        const substitute = selectSafeSubstitute(activityBank, cleanNodeId, candidate.id);
        if (substitute) {
          const result2 = GuardrailEngine.validate(substitute, child_profiles);
          const c1 = buildC1(substitute, result2, child_profiles, cleanNodeId, false);
          return res.status(200).json(c1);
        }
        // No substitute found — continue to next candidate
      }
      // reject_regenerate: try next candidate
    }

    // Sub-task 5.5 — All candidates exhausted: return static fallback (Req 7.7)
    const fallback = buildStaticFallback(cleanNodeId, child_profiles);
    return res.status(200).json(fallback);

  } catch (err) {
    console.error('[/api/activity/next] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] AURA server listening on port ${PORT}`);
});

export default app;

// Named exports for unit testing
export {
  cacheKey,
  buildC1,
  buildStaticFallback,
  deriveBand,
  selectCandidates,
  serverTapMastery,
  serverGetRoomAggregate,
  buildInclusionModifications,
};

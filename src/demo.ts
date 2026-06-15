import { evaluate } from './core/guardrail/engine.js';
import { loadRules } from './core/guardrail/rule-loader.js';
import { updateMastery } from './core/bkt/engine.js';
import { createInitialMasteryState } from './core/bkt/state.js';
import { DEFAULT_BKT_PARAMS } from './core/bkt/priors.js';
import { evaluateDSS } from './core/dss/screener.js';
import { STUB_THRESHOLDS } from './core/dss/thresholds.js';
import { STUB_ITEMS } from './core/dss/items.js';
import { computeZScore } from './core/health/zscore.js';
import { detectAnomaly } from './core/health/anomaly.js';
import type { C1Activity } from './core/schema/index.js';

async function runDemo() {
  console.log('======================================================');
  console.log(' AURA DEV 3 INTELLIGENCE LAYER - LIVE DEMONSTRATION');
  console.log('======================================================\n');

  // ────────────────────────────────────────────────────────────────────────
  console.log('--- 1. GUARDRAIL ENGINE ---');
  const rules = loadRules();
  console.log(`[+] Loaded ${rules.length} safety & inclusion rules.\n`);

  const activity: C1Activity = {
    schema_version: '1.0',
    activity_id: 'ACT_001',
    source: 'cloud_llm',
    targeted_domain: 'motor',
    age_band_months: '0-3',
    milestone_targeted: 'tummy_time',
    adapted_title: 'Sensory Pebble Play',
    step_by_step_instructions: ['Place pebbles in front of baby', 'Watch them explore'],
    required_materials: ['pebbles', 'blanket'], // 'pebbles' is a choking hazard!
    safety_guard_applied: false,
    inclusion_modifications: {
      vast_parameter: 'none',
      instruction_override: ''
    },
    provenance: {
      generated_offline: false,
      rules_fired: [],
      cache_key: 'none',
      fallback_tier: 'none'
    }
  };

  const room = {
    age_mix: [{ band: '0-3' as const, count: 2 }],
    materials: [],
    inclusion_flags: []
  };

  console.log('Evaluating Activity:', activity.adapted_title);
  console.log('Materials:', activity.required_materials.join(', '));
  const guardrailResult = evaluate(activity, room, rules);
  
  if (!guardrailResult.passed) {
    console.log('\n❌ Guardrail Failed! Action:', guardrailResult.action);
    console.log('Rules Fired:');
    guardrailResult.rules_fired.forEach(r => {
      console.log(`  - [${r.rule_id}] (${r.severity.toUpperCase()}): ${r.message}`);
    });
  } else {
    console.log('\n✅ Guardrail Passed!');
  }


  // ────────────────────────────────────────────────────────────────────────
  console.log('\n\n--- 2. BKT KNOWLEDGE TRACING ---');
  let childMastery = createInitialMasteryState('child_123', 'motor_01', '0-3', 'motor', 0.20);
  console.log(`[+] Initial Mastery: ${(childMastery.p_mastery * 100).toFixed(1)}%`);

  console.log('Observation 1: Child succeeded at task...');
  childMastery = updateMastery(childMastery, 'success', DEFAULT_BKT_PARAMS);
  console.log(`[+] New Mastery: ${(childMastery.p_mastery * 100).toFixed(1)}%`);

  console.log('Observation 2: Child succeeded again...');
  childMastery = updateMastery(childMastery, 'success', DEFAULT_BKT_PARAMS);
  console.log(`[+] New Mastery: ${(childMastery.p_mastery * 100).toFixed(1)}%`);


  // ────────────────────────────────────────────────────────────────────────
  console.log('\n\n--- 3. DSS SCREENER ---');
  // Simulating a DSS response where a child is struggling with a motor task and a language task
  const dssResponses = [
    { item_id: 'DSS_MOTOR_001', score: 3, observed: true }, // High score means concern/delay
    { item_id: 'DSS_LANG_001', score: 3, observed: true }
  ];

  console.log('Worker submits DSS observations...');
  const dssResult = evaluateDSS(dssResponses, STUB_THRESHOLDS, STUB_ITEMS);
  
  console.log(`Verdict: ${dssResult.verdict.toUpperCase()}`);
  if (dssResult.refer_reason) {
    console.log(`Reason: ${dssResult.refer_reason}`);
  }


  // ────────────────────────────────────────────────────────────────────────
  console.log('\n\n--- 4. HEALTH METRICS (WHO LMS) ---');
  console.log('Calculating Z-score for a 2-month-old boy weighing 4.0 kg...');
  // At 2 months, median boy is 5.575kg. 4.0kg is quite low.
  const zScoreData = computeZScore('weight_for_age', 4.0, 2, 'male');
  console.log(`Z-Score: ${zScoreData.z_score} (${zScoreData.percentile}th percentile)`);
  console.log(`Classification: ${zScoreData.classification.toUpperCase()}`);

  console.log('\nChecking chronological growth trend...');
  const anomalyData = detectAnomaly([
    { date: '2025-01-01', z_score: -0.5 },
    { date: '2025-02-01', z_score: -1.0 },
    { date: '2025-03-01', z_score: -2.3 } // Big drop, crossing lines
  ]);
  
  if (anomalyData.has_anomaly) {
    console.log(`⚠️ Anomaly Detected: ${anomalyData.anomaly_type}`);
    console.log(`Recommendation: ${anomalyData.recommendation}`);
  }
  
  console.log('\n======================================================');
  console.log(' DEMONSTRATION COMPLETE');
  console.log('======================================================\n');
}

runDemo().catch(console.error);

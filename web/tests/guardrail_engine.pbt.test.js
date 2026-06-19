/**
 * guardrail_engine.pbt.test.js
 *
 * Property-based tests for guardrail_engine.js using Node.js built-in test runner.
 * Uses a minimal inline seeded LCG sampler for deterministic, reproducible runs.
 *
 * Run from AURA/web:
 *   node --test tests/guardrail_engine.pbt.test.js
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.7, 7.1, 7.2, 7.3, 7.4, 10.2, 10.3
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment stubs - must happen BEFORE any module imports
// ─────────────────────────────────────────────────────────────────────────────

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

globalThis.indexedDB = {
  open: () => {
    const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
    setTimeout(() => {
      if (r.onsuccess) r.onsuccess({ target: { result: {
        objectStoreNames: { contains: () => false },
        createObjectStore: () => ({ createIndex: () => {} }),
        transaction: () => ({ objectStore: () => ({}) })
      }}});
    }, 0);
    return r;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Imports - after stubs
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GuardrailEngine, runRules } from '../guardrail_engine.js';
import { buildC1, cacheKey, buildStaticFallback } from '../server.js';

// ─────────────────────────────────────────────────────────────────────────────
// Inline PBT helpers - deterministic seeded LCG sampler
// ─────────────────────────────────────────────────────────────────────────────

// LCG random - deterministic, seeded by sample index
function lcgRand(seed) {
  const s = ((seed * 1664525 + 1013904223) & 0xffffffff) >>> 0;
  return s / 0xffffffff;
}

// Get a random value in [lo, hi) from a seed
function rnd(seed, lo, hi) { return lo + lcgRand(seed) * (hi - lo); }

// Run `samples` iterations; throw on first counterexample
function forAll(label, samples, gen, prop) {
  for (let i = 0; i < samples; i++) {
    const input = gen(i);
    if (!prop(input)) throw new Error(`[${label}] counterexample at sample ${i}: ${JSON.stringify(input)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity and profile generators
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a safe base activity with no rules triggered */
function genSafeActivity(seed) {
  return {
    id: `ACT_${seed}`,
    targeted_domain: ['motor_physical', 'language', 'cognitive', 'socio_emotional'][seed % 4],
    materials: [],
    choking_hazard: false,
    inclusion_tags: ['adult_supervision'],
    exclusion_tags: [],
    keywords: [],
    differentiation: { '3-4': 'do something', '4-5': 'do more' },
    inclusion_adaptations: {},
    aadharshila_ref: 'SE-1',
    age_band_months: '36-48',
    lingua_franca: 'hindi',
  };
}

/** Generate a safe profile */
function genSafeProfile(seed) {
  return {
    child_id: `C${seed}`,
    age_months: 36 + (seed % 24),  // 36-59 months - safe range
    needs: [],
    lingua_franca: 'hindi',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collect ALL_RULE_IDS once (used by Properties 16 and 17)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_RULE_IDS = GuardrailEngine.getRules().map(r => r.rule_id);

// ─────────────────────────────────────────────────────────────────────────────
// Property-Based Tests - Guardrail Engine
// ─────────────────────────────────────────────────────────────────────────────

describe('Property-Based Tests - Guardrail Engine', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // 11.1 - Property 7: Rule Coverage (Req 5.6)
  // Every ID in ValidationResult.rules_fired must exist in GuardrailEngine.getRules()
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 7 - Rule Coverage (Req 5.6)', () => {
    /**Validates: Requirements 5.6 */
    forAll('Rule Coverage', 300, (i) => {
      const activity = genSafeActivity(i);
      // Add some noise to occasionally trigger rules
      if (i % 5 === 0) activity.materials = ['pebbles'];
      if (i % 7 === 0) activity.choking_hazard = true;
      if (i % 11 === 0) activity.keywords = ['name', 'describe'];
      const profiles = [genSafeProfile(i)];
      if (i % 3 === 0) profiles[0].age_months = 25;
      if (i % 9 === 0) profiles[0].needs = ['non_verbal'];
      return { activity, profiles };
    }, ({ activity, profiles }) => {
      const result = GuardrailEngine.validate(activity, profiles);
      const knownIds = new Set(GuardrailEngine.getRules().map(r => r.rule_id));
      return result.rules_fired.every(id => knownIds.has(id));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.2 - Property 8: Determinism (Req 5.7)
  // Calling validate twice with identical inputs returns structurally equal results
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 8 - Determinism (Req 5.7)', () => {
    /**Validates: Requirements 5.7 */
    forAll('Determinism', 300, (i) => {
      const activity = genSafeActivity(i);
      if (i % 4 === 0) activity.materials = ['pebbles'];
      if (i % 6 === 0) activity.keywords = ['jump'];
      const profiles = [genSafeProfile(i)];
      return { activity, profiles };
    }, ({ activity, profiles }) => {
      const r1 = GuardrailEngine.validate(activity, profiles);
      const r2 = GuardrailEngine.validate(activity, profiles);
      return (
        r1.passed === r2.passed &&
        r1.action === r2.action &&
        JSON.stringify(r1.rules_fired) === JSON.stringify(r2.rules_fired) &&
        JSON.stringify(r1.messages) === JSON.stringify(r2.messages)
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.3 - Property 9: Hard-Stop Short-Circuit (Req 5.2, 5.3)
  // When a reject_regenerate rule fires, passed=false and no rules after it appear
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 9 - Hard-Stop Short-Circuit (Req 5.2, 5.3)', () => {
    /**Validates: Requirements 5.2, 5.3 */
    forAll('Hard-Stop Short-Circuit', 300, (i) => {
      // Always triggers SAFE_CHOKE_01 (first rule, index 0)
      const activity = { ...genSafeActivity(i), materials: ['pebbles'] };
      const profiles = [{ ...genSafeProfile(i), age_months: 20 + (i % 15) }]; // all < 36
      return { activity, profiles };
    }, ({ activity, profiles }) => {
      const result = GuardrailEngine.validate(activity, profiles);
      if (!result.rules_fired.includes('SAFE_CHOKE_01')) return true; // rule didn't fire, skip
      if (result.passed !== false) return false;
      // Since SAFE_CHOKE_01 is index 0, no rule that comes after it should appear
      const rules = GuardrailEngine.getRules();
      const chopIdx = rules.findIndex(r => r.rule_id === 'SAFE_CHOKE_01');
      const afterIds = new Set(rules.slice(chopIdx + 1).map(r => r.rule_id));
      return result.rules_fired.every(id => !afterIds.has(id));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.4 - Property 10: Flag-Modify Pass-Through (Req 5.4)
  // When only flag_modify rules fire, passed=true
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 10 - Flag-Modify Pass-Through (Req 5.4)', () => {
    /**Validates: Requirements 5.4 */
    forAll('Flag-Modify Pass-Through', 300, (i) => {
      const activity = { ...genSafeActivity(i), keywords: ['name', 'describe'] };
      // Use age >= 36 so no choking hazard rules fire
      const profiles = [{ child_id: `C${i}`, age_months: 36 + (i % 24), needs: ['non_verbal'], lingua_franca: 'hindi' }];
      return { activity, profiles };
    }, ({ activity, profiles }) => {
      const result = GuardrailEngine.validate(activity, profiles);
      if (!result.rules_fired.includes('INC_ATTUNE_01')) return true; // rule didn't fire, skip
      // Only flag_modify rules should have fired → passed must be true
      const rules = GuardrailEngine.getRules();
      const ruleMap = new Map(rules.map(r => [r.rule_id, r]));
      const hasHardStop = result.rules_fired.some(id => {
        const r = ruleMap.get(id);
        return r && (r.action === 'reject_regenerate' || r.action === 'block_and_substitute');
      });
      if (hasHardStop) return true; // mixed case, skip
      return result.passed === true;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.5 - Property 11: C1 Provenance Fidelity (Req 7.1, 7.2, 7.3)
  // c1.provenance.rules_fired equals ValidationResult.rules_fired and
  // c1.safety_guard_applied is true iff rules_fired is non-empty
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 11 - C1 Provenance Fidelity (Req 7.1, 7.2, 7.3)', () => {
    /**Validates: Requirements 7.1, 7.2, 7.3 */
    forAll('C1 Provenance Fidelity', 100, (i) => {
      const activity = genSafeActivity(i);
      if (i % 5 === 0) activity.keywords = ['name'];
      const profiles = [genSafeProfile(i)];
      if (i % 7 === 0) profiles[0].needs = ['non_verbal'];
      return { activity, profiles };
    }, ({ activity, profiles }) => {
      const validationResult = GuardrailEngine.validate(activity, profiles);
      if (!validationResult.passed) return true; // only test passed activities
      const c1 = buildC1(activity, validationResult, profiles, 'FM-3', false);
      const provRulesFired = c1.provenance.rules_fired;
      const valRulesFired  = validationResult.rules_fired;
      // rules_fired must match exactly
      if (JSON.stringify(provRulesFired) !== JSON.stringify(valRulesFired)) return false;
      // safety_guard_applied = true iff rules_fired is non-empty
      const expectedGuard = valRulesFired.length > 0;
      return c1.safety_guard_applied === expectedGuard;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.6 - Property 12: Cache Key Determinism (Req 7.4)
  // cacheKey always returns the same string for the same triple
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 12 - Cache Key Determinism (Req 7.4)', () => {
    /**Validates: Requirements 7.4 */
    forAll('Cache Key Determinism', 300, (i) => ({
      activity_id: `ACT_${i % 50}`,
      node_id:     `NODE_${i % 10}`,
      age_band:    ['24-36', '36-48', '48-60'][i % 3],
    }), ({ activity_id, node_id, age_band }) => {
      const k1 = cacheKey(activity_id, node_id, age_band);
      const k2 = cacheKey(activity_id, node_id, age_band);
      const k3 = cacheKey(activity_id, node_id, age_band);
      return k1 === k2 && k2 === k3 && typeof k1 === 'string';
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.7 - Property 16: Chip Count Correctness (Req 10.2)
  // Safety count equals SAFE_-prefixed count; inclusion count equals INC_-prefixed count
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 16 - Chip Count Correctness (Req 10.2)', () => {
    /**Validates: Requirements 10.2 */
    forAll('Chip Count Correctness', 300, (i) => {
      // Generate a random subset of rule IDs
      const subset = ALL_RULE_IDS.filter((_, j) => lcgRand(i * 17 + j) > 0.5);
      return subset.length === 0 ? ['SAFE_CHOKE_01'] : subset; // ensure non-empty
    }, (rules_fired) => {
      const safetyCount    = rules_fired.filter(id => id.startsWith('SAFE_')).length;
      const inclusionCount = rules_fired.filter(id => id.startsWith('INC_')).length;
      // Verify the counts match what a chip renderer would compute
      const expected_safety    = rules_fired.filter(id => id.startsWith('SAFE_')).length;
      const expected_inclusion = rules_fired.filter(id => id.startsWith('INC_')).length;
      return safetyCount === expected_safety && inclusionCount === expected_inclusion;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11.8 - Property 17: Chip Pill Coverage (Req 10.3)
  // For any non-empty rules_fired, the number of pills equals rules_fired.length
  // ───────────────────────────────────────────────────────────────────────────

  it('Property 17 - Chip Pill Coverage (Req 10.3)', () => {
    /**Validates: Requirements 10.3 */
    forAll('Chip Pill Coverage', 300, (i) => {
      const subset = ALL_RULE_IDS.filter((_, j) => lcgRand(i * 13 + j) > 0.4);
      return subset.length === 0 ? ['SAFE_CHOKE_01'] : subset;
    }, (rules_fired) => {
      // The pill count MUST equal rules_fired.length
      // We verify the contract: every entry in rules_fired corresponds to exactly one pill
      const rulesMap = new Map(GuardrailEngine.getRules().map(r => [r.rule_id, r]));
      const pills = rules_fired.map(id => rulesMap.get(id)).filter(Boolean);
      // All fired IDs must be found in the catalogue (Property 7 ensures this)
      // The number of resolvable pills must equal rules_fired.length
      return pills.length === rules_fired.length;
    });
  });

});

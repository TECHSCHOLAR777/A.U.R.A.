/**
 * guardrail_engine.test.js
 *
 * Unit tests for guardrail_engine.js using Node.js built-in test runner.
 * guardrail_engine.js is pure-synchronous with no browser API dependencies
 * and can be imported directly in Node.js.
 *
 * Run from AURA/web:
 *   node --test tests/guardrail_engine.test.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment stubs — required BEFORE imports that touch bkt_engine.js (used
// transitively by server.js only, not guardrail_engine.js).
// These stubs are placed here so sub-task 9.6 can import server.js safely.
// ─────────────────────────────────────────────────────────────────────────────

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

globalThis.indexedDB = {
  open: () => {
    const r = {
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
    };
    setTimeout(() => {
      if (r.onsuccess) {
        r.onsuccess({
          target: {
            result: {
              objectStoreNames: { contains: () => false },
              createObjectStore: () => ({
                createIndex: () => {},
              }),
              transaction: () => ({
                objectStore: () => ({}),
              }),
            },
          },
        });
      }
    }, 0);
    return r;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GuardrailEngine, runRules, hasAny, anyProfile } from '../guardrail_engine.js';
import { buildStaticFallback } from '../server.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal activity that triggers no rules. */
const safeActivity = Object.freeze({
  id:                   'SAFE_TEST',
  targeted_domain:      'socio_emotional',
  materials:            [],
  choking_hazard:       false,
  inclusion_tags:       ['adult_supervision'],
  exclusion_tags:       [],
  keywords:             [],
  differentiation:      {},
  inclusion_adaptations:{},
  aadharshila_ref:      'SE-1',
  age_band_months:      '36-48',
});

/** Safe single-child profile inside age band. */
const safeProfiles = Object.freeze([
  Object.freeze({ child_id: 'C001', age_months: 40, needs: [], lingua_franca: 'hindi' }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// 9.1 — SAFE_CHOKE_01 (Req 6.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.1 SAFE_CHOKE_01 — pebbles + child < 36 months (Req 6.1)', () => {
  it('fires SAFE_CHOKE_01, action=reject_regenerate, passed=false', () => {
    const activity = { ...safeActivity, materials: ['pebbles'] };
    const profiles = [{ child_id: 'C002', age_months: 30, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('SAFE_CHOKE_01'), 'SAFE_CHOKE_01 must be in rules_fired');
    assert.equal(result.action, 'reject_regenerate');
    assert.equal(result.passed, false);
  });

  it('fires when materials include beads and child is 24 months', () => {
    const activity = { ...safeActivity, materials: ['beads'] };
    const profiles = [{ child_id: 'C003', age_months: 24, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('SAFE_CHOKE_01'));
    assert.equal(result.passed, false);
  });

  it('does NOT fire when child is exactly 36 months (boundary — rule is < 36)', () => {
    const activity = { ...safeActivity, materials: ['pebbles'] };
    const profiles = [{ child_id: 'C004', age_months: 36, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(
      !result.rules_fired.includes('SAFE_CHOKE_01'),
      'SAFE_CHOKE_01 must NOT fire for child aged exactly 36 months'
    );
  });

  it('does NOT fire when materials do not include pebbles or beads', () => {
    const activity = { ...safeActivity, materials: ['paint', 'brushes'] };
    const profiles = [{ child_id: 'C005', age_months: 20, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(
      !result.rules_fired.includes('SAFE_CHOKE_01'),
      'SAFE_CHOKE_01 must NOT fire when hazardous materials are absent'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9.2 — SAFE_CHOKE_02 (Req 6.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.2 SAFE_CHOKE_02 — choking_hazard flag + child < 48 months (Req 6.2)', () => {
  it('fires SAFE_CHOKE_02, passed=false', () => {
    const activity = { ...safeActivity, choking_hazard: true };
    const profiles = [{ child_id: 'C006', age_months: 44, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('SAFE_CHOKE_02'), 'SAFE_CHOKE_02 must be in rules_fired');
    assert.equal(result.passed, false);
  });

  it('does NOT fire when choking_hazard is false', () => {
    const activity = { ...safeActivity, choking_hazard: false };
    const profiles = [{ child_id: 'C007', age_months: 44, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(!result.rules_fired.includes('SAFE_CHOKE_02'));
  });

  it('does NOT fire when child is exactly 48 months (boundary — rule is < 48)', () => {
    const activity = { ...safeActivity, choking_hazard: true };
    const profiles = [{ child_id: 'C008', age_months: 48, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(
      !result.rules_fired.includes('SAFE_CHOKE_02'),
      'SAFE_CHOKE_02 must NOT fire for child aged exactly 48 months'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9.3 — INC_ATTUNE_01 (Req 6.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.3 INC_ATTUNE_01 — verbal keywords + non_verbal need (Req 6.6)', () => {
  it('fires INC_ATTUNE_01, action=flag_modify, passed=true (soft flag)', () => {
    const activity = { ...safeActivity, keywords: ['name', 'describe'] };
    const profiles = [{ child_id: 'C009', age_months: 40, needs: ['non_verbal'] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('INC_ATTUNE_01'), 'INC_ATTUNE_01 must be in rules_fired');
    assert.equal(result.action, 'flag_modify');
    // flag_modify is NOT a hard stop — passed must remain true
    assert.equal(result.passed, true);
  });

  it('fires with keyword "speak" + non_verbal profile', () => {
    const activity = { ...safeActivity, keywords: ['speak'] };
    const profiles = [{ child_id: 'C010', age_months: 36, needs: ['non_verbal'] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('INC_ATTUNE_01'));
    assert.equal(result.passed, true);
  });

  it('does NOT fire when profile has no non_verbal need', () => {
    const activity = { ...safeActivity, keywords: ['name', 'describe'] };
    const profiles = [{ child_id: 'C011', age_months: 40, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(!result.rules_fired.includes('INC_ATTUNE_01'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9.4 — Error resilience (Req 5.8)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.4 Error resilience — throwing rule condition (Req 5.8)', () => {
  it('throwing rule is absent from rules_fired; subsequent rules are still evaluated', () => {
    const throwingRule = {
      rule_id:   'TEST_THROW',
      type:      'safety',
      trigger:   'always throws',
      condition: () => { throw new Error('deliberate throw'); },
      action:    'reject_regenerate',
      message:   'should never fire',
    };

    const passingRule = {
      rule_id:   'TEST_PASS',
      type:      'inclusion',
      trigger:   'always fires',
      condition: () => true,
      action:    'flag_modify',
      message:   'always fires',
    };

    const result = runRules({}, [], [throwingRule, passingRule]);

    // Throwing rule must NOT appear in rules_fired
    assert.ok(
      !result.rules_fired.includes('TEST_THROW'),
      'TEST_THROW must be absent from rules_fired'
    );

    // Subsequent rule must still be evaluated and recorded
    assert.ok(
      result.rules_fired.includes('TEST_PASS'),
      'TEST_PASS must be present in rules_fired'
    );

    // flag_modify does not set passed=false
    assert.equal(result.passed, true);
  });

  it('throwing rule does not propagate the exception (validate never throws)', () => {
    // Passing a non-object activity exercises the top-level guard too
    assert.doesNotThrow(() => GuardrailEngine.validate(null, null));
    assert.doesNotThrow(() => GuardrailEngine.validate(undefined, undefined));
    assert.doesNotThrow(() => GuardrailEngine.validate('invalid', 42));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9.5 — Clean path (Req 5.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.5 Clean path — no rules fire (Req 5.5)', () => {
  it('safe activity + safe profiles → rules_fired=[], passed=true, action=null', () => {
    const result = GuardrailEngine.validate(safeActivity, safeProfiles);

    assert.deepEqual(result.rules_fired, []);
    assert.equal(result.passed, true);
    assert.equal(result.action, null);
  });

  it('empty profiles array with safe activity also passes cleanly', () => {
    const result = GuardrailEngine.validate(safeActivity, []);

    assert.equal(result.passed, true);
    assert.equal(result.action, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9.6 — Static fallback contract (Req 7.7)
// ─────────────────────────────────────────────────────────────────────────────

describe('9.6 Static fallback contract (Req 7.7)', () => {
  it("buildStaticFallback returns correct structure with fallback_tier='safe_default' and source='safe_default'", () => {
    const fallback = buildStaticFallback(
      'FM-3',
      [{ child_id: 'C001', age_months: 40, needs: [] }]
    );

    assert.equal(fallback.provenance.fallback_tier, 'safe_default');
    assert.equal(fallback.source, 'safe_default');
    assert.ok(
      Array.isArray(fallback.step_by_step_instructions),
      'step_by_step_instructions must be an array'
    );
    assert.ok(
      typeof fallback.provenance.cache_key === 'string',
      'cache_key must be a string'
    );
  });

  it('fallback step_by_step_instructions is non-empty', () => {
    const fallback = buildStaticFallback('FM-3', safeProfiles);
    assert.ok(fallback.step_by_step_instructions.length > 0);
  });

  it('fallback milestone_targeted matches the nodeId argument', () => {
    const fallback = buildStaticFallback('LE-7', safeProfiles);
    assert.equal(fallback.milestone_targeted, 'LE-7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional — INC_MOTOR_02 (Req 6.9)
// ─────────────────────────────────────────────────────────────────────────────

describe('Additional — INC_MOTOR_02 — locomotion + mobility_impaired (Req 6.9)', () => {
  it('fires INC_MOTOR_02, action=block_and_substitute, passed=false', () => {
    // Use 'walk' — present in INC_MOTOR_02 but NOT in SAFE_FALL_01 (which uses climb/jump).
    // This avoids SAFE_FALL_01 short-circuiting before INC_MOTOR_02 is evaluated.
    const activity = { ...safeActivity, keywords: ['walk'] };
    const profiles = [{ child_id: 'C012', age_months: 42, needs: ['mobility_impaired'] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(result.rules_fired.includes('INC_MOTOR_02'), 'INC_MOTOR_02 must be in rules_fired');
    assert.equal(result.action, 'block_and_substitute');
    assert.equal(result.passed, false);
  });

  it('does NOT fire when needs array does not include mobility_impaired', () => {
    const activity = { ...safeActivity, keywords: ['walk'] };
    const profiles = [{ child_id: 'C013', age_months: 42, needs: [] }];

    const result = GuardrailEngine.validate(activity, profiles);

    assert.ok(!result.rules_fired.includes('INC_MOTOR_02'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional — CURR_SEQ_01 absent roomAggregate (sub-task 4.6, Req 6.13)
// ─────────────────────────────────────────────────────────────────────────────

describe('Additional — CURR_SEQ_01 does not fire when roomAggregate is absent', () => {
  it('activity with no roomAggregate property → CURR_SEQ_01 absent from rules_fired', () => {
    // safeActivity has no roomAggregate key at all
    const result = GuardrailEngine.validate(safeActivity, safeProfiles);
    assert.ok(!result.rules_fired.includes('CURR_SEQ_01'));
  });

  it('activity with roomAggregate=null → CURR_SEQ_01 absent from rules_fired', () => {
    const activity = { ...safeActivity, roomAggregate: null };
    const result = GuardrailEngine.validate(activity, safeProfiles);
    assert.ok(!result.rules_fired.includes('CURR_SEQ_01'));
  });

  it('activity with roomAggregate avg_p_mastery >= 0.50 → CURR_SEQ_01 does NOT fire', () => {
    const activity = { ...safeActivity, roomAggregate: { avg_p_mastery: 0.65, total_count: 10, mastered_count: 7 } };
    const result = GuardrailEngine.validate(activity, safeProfiles);
    assert.ok(!result.rules_fired.includes('CURR_SEQ_01'));
  });

  it('activity with roomAggregate avg_p_mastery < 0.50 → CURR_SEQ_01 fires', () => {
    const activity = { ...safeActivity, roomAggregate: { avg_p_mastery: 0.30, total_count: 10, mastered_count: 2 } };
    const result = GuardrailEngine.validate(activity, safeProfiles);
    assert.ok(result.rules_fired.includes('CURR_SEQ_01'));
    // flag_modify — should not hard-stop
    assert.equal(result.passed, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional — getRules() contract (Req 5.9)
// ─────────────────────────────────────────────────────────────────────────────

describe('Additional — GuardrailEngine.getRules() contract (Req 5.9)', () => {
  it('returns exactly 15 rules', () => {
    const rules = GuardrailEngine.getRules();
    assert.equal(rules.length, 15);
  });

  it('every rule object is frozen', () => {
    const rules = GuardrailEngine.getRules();
    for (const rule of rules) {
      assert.ok(
        Object.isFrozen(rule),
        `Rule ${rule.rule_id} must be frozen`
      );
    }
  });

  it('the rules array itself is frozen', () => {
    const rules = GuardrailEngine.getRules();
    assert.ok(Object.isFrozen(rules), 'The rules array must be frozen');
  });

  it('each rule has required properties: rule_id, type, condition, action, message', () => {
    const rules = GuardrailEngine.getRules();
    for (const rule of rules) {
      assert.ok(typeof rule.rule_id === 'string' && rule.rule_id.length > 0, `rule_id missing on rule`);
      assert.ok(typeof rule.type === 'string', `type missing on rule ${rule.rule_id}`);
      assert.ok(typeof rule.condition === 'function', `condition not a function on rule ${rule.rule_id}`);
      assert.ok(typeof rule.action === 'string', `action missing on rule ${rule.rule_id}`);
      assert.ok(typeof rule.message === 'string', `message missing on rule ${rule.rule_id}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional — hasAny and anyProfile helper exports
// ─────────────────────────────────────────────────────────────────────────────

describe('Additional — hasAny and anyProfile helper functions', () => {
  it('hasAny returns true when array contains a matching value', () => {
    assert.equal(hasAny(['pebbles', 'sand'], ['pebbles']), true);
  });

  it('hasAny returns false when no overlap', () => {
    assert.equal(hasAny(['sand', 'clay'], ['pebbles', 'beads']), false);
  });

  it('hasAny handles non-array gracefully (returns false)', () => {
    assert.equal(hasAny(null, ['pebbles']), false);
    assert.equal(hasAny(undefined, ['pebbles']), false);
    assert.equal(hasAny('string', ['pebbles']), false);
  });

  it('anyProfile returns true when at least one profile satisfies the predicate', () => {
    const profiles = [
      { age_months: 50 },
      { age_months: 30 },
    ];
    assert.equal(anyProfile(profiles, p => p.age_months < 36), true);
  });

  it('anyProfile returns false when no profile satisfies the predicate', () => {
    const profiles = [{ age_months: 40 }, { age_months: 48 }];
    assert.equal(anyProfile(profiles, p => p.age_months < 36), false);
  });

  it('anyProfile handles non-array gracefully (returns false)', () => {
    assert.equal(anyProfile(null, () => true), false);
    assert.equal(anyProfile(undefined, () => true), false);
  });
});

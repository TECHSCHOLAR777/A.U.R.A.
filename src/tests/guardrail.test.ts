/**
 * Guardrail Engine Tests
 * ═══════════════════════════════════════════
 * Tests for the guardrail evaluation engine, condition evaluator,
 * and rule matching.
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../core/guardrail/engine.js';
import type { C1Activity } from '../core/schema/index.js';
import type { RoomContext } from '../core/guardrail/condition-evaluator.js';
import type { C2Rule } from '../core/schema/index.js';
import { RULE_TABLE } from '../core/rules/index.js';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeCleanActivity(overrides?: Partial<C1Activity>): C1Activity {
  return {
    schema_version: '1.0',
    activity_id: 'test-activity-001',
    source: 'local_template',
    targeted_domain: 'cognitive',
    age_band_months: '12-18',
    milestone_targeted: 'object-permanence',
    adapted_title: 'Peek-a-boo with cloth',
    step_by_step_instructions: ['Cover toy with cloth', 'Ask child to find toy'],
    required_materials: ['cloth', 'soft_toy'],
    safety_guard_applied: false,
    inclusion_modifications: {
      vast_parameter: 'none',
      instruction_override: '',
    },
    provenance: {
      generated_offline: true,
      rules_fired: [],
      cache_key: 'test-cache-001',
      fallback_tier: 'none',
    },
    ...overrides,
  };
}

function makeRoom(overrides?: Partial<RoomContext>): RoomContext {
  return {
    age_mix: [{ band: '12-18', count: 5 }],
    materials: [],
    inclusion_flags: [],
    ...overrides,
  };
}

// ─── Test Suites ────────────────────────────────────────────────────────────

describe('Guardrail Engine', () => {
  describe('SAFE_CHOKE_01', () => {
    it('fires for activity with "pebbles" in materials, age band 0-3', () => {
      const activity = makeCleanActivity({
        age_band_months: '0-3',
        required_materials: ['pebbles', 'cloth'],
      });
      const room = makeRoom({
        age_mix: [{ band: '0-3', count: 3 }],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.passed).toBe(false);
      expect(result.rules_fired.some((r) => r.rule_id === 'SAFE_CHOKE_01')).toBe(true);
      expect(result.action).not.toBe('pass');
    });

    it('STILL fires for age band 24-36 (pebbles dangerous at all ages under 36)', () => {
      const activity = makeCleanActivity({
        age_band_months: '24-36',
        required_materials: ['pebbles'],
      });
      const room = makeRoom({
        age_mix: [{ band: '24-36', count: 5 }],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      // SAFE_CHOKE_01 checks min_age < 36. For age band 24-36, min=24 < 36 → fires
      expect(result.rules_fired.some((r) => r.rule_id === 'SAFE_CHOKE_01')).toBe(true);
    });
  });

  describe('INC_ATTUNE_01', () => {
    it('fires for non-verbal child + language domain activity', () => {
      const activity = makeCleanActivity({
        targeted_domain: 'language',
        age_band_months: '12-18',
        inclusion_modifications: {
          vast_parameter: 'none',
          instruction_override: '',
        },
      });
      const room = makeRoom({
        age_mix: [{ band: '12-18', count: 4 }],
        inclusion_flags: ['non_verbal'],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.rules_fired.some((r) => r.rule_id === 'INC_ATTUNE_01')).toBe(true);
    });

    it('does NOT fire when instruction_override is set (vast_parameter != none)', () => {
      const activity = makeCleanActivity({
        targeted_domain: 'language',
        age_band_months: '12-18',
        inclusion_modifications: {
          vast_parameter: 'attunement',
          instruction_override: 'Use picture cards and gestures',
        },
      });
      const room = makeRoom({
        age_mix: [{ band: '12-18', count: 4 }],
        inclusion_flags: ['non_verbal'],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      // INC_ATTUNE_01 requires vast_parameter = 'none', so it should not fire
      expect(result.rules_fired.some((r) => r.rule_id === 'INC_ATTUNE_01')).toBe(false);
    });
  });

  describe('Clean activity', () => {
    it('returns passed=true and empty rules_fired for no violations', () => {
      const activity = makeCleanActivity();
      const room = makeRoom();

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.passed).toBe(true);
      expect(result.action).toBe('pass');
      expect(result.rules_fired).toHaveLength(0);
    });
  });

  describe('Multiple rules firing', () => {
    it('most severe action wins when multiple rules fire', () => {
      // Activity with choking hazard material + non-verbal child + language domain
      const activity = makeCleanActivity({
        targeted_domain: 'language',
        age_band_months: '0-3',
        required_materials: ['pebbles'],
        inclusion_modifications: {
          vast_parameter: 'none',
          instruction_override: '',
        },
      });
      const room = makeRoom({
        age_mix: [{ band: '0-3', count: 3 }],
        inclusion_flags: ['non_verbal'],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.passed).toBe(false);
      expect(result.rules_fired.length).toBeGreaterThan(1);
      // block_and_substitute is more severe than flag_modify
      expect(result.action).toBe('block_and_substitute');
    });
  });

  describe('Idempotency', () => {
    it('same input called twice produces identical output', () => {
      const activity = makeCleanActivity({
        targeted_domain: 'language',
        age_band_months: '0-3',
        required_materials: ['pebbles'],
        inclusion_modifications: {
          vast_parameter: 'none',
          instruction_override: '',
        },
      });
      const room = makeRoom({
        age_mix: [{ band: '0-3', count: 3 }],
        inclusion_flags: ['non_verbal'],
      });

      const rules = [...RULE_TABLE];
      const result1 = evaluate(activity, room, rules);
      const result2 = evaluate(activity, room, rules);

      expect(result1.passed).toBe(result2.passed);
      expect(result1.action).toBe(result2.action);
      expect(result1.rules_fired.length).toBe(result2.rules_fired.length);
      expect(result1.rules_fired.map((r) => r.rule_id)).toEqual(
        result2.rules_fired.map((r) => r.rule_id),
      );
    });
  });

  describe('SAFE_FIRE_01', () => {
    it('blocks candle materials for all ages', () => {
      const activity = makeCleanActivity({
        required_materials: ['candle'],
        age_band_months: '24-36',
      });
      const room = makeRoom({
        age_mix: [{ band: '24-36', count: 5 }],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.rules_fired.some((r) => r.rule_id === 'SAFE_FIRE_01')).toBe(true);
      expect(result.action).toBe('block_and_substitute');
    });
  });

  describe('SAFE_SHARP_01', () => {
    it('blocks scissors for children under 36 months', () => {
      const activity = makeCleanActivity({
        required_materials: ['scissors'],
        age_band_months: '18-24',
      });
      const room = makeRoom({
        age_mix: [{ band: '18-24', count: 4 }],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.rules_fired.some((r) => r.rule_id === 'SAFE_SHARP_01')).toBe(true);
    });
  });

  describe('DSS interaction rules', () => {
    it('DSS_MOTOR_FLAG_01 fires for motor concern + motor domain', () => {
      const activity = makeCleanActivity({
        targeted_domain: 'motor_physical',
        age_band_months: '6-9',
      });
      const room = makeRoom({
        age_mix: [{ band: '6-9', count: 4 }],
        inclusion_flags: ['motor_delay'],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.rules_fired.some((r) => r.rule_id === 'DSS_MOTOR_FLAG_01')).toBe(true);
    });

    it('DSS_LANG_FLAG_01 fires for language concern + language domain', () => {
      const activity = makeCleanActivity({
        targeted_domain: 'language',
        age_band_months: '6-9',
        inclusion_modifications: {
          vast_parameter: 'none',
          instruction_override: '',
        },
      });
      const room = makeRoom({
        age_mix: [{ band: '6-9', count: 4 }],
        inclusion_flags: ['selective_mutism'],
      });

      const result = evaluate(activity, room, [...RULE_TABLE]);

      expect(result.rules_fired.some((r) => r.rule_id === 'DSS_LANG_FLAG_01')).toBe(true);
    });
  });
});

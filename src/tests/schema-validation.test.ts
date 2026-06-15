/**
 * Schema Validation Tests
 * ═══════════════════════════════════════════
 * Tests for validateC1(), validateC2Rule(), and the ValidationError class.
 */

import { describe, it, expect } from 'vitest';
import {
  validateC1,
  isC1Activity,
  ValidationError,
} from '../core/schema/activity.schema.js';
import { validateC2Rule } from '../core/schema/rule.schema.js';
import type { C1Activity, C2Rule } from '../core/schema/index.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeValidC1(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    activity_id: 'test-001',
    source: 'local_template',
    targeted_domain: 'cognitive',
    age_band_months: '12-18',
    milestone_targeted: 'object-permanence',
    adapted_title: 'Peek-a-boo',
    step_by_step_instructions: ['Step 1'],
    required_materials: ['cloth'],
    safety_guard_applied: false,
    inclusion_modifications: {
      vast_parameter: 'none',
      instruction_override: '',
    },
    provenance: {
      generated_offline: true,
      rules_fired: [],
      cache_key: 'key-001',
      fallback_tier: 'none',
    },
  };
}

function makeValidC2Rule(): Record<string, unknown> {
  return {
    rule_id: 'TEST_RULE_01',
    type: 'safety',
    description: 'Test rule',
    trigger: { age_bands: ['0-3'] },
    condition: {
      type: 'material_check',
      operator: 'in',
      values: ['pebbles'],
    },
    action: 'block_and_substitute',
    message: 'Test message',
    severity: 'block',
  };
}

// ─── C1 Validation Tests ────────────────────────────────────────────────────

describe('C1 Activity Validation', () => {
  it('validates a correct C1Activity', () => {
    const obj = makeValidC1();
    const result = validateC1(obj);

    expect(result.schema_version).toBe('1.0');
    expect(result.activity_id).toBe('test-001');
  });

  it('isC1Activity returns true for valid objects', () => {
    expect(isC1Activity(makeValidC1())).toBe(true);
  });

  it('isC1Activity returns false for invalid objects', () => {
    expect(isC1Activity({})).toBe(false);
    expect(isC1Activity(null)).toBe(false);
    expect(isC1Activity('string')).toBe(false);
  });

  it('throws ValidationError with multiple field errors', () => {
    const invalid = {
      schema_version: '2.0',          // wrong version
      activity_id: 42,                 // wrong type
      source: 'invalid_source',       // invalid enum
      targeted_domain: 'invalid',     // invalid enum
      age_band_months: 'invalid',     // invalid enum
      milestone_targeted: '',
      adapted_title: '',
      step_by_step_instructions: [],   // empty (min 1)
      required_materials: 'not_array', // wrong type
      safety_guard_applied: 'yes',     // wrong type
      inclusion_modifications: null,   // wrong type
      provenance: null,                // wrong type
    };

    try {
      validateC1(invalid);
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ValidationError);
      if (e instanceof ValidationError) {
        expect(e.fieldErrors.length).toBeGreaterThan(5);
        expect(e.message).toContain('validation failed');
      }
    }
  });

  it('throws on non-object input', () => {
    expect(() => validateC1(null)).toThrow(ValidationError);
    expect(() => validateC1(undefined)).toThrow(ValidationError);
    expect(() => validateC1(42)).toThrow(ValidationError);
  });

  it('collects nested field errors for provenance', () => {
    const obj = makeValidC1();
    (obj as Record<string, unknown>)['provenance'] = {
      generated_offline: 'not_bool',
      rules_fired: 'not_array',
      cache_key: 123,
      fallback_tier: 'invalid',
    };

    try {
      validateC1(obj);
      expect.unreachable('Should have thrown');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ValidationError);
      if (e instanceof ValidationError) {
        expect(e.fieldErrors.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

// ─── C2 Rule Validation Tests ───────────────────────────────────────────────

describe('C2 Rule Validation', () => {
  it('validates a correct C2Rule', () => {
    const obj = makeValidC2Rule();
    const result = validateC2Rule(obj);

    expect(result.rule_id).toBe('TEST_RULE_01');
    expect(result.type).toBe('safety');
  });

  it('throws on invalid condition type', () => {
    const obj = makeValidC2Rule();
    (obj as Record<string, unknown>)['condition'] = { type: 'invalid_type' };

    expect(() => validateC2Rule(obj)).toThrow(ValidationError);
  });

  it('validates compound conditions recursively', () => {
    const obj = makeValidC2Rule();
    (obj as Record<string, unknown>)['condition'] = {
      type: 'compound_and',
      conditions: [
        { type: 'material_check', operator: 'in', values: ['test'] },
        { type: 'age_check', operator: 'lt', field: 'min_age_months', value: 12 },
      ],
    };

    const result = validateC2Rule(obj);
    expect(result.condition.type).toBe('compound_and');
  });

  it('throws on invalid nested compound condition', () => {
    const obj = makeValidC2Rule();
    (obj as Record<string, unknown>)['condition'] = {
      type: 'compound_and',
      conditions: [
        { type: 'invalid_nested' }, // invalid
      ],
    };

    expect(() => validateC2Rule(obj)).toThrow(ValidationError);
  });

  it('throws on non-object input', () => {
    expect(() => validateC2Rule(null)).toThrow(ValidationError);
    expect(() => validateC2Rule('string')).toThrow(ValidationError);
  });
});

// ─── ValidationError Class Tests ────────────────────────────────────────────

describe('ValidationError', () => {
  it('is instanceof Error', () => {
    const err = new ValidationError('Test', [
      { field: 'f', message: 'm', received: null },
    ]);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
  });

  it('contains all field errors', () => {
    const errors = [
      { field: 'a', message: 'bad a', received: 1 },
      { field: 'b', message: 'bad b', received: 2 },
    ];
    const err = new ValidationError('Schema', errors);

    expect(err.fieldErrors).toHaveLength(2);
    expect(err.message).toContain('bad a');
    expect(err.message).toContain('bad b');
  });
});

/**
 * DSS Screener Tests
 * ═══════════════════════════════════════════
 * Tests for the deterministic developmental screening system.
 */

import { describe, it, expect } from 'vitest';
import { evaluateDSS } from '../core/dss/screener.js';
import { STUB_THRESHOLDS } from '../core/dss/thresholds.js';
import { STUB_ITEMS } from '../core/dss/items.js';
import type { DSSResponse } from '../core/schema/index.js';

// ─── Test Suites ────────────────────────────────────────────────────────────

describe('DSS Screener', () => {
  it('two red flags → verdict = "refer_to_deic"', () => {
    // DSS_MOTOR_001 (red_flag, cutoff=2) and DSS_LANG_001 (red_flag, cutoff=2)
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 3, observed: true },
      { item_id: 'DSS_LANG_001', score: 2, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('refer_to_deic');
    expect(result.red_flag_count).toBe(2);
    expect(result.refer_reason).toBeDefined();
    expect(result.refer_reason).toContain('red flags');
  });

  it('one red flag → verdict = "monitor"', () => {
    // DSS_MOTOR_001 (red_flag, cutoff=2) fires; DSS_MOTOR_002 (not red_flag) below cutoff
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 2, observed: true },
      { item_id: 'DSS_MOTOR_002', score: 1, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('monitor');
    expect(result.red_flag_count).toBe(1);
  });

  it('no flags → verdict = "typical"', () => {
    // All scores below cutoffs
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 1, observed: true },
      { item_id: 'DSS_LANG_001', score: 1, observed: true },
      { item_id: 'DSS_COG_001', score: 1, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
  });

  it('fired_flags contains all fired items with full detail', () => {
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 3, observed: true },
      { item_id: 'DSS_LANG_001', score: 5, observed: true },
      { item_id: 'DSS_COG_001', score: 1, observed: true }, // below cutoff
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.fired_flags).toHaveLength(2);

    const motorFlag = result.fired_flags.find((f) => f.item_id === 'DSS_MOTOR_001');
    expect(motorFlag).toBeDefined();
    expect(motorFlag?.domain).toBe('motor');
    expect(motorFlag?.is_red_flag).toBe(true);
    expect(motorFlag?.description).toBeDefined();

    const langFlag = result.fired_flags.find((f) => f.item_id === 'DSS_LANG_001');
    expect(langFlag).toBeDefined();
    expect(langFlag?.domain).toBe('language');
    expect(langFlag?.is_red_flag).toBe(true);
  });

  it('unknown item_id in response → skipped gracefully, no throw', () => {
    const responses: DSSResponse[] = [
      { item_id: 'UNKNOWN_ITEM_999', score: 5, observed: true },
      { item_id: 'DSS_MOTOR_001', score: 1, observed: true },
    ];

    // Should not throw
    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.fired_flags).toHaveLength(0);
  });

  it('empty responses array → "typical" result', () => {
    const result = evaluateDSS([], [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
    // Domain scores should all be 0
    expect(result.domain_scores.motor).toBe(0);
    expect(result.domain_scores.language).toBe(0);
    expect(result.domain_scores.cognition).toBe(0);
    expect(result.domain_scores.social).toBe(0);
    expect(result.domain_scores.vision).toBe(0);
    expect(result.domain_scores.hearing).toBe(0);
  });

  it('unobserved responses are skipped', () => {
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 5, observed: false }, // would fire if observed
      { item_id: 'DSS_LANG_001', score: 5, observed: false },  // would fire if observed
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
  });

  it('domain_scores accumulate correctly', () => {
    const responses: DSSResponse[] = [
      { item_id: 'DSS_MOTOR_001', score: 1, observed: true },
      { item_id: 'DSS_MOTOR_002', score: 1, observed: true },
      { item_id: 'DSS_LANG_001', score: 3, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.domain_scores.motor).toBe(2); // 1 + 1
    expect(result.domain_scores.language).toBe(3);
  });
});

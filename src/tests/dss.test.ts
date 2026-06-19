/**
 * DSS Screener Tests
 * Validates the deterministic screener against the authoritative
 * Navchetana-derived DSS item and threshold set.
 */

import { describe, it, expect } from 'vitest';
import { evaluateDSS } from '../core/dss/screener.js';
import { STUB_THRESHOLDS } from '../core/dss/thresholds.js';
import { STUB_ITEMS } from '../core/dss/items.js';
import type { DSSResponse } from '../core/schema/index.js';

const motorItem = STUB_ITEMS.find((item) => item.domain === 'motor');
const languageItem = STUB_ITEMS.find((item) => item.domain === 'language');
const cognitionItem = STUB_ITEMS.find((item) => item.domain === 'cognition');

if (!motorItem || !languageItem || !cognitionItem) {
  throw new Error('Navchetana DSS fixtures do not cover the required test domains.');
}

describe('DSS Screener', () => {
  it('two red flags -> verdict = "refer_to_deic"', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 1, observed: true },
      { item_id: languageItem.item_id, score: 1, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('refer_to_deic');
    expect(result.red_flag_count).toBe(2);
    expect(result.refer_reason).toBeDefined();
    expect(result.refer_reason).toContain('red flags');
  });

  it('one red flag -> verdict = "monitor"', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 1, observed: true },
      { item_id: languageItem.item_id, score: 0, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('monitor');
    expect(result.red_flag_count).toBe(1);
  });

  it('no flags -> verdict = "typical"', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 0, observed: true },
      { item_id: languageItem.item_id, score: 0, observed: true },
      { item_id: cognitionItem.item_id, score: 0, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
  });

  it('fired_flags contains all fired items with full detail', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 2, observed: true },
      { item_id: languageItem.item_id, score: 4, observed: true },
      { item_id: cognitionItem.item_id, score: 0, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.fired_flags).toHaveLength(2);

    const motorFlag = result.fired_flags.find((flag) => flag.item_id === motorItem.item_id);
    expect(motorFlag).toBeDefined();
    expect(motorFlag?.domain).toBe('motor');
    expect(motorFlag?.is_red_flag).toBe(true);
    expect(motorFlag?.description).toBeDefined();

    const languageFlag = result.fired_flags.find((flag) => flag.item_id === languageItem.item_id);
    expect(languageFlag).toBeDefined();
    expect(languageFlag?.domain).toBe('language');
    expect(languageFlag?.is_red_flag).toBe(true);
  });

  it('unknown item_id in response -> skipped gracefully, no throw', () => {
    const responses: DSSResponse[] = [
      { item_id: 'UNKNOWN_ITEM_999', score: 5, observed: true },
      { item_id: motorItem.item_id, score: 0, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.fired_flags).toHaveLength(0);
  });

  it('empty responses array -> "typical" result', () => {
    const result = evaluateDSS([], [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
    expect(result.domain_scores.motor).toBe(0);
    expect(result.domain_scores.language).toBe(0);
    expect(result.domain_scores.cognition).toBe(0);
    expect(result.domain_scores.social).toBe(0);
    expect(result.domain_scores.vision).toBe(0);
    expect(result.domain_scores.hearing).toBe(0);
  });

  it('unobserved responses are skipped', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 5, observed: false },
      { item_id: languageItem.item_id, score: 5, observed: false },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.verdict).toBe('typical');
    expect(result.red_flag_count).toBe(0);
    expect(result.fired_flags).toHaveLength(0);
  });

  it('domain_scores accumulate correctly', () => {
    const responses: DSSResponse[] = [
      { item_id: motorItem.item_id, score: 2, observed: true },
      { item_id: languageItem.item_id, score: 3, observed: true },
    ];

    const result = evaluateDSS(responses, [...STUB_THRESHOLDS], [...STUB_ITEMS]);

    expect(result.domain_scores.motor).toBe(2);
    expect(result.domain_scores.language).toBe(3);
  });
});

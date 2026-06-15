/**
 * Health Engine Tests
 * ═══════════════════════════════════════════
 * Tests for WHO Z-score calculation and growth anomaly detection.
 */

import { describe, it, expect } from 'vitest';
import { 
  computeZScore, 
  calculateLMSZScore, 
  zScoreToPercentile, 
  classifyZScore 
} from '../core/health/zscore.js';
import { detectAnomaly } from '../core/health/anomaly.js';

describe('Z-Score Calculator', () => {
  it('calculateLMSZScore uses correct Box-Cox formula', () => {
    // Simple verifiable case
    // L=1, M=10, S=0.1, value=12
    // Z = ((12/10)^1 - 1) / (1 * 0.1) = (1.2 - 1) / 0.1 = 0.2 / 0.1 = 2.0
    const z = calculateLMSZScore(12, 1, 10, 0.1);
    expect(z).toBeCloseTo(2.0, 5);
  });

  it('calculateLMSZScore handles L=0 (natural log) properly', () => {
    // If L is effectively 0, formula is ln(value/M)/S
    // M=10, S=0.1, value=10.5 -> ln(1.05)/0.1 ≈ 0.04879 / 0.1 = 0.4879
    const z = calculateLMSZScore(10.5, 0, 10, 0.1);
    expect(z).toBeCloseTo(Math.log(1.05)/0.1, 5);
  });

  it('zScoreToPercentile approximates standard normal CDF', () => {
    expect(zScoreToPercentile(0)).toBeCloseTo(50.0, 1);
    expect(zScoreToPercentile(1.96)).toBeCloseTo(97.5, 0); // 97.5th percentile
    expect(zScoreToPercentile(-1.96)).toBeCloseTo(2.5, 0); // 2.5th percentile
  });

  it('classifyZScore correctly categorizes severities', () => {
    expect(classifyZScore(0)).toBe('normal');
    expect(classifyZScore(-1.5)).toBe('normal');
    expect(classifyZScore(-2.1)).toBe('moderate');
    expect(classifyZScore(2.5)).toBe('moderate');
    expect(classifyZScore(-3.1)).toBe('severe');
    expect(classifyZScore(4.0)).toBe('severe');
  });

  it('computeZScore uses WHO stub for boys weight 0-6 months', () => {
    // At month 2 for boys: L: 0.3204, M: 5.575, S: 0.12563
    // Median value (5.575) should return Z=0
    const resultMedian = computeZScore('weight_for_age', 5.575, 2, 'male');
    expect(resultMedian.z_score).toBe(0);
    expect(resultMedian.percentile).toBe(50);
    expect(resultMedian.classification).toBe('normal');

    // A low value for 2 month old boy (e.g., 4.0 kg)
    const resultLow = computeZScore('weight_for_age', 4.0, 2, 'male');
    expect(resultLow.z_score).toBeLessThan(-1);
  });
});

describe('Anomaly Detection', () => {
  it('returns normal if insufficient data', () => {
    const result = detectAnomaly([]);
    expect(result.has_anomaly).toBe(false);
  });

  it('detects severe malnutrition for single record Z <= -3', () => {
    const result = detectAnomaly([
      { date: '2025-01-01', z_score: -3.2 }
    ]);
    expect(result.has_anomaly).toBe(true);
    expect(result.anomaly_type).toBe('severe_malnutrition');
  });

  it('detects faltering growth (drop of > 0.67 Z-scores)', () => {
    const history = [
      { date: '2025-01-01', z_score: 0.5 },
      { date: '2025-02-01', z_score: -0.3 } // Drop of 0.8
    ];
    const result = detectAnomaly(history);
    expect(result.has_anomaly).toBe(true);
    expect(result.anomaly_type).toBe('faltering_growth');
  });

  it('detects rapid weight gain (increase of > 0.67 Z-scores)', () => {
    const history = [
      { date: '2025-01-01', z_score: -1.0 },
      { date: '2025-02-01', z_score: 0.0 } // Jump of 1.0
    ];
    const result = detectAnomaly(history);
    expect(result.has_anomaly).toBe(true);
    expect(result.anomaly_type).toBe('rapid_weight_gain');
  });

  it('detects stunting trend if latest Z <= -2 (and no major drop)', () => {
    const history = [
      { date: '2025-01-01', z_score: -2.1 },
      { date: '2025-02-01', z_score: -2.2 } // Small drop, but absolute is <= -2
    ];
    const result = detectAnomaly(history);
    expect(result.has_anomaly).toBe(true);
    expect(result.anomaly_type).toBe('stunting_trend');
  });

  it('returns no anomaly for stable, normal growth', () => {
    const history = [
      { date: '2025-01-01', z_score: 0.2 },
      { date: '2025-02-01', z_score: 0.3 },
      { date: '2025-03-01', z_score: 0.1 }
    ];
    const result = detectAnomaly(history);
    expect(result.has_anomaly).toBe(false);
    expect(result.confidence).toBe(0.90); // 3+ records
  });
});

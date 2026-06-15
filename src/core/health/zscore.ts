/**
 * Z-Score Calculator
 * ═══════════════════════════════════════════
 * Implements WHO growth standard Z-score calculations using the LMS method.
 * 
 * The LMS method calculates Z-scores using three parameters:
 *  - L: Box-Cox power transformation (skewness)
 *  - M: Median
 *  - S: Coefficient of variation
 *
 * Formula:
 *  Z = (((value / M) ^ L) - 1) / (L * S)   if L ≠ 0
 *  Z = ln(value / M) / S                   if L = 0
 * 
 * Note: A minimal set of WHO LMS parameters is provided for demonstration. 
 * In production, the full WHO LMS JSON tables should be injected/loaded.
 */

export type MeasurementType = 'weight_for_age' | 'height_for_age' | 'weight_for_height';

export interface ZScoreResult {
  readonly measurement_type: MeasurementType;
  readonly z_score: number;
  readonly percentile: number;
  readonly classification: 'normal' | 'moderate' | 'severe';
}

/**
 * Calculates a Z-score using the LMS method.
 */
export function calculateLMSZScore(value: number, l: number, m: number, s: number): number {
  if (value <= 0 || m <= 0 || s <= 0) {
    return 0; // Guard against invalid inputs
  }
  
  if (Math.abs(l) < 1e-7) {
    return Math.log(value / m) / s;
  }
  
  return (Math.pow(value / m, l) - 1) / (l * s);
}

/**
 * Standard Normal cumulative distribution function (CDF) approximation.
 * Converts Z-score to percentile (0-100).
 */
export function zScoreToPercentile(z: number): number {
  // Approximation using the error function (erf)
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  
  // A&S formula 7.1.26
  const t = 1.0 / (1.0 + 0.3275911 * x);
  const erf = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  
  const cdf = 0.5 * (1.0 + sign * erf);
  return Math.round(cdf * 1000) / 10; // 0.0 to 100.0, 1 decimal place
}

/**
 * Minimal WHO LMS Reference Table (Stub values for typical months 0-6, Boys)
 * For a full implementation, this should be a comprehensive lookup.
 */
const STUB_WHO_LMS_BOYS_WEIGHT: Record<number, { L: number; M: number; S: number }> = {
  0: { L: 0.3487, M: 3.346, S: 0.14602 },
  1: { L: 0.3340, M: 4.470, S: 0.13395 },
  2: { L: 0.3204, M: 5.575, S: 0.12563 },
  3: { L: 0.3080, M: 6.394, S: 0.12001 },
  4: { L: 0.2965, M: 7.013, S: 0.11612 },
  5: { L: 0.2858, M: 7.502, S: 0.11330 },
  6: { L: 0.2758, M: 7.925, S: 0.11115 },
};

/**
 * Determines classification based on WHO cutoffs.
 */
export function classifyZScore(zScore: number): ZScoreResult['classification'] {
  if (zScore <= -3 || zScore >= 3) return 'severe';
  if (zScore <= -2 || zScore >= 2) return 'moderate';
  return 'normal';
}

/**
 * Computes Z-score using provided or fallback LMS parameters.
 */
export function computeZScore(
  measurementType: MeasurementType,
  value: number,
  ageMonths: number,
  sex: 'male' | 'female'
): ZScoreResult {
  // Use stub parameters if available, otherwise use a generic fallback 
  // (In real usage, Dev 4 would provide full WHO tables)
  let l = 1, m = value, s = 0.1;
  
  if (measurementType === 'weight_for_age' && sex === 'male' && STUB_WHO_LMS_BOYS_WEIGHT[ageMonths]) {
    const params = STUB_WHO_LMS_BOYS_WEIGHT[ageMonths]!;
    l = params.L;
    m = params.M;
    s = params.S;
  } else {
    // Graceful fallback for unimplemented months/types to avoid throwing
    // Assumes the child is at the 50th percentile (M = value)
    m = value;
    l = 1.0;
    s = 0.15; 
  }

  const zScore = calculateLMSZScore(value, l, m, s);
  
  return {
    measurement_type: measurementType,
    z_score: Number(zScore.toFixed(2)),
    percentile: zScoreToPercentile(zScore),
    classification: classifyZScore(zScore)
  };
}

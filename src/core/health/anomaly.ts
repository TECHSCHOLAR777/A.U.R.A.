/**
 * Anomaly Detection
 * ═══════════════════════════════════════════
 * Growth anomaly detection based on Z-score trends.
 * Implements standard pediatric heuristics for faltering growth
 * and rapid weight changes.
 */

export interface AnomalyResult {
  readonly has_anomaly: boolean;
  readonly anomaly_type?: 'faltering_growth' | 'rapid_weight_gain' | 'stunting_trend' | 'severe_malnutrition' | undefined;
  readonly confidence: number;
  readonly recommendation: string;
}

export interface ZScoreRecord {
  readonly date: string; // ISO Date
  readonly z_score: number;
}

/**
 * Detects growth anomalies from a chronological history of Z-scores.
 * 
 * Rules:
 * - Severe Malnutrition: Latest Z-score <= -3
 * - Faltering Growth: Drop of > 0.67 Z-scores between consecutive measurements
 * - Rapid Weight Gain: Increase of > 0.67 Z-scores between consecutive measurements
 * - Stunting Trend: Latest Z-score <= -2
 */
export function detectAnomaly(
  zScoreHistory: ReadonlyArray<ZScoreRecord>
): AnomalyResult {
  if (zScoreHistory.length === 0) {
    return {
      has_anomaly: false,
      confidence: 0,
      recommendation: "Insufficient data: At least one measurement required."
    };
  }

  // Sort chronologically just in case
  const history = [...zScoreHistory].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const latest = history[history.length - 1]!;

  // 1. Absolute threshold checks on latest measurement
  if (latest.z_score <= -3) {
    return {
      has_anomaly: true,
      anomaly_type: 'severe_malnutrition',
      confidence: 0.95,
      recommendation: "URGENT: Severe malnutrition indicated (Z-score ≤ -3). Immediate referral to medical facility or DEIC required."
    };
  }

  if (latest.z_score <= -2) {
    return {
      has_anomaly: true,
      anomaly_type: 'stunting_trend',
      confidence: 0.85,
      recommendation: "Moderate undernutrition or stunting (Z-score ≤ -2). Monitor closely, review feeding practices, and schedule a follow-up."
    };
  }

  // 2. Trend checks (requires at least 2 measurements)
  if (history.length >= 2) {
    const previous = history[history.length - 2]!;
    const delta = latest.z_score - previous.z_score;

    // Crossing a major percentile line (approx 0.67 Z-score distance)
    if (delta <= -0.67) {
      return {
        has_anomaly: true,
        anomaly_type: 'faltering_growth',
        confidence: 0.90,
        recommendation: "Faltering growth detected: Child has dropped across a major growth percentile. Investigate recent illnesses or feeding issues."
      };
    }

    if (delta >= 0.67) {
      return {
        has_anomaly: true,
        anomaly_type: 'rapid_weight_gain',
        confidence: 0.80,
        recommendation: "Rapid weight gain detected: Child crossed a major percentile line upwards. Assess if this is recovery catch-up growth or potential overfeeding."
      };
    }
  }

  // No anomalies detected
  return {
    has_anomaly: false,
    confidence: history.length >= 3 ? 0.90 : 0.60,
    recommendation: "Growth is tracking normally along the child's established trajectory."
  };
}

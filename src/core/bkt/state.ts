/**
 * BKT State — Initial State Factory and Trajectory Calculation
 * ═════════════════════════════════════════════════════════════════
 * Creates initial mastery states for new children/milestones and
 * calculates whether a child is off-trajectory relative to expected
 * mastery progression.
 *
 * Trajectory logic:
 *   Expected mastery after N observations = p_l0 + N * P_T * (1 - p_l0)
 *   If actual < expected - 0.15 for 2+ consecutive sessions → off_trajectory
 *   trajectory_lag_sessions = floor((expected - actual) / P_T)
 */

import type { ChildMasteryState, AgeBandMonths, Domain } from '../schema/index.js';
import { DEFAULT_BKT_PARAMS } from './priors.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Mastery deficit threshold for triggering off-trajectory flag. */
const TRAJECTORY_DEFICIT_THRESHOLD = 0.15;

/** Minimum number of observations before trajectory assessment is meaningful. */
const MIN_OBSERVATIONS_FOR_TRAJECTORY = 2;

// ─── Initial State Factory ──────────────────────────────────────────────────

/**
 * Creates the initial mastery state for a child's first encounter
 * with a milestone. All fields initialized to baseline values.
 *
 * @param child_uuid   - Opaque child identifier (no PII).
 * @param milestone_id - The milestone being tracked.
 * @param age_band     - The child's current age band.
 * @param domain       - The developmental domain.
 * @param p_l0         - Initial mastery probability (from priors).
 * @returns A fresh ChildMasteryState.
 */
export function createInitialMasteryState(
  child_uuid: string,
  milestone_id: string,
  age_band: AgeBandMonths,
  domain: Domain,
  p_l0: number,
): ChildMasteryState {
  const today = new Date().toISOString().split('T')[0];

  return {
    child_uuid,
    milestone_id,
    age_band,
    domain,
    p_mastery: Math.max(0.01, Math.min(0.99, p_l0)),
    observation_count: 0,
    last_updated_session: today!, // Non-null: ISO string always has 'T'
    off_trajectory: false,
    trajectory_lag_sessions: 0,
    p_history: [],
  };
}

// ─── Trajectory Calculation ─────────────────────────────────────────────────

/**
 * Calculates whether a child is off-trajectory for a given milestone.
 *
 * Expected mastery after N observations:
 *   expected = p_l0 + N * P_T * (1 - p_l0)
 *
 * Off-trajectory if:
 *   actual < expected - TRAJECTORY_DEFICIT_THRESHOLD
 *   AND observation_count >= MIN_OBSERVATIONS_FOR_TRAJECTORY
 *
 * Trajectory lag:
 *   floor((expected - actual) / P_T)
 *
 * @param state - The current mastery state.
 * @returns Trajectory flag and lag count.
 */
export function calculateTrajectoryFlag(state: ChildMasteryState): {
  off_trajectory: boolean;
  trajectory_lag_sessions: number;
} {
  const pT = DEFAULT_BKT_PARAMS.p_t;
  const pL0 = DEFAULT_BKT_PARAMS.p_l0;
  const n = state.observation_count;

  if (state.p_history) {
    const pHistory = state.p_history;
    const currentPMastery = state.p_mastery;
    const threshold = 0.80; // Mastery threshold

    if (currentPMastery >= threshold) {
      return { off_trajectory: false, trajectory_lag_sessions: 0 };
    }

    if (pHistory.length < 3) {
      return { off_trajectory: false, trajectory_lag_sessions: 0 };
    }

    const h = pHistory.slice(-3);
    const deltas = [
      h[1] - h[0],
      h[2] - h[1],
      currentPMastery - h[2],
    ];

    const atRisk = deltas.every(d => d < -0.01) && currentPMastery < 0.50;
    const stalled = deltas.every(d => Math.abs(d) < 0.02);

    if (atRisk || stalled) {
      const expected = Math.min(0.99, pL0 + n * pT * (1 - pL0));
      const deficit = expected - currentPMastery;
      const lagSessions = pT > 0 && deficit > 0 ? Math.floor(deficit / pT) : 0;
      return {
        off_trajectory: true,
        trajectory_lag_sessions: lagSessions,
      };
    }

    return { off_trajectory: false, trajectory_lag_sessions: 0 };
  }

  // Expected mastery progression
  const expected = Math.min(0.99, pL0 + n * pT * (1 - pL0));
  const deficit = expected - state.p_mastery;

  // Need enough observations for a meaningful trajectory assessment
  if (n < MIN_OBSERVATIONS_FOR_TRAJECTORY) {
    return { off_trajectory: false, trajectory_lag_sessions: 0 };
  }

  if (deficit > TRAJECTORY_DEFICIT_THRESHOLD) {
    const lagSessions = pT > 0 ? Math.floor(deficit / pT) : 0;
    return {
      off_trajectory: true,
      trajectory_lag_sessions: lagSessions,
    };
  }

  return { off_trajectory: false, trajectory_lag_sessions: 0 };
}

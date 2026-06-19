/**
 * BKT Engine - Bayesian Knowledge Tracing via 4-Parameter HMM
 * ═════════════════════════════════════════════════════════════════
 * Implements the Hidden Markov Model update for child mastery tracking.
 * O(1) per update - no loops, no allocations beyond the return object.
 *
 * The engine NEVER throws. On degenerate inputs (NaN, zero denominator),
 * it returns the current state unchanged and logs a warning.
 *
 * Every update returns a NEW ChildMasteryState (immutable).
 */

import type { ChildMasteryState, BKTParams, TapOutcome } from '../schema/index.js';
import { calculateTrajectoryFlag } from './state.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MASTERY_MIN = 0.01;
const MASTERY_MAX = 0.99;
const EPSILON = 1e-10;

// ─── Clamp ──────────────────────────────────────────────────────────────────

/**
 * Clamps a value to [min, max]. Returns min if value is NaN.
 */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Performs a single BKT HMM update given the current mastery state,
 * a tap outcome, and the model parameters.
 *
 * The math:
 *   Step 1 (Evidence update):
 *     success:  p' = p*(1-P_S) / [p*(1-P_S) + (1-p)*P_G]
 *     failure:  p' = p*P_S     / [p*P_S     + (1-p)*(1-P_G)]
 *     not_observed: skip evidence update
 *
 *   Step 2 (Transition):
 *     p_new = p' + (1 - p') * P_T
 *
 *   Clamp after EVERY arithmetic step.
 *
 * @param current - The current mastery state (immutable, not mutated).
 * @param outcome - The tap-grid observation outcome.
 * @param params  - The BKT HMM parameters.
 * @returns A new ChildMasteryState with updated mastery.
 */
export function updateMastery(
  current: ChildMasteryState,
  outcome: TapOutcome,
  params: BKTParams,
): ChildMasteryState {
  let pMastery = current.p_mastery;

  // Step 1: Evidence update (skip if not_observed)
  if (outcome === 'success') {
    const numerator = pMastery * (1 - params.p_s);
    const denominator = pMastery * (1 - params.p_s) + (1 - pMastery) * params.p_g;

    // Guard against zero/near-zero denominator
    if (denominator < EPSILON) {
      console.warn(
        `[BKT] Zero denominator in success update for child=${current.child_uuid}, ` +
        `milestone=${current.milestone_id}. Returning state unchanged.`,
      );
      return current;
    }

    pMastery = clamp(numerator / denominator, MASTERY_MIN, MASTERY_MAX);
  } else if (outcome === 'failure') {
    const numerator = pMastery * params.p_s;
    const denominator = pMastery * params.p_s + (1 - pMastery) * (1 - params.p_g);

    // Guard against zero/near-zero denominator
    if (denominator < EPSILON) {
      console.warn(
        `[BKT] Zero denominator in failure update for child=${current.child_uuid}, ` +
        `milestone=${current.milestone_id}. Returning state unchanged.`,
      );
      return current;
    }

    pMastery = clamp(numerator / denominator, MASTERY_MIN, MASTERY_MAX);
  }
  // outcome === 'not_observed': skip evidence update, go straight to transition

  // Step 2: Transition
  const pNew = clamp(
    pMastery + (1 - pMastery) * params.p_t,
    MASTERY_MIN,
    MASTERY_MAX,
  );

  // Build updated state
  const newObservationCount =
    outcome === 'not_observed'
      ? current.observation_count
      : current.observation_count + 1;

  const today = new Date().toISOString().split('T')[0];
  // Non-null assertion justified: ISO string always has 'T' separator
  const sessionDate = today!;

  const currentHistory = current.p_history || [];

  // Recalculate trajectory with the new mastery
  const updatedStatePartial: ChildMasteryState = {
    child_uuid: current.child_uuid,
    milestone_id: current.milestone_id,
    age_band: current.age_band,
    domain: current.domain,
    p_mastery: pNew,
    observation_count: newObservationCount,
    last_updated_session: sessionDate,
    off_trajectory: current.off_trajectory, // placeholder
    trajectory_lag_sessions: current.trajectory_lag_sessions, // placeholder
    p_history: currentHistory,
  };

  const trajectory = calculateTrajectoryFlag(updatedStatePartial);
  const updatedHistory = [...currentHistory, pNew].slice(-5);

  return {
    ...updatedStatePartial,
    off_trajectory: trajectory.off_trajectory,
    trajectory_lag_sessions: trajectory.trajectory_lag_sessions,
    p_history: updatedHistory,
  };
}

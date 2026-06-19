/**
 * BKT (Bayesian Knowledge Tracing) Schema Contract
 * ═══════════════════════════════════════════════════════
 * Defines the mastery state, HMM parameters, and tap outcomes used by
 * the BKT engine. These types flow between the BKT engine and the
 * room-aggregate module that feeds Dev 2's bandit context vector.
 *
 * This file is a FROZEN CONTRACT - changes require sign-off from all devs.
 */

import type { AgeBandMonths, Domain } from './activity.schema.js';

// ─── Child Mastery State ────────────────────────────────────────────────────

/**
 * Per-child, per-milestone mastery state maintained in local storage.
 * Updated after every tap-grid observation via the BKT HMM update.
 *
 * - p_mastery is always clamped to [0.01, 0.99] to prevent degenerate states.
 * - off_trajectory is recalculated after every update.
 * - No PII - child_uuid is an opaque identifier.
 */
export interface ChildMasteryState {
  readonly child_uuid: string;
  readonly milestone_id: string;
  readonly age_band: AgeBandMonths;
  readonly domain: Domain;
  readonly p_mastery: number;
  readonly observation_count: number;
  readonly last_updated_session: string;
  readonly off_trajectory: boolean;
  readonly trajectory_lag_sessions: number;
  readonly p_history?: readonly number[];
}

// ─── BKT HMM Parameters ────────────────────────────────────────────────────

/**
 * The four parameters of the BKT Hidden Markov Model.
 *
 * - p_l0: Prior probability of mastery (varies per milestone).
 * - p_t:  Probability of transitioning from unlearned to learned (0.15 fixed).
 * - p_g:  Probability of guessing correctly without mastery (0.20 fixed).
 * - p_s:  Probability of slipping (wrong answer despite mastery) (0.10 fixed).
 */
export interface BKTParams {
  readonly p_l0: number;
  readonly p_t: number;
  readonly p_g: number;
  readonly p_s: number;
}

// ─── Tap Outcomes ───────────────────────────────────────────────────────────

/**
 * Outcome of a single tap-grid observation during an activity session.
 *
 * - "success":       Child demonstrated the targeted skill.
 * - "failure":       Child did not demonstrate the targeted skill.
 * - "not_observed":  Anganwadi worker could not observe (child absent, distracted, etc.)
 */
export type TapOutcome = 'success' | 'failure' | 'not_observed';

// ─── Milestone Prior ────────────────────────────────────────────────────────

/**
 * Per-milestone prior mastery probability, loaded from Dev 4's curriculum data.
 * Used to initialize p_l0 for a child's first encounter with a milestone.
 */
export interface MilestonePrior {
  readonly milestone_id: string;
  readonly age_band: AgeBandMonths;
  readonly p_l0: number;
}

// ─── Room Aggregate ─────────────────────────────────────────────────────────

/**
 * Aggregated mastery statistics for an entire room of children.
 * Fed into Dev 2's bandit context vector for activity selection.
 */
export interface RoomAggregate {
  readonly dominant_band: AgeBandMonths;
  readonly mastery_distribution: Record<AgeBandMonths, number>;
  readonly off_trajectory_count: number;
  readonly domain_gaps: Domain[];
  readonly total_children: number;
}

/**
 * BKT Priors - Default Parameters and Milestone Prior Lookup
 * ═══════════════════════════════════════════════════════════════
 * Provides the default BKT parameters and a lookup function for
 * milestone-specific priors from Dev 4's curriculum data.
 *
 * If a milestone is not found, returns DEFAULT_BKT_PARAMS and logs
 * a warning. NEVER throws - the engine must work even without Dev 4's data.
 */

import type { BKTParams, MilestonePrior, AgeBandMonths } from '../schema/index.js';

// ─── Default Parameters ─────────────────────────────────────────────────────

/**
 * Default BKT HMM parameters used when milestone-specific priors
 * are not available. Conservative initial mastery assumption.
 */
export const DEFAULT_BKT_PARAMS: BKTParams = {
  p_l0: 0.20,  // Prior mastery probability
  p_t: 0.15,   // Transition probability (unlearned → learned)
  p_g: 0.20,   // Guess probability
  p_s: 0.10,   // Slip probability
} as const;

// ─── Prior Lookup ───────────────────────────────────────────────────────────

/**
 * Looks up milestone-specific BKT parameters from a prior table.
 * Returns the default parameters if the milestone is not found.
 *
 * The p_l0 from the prior table overrides the default; p_t, p_g, p_s
 * remain fixed at their canonical values.
 *
 * @param milestone_id - The milestone identifier.
 * @param age_band     - The age band for the milestone.
 * @param priorTable   - Array of milestone priors (from Dev 4's JSON).
 * @returns BKTParams with milestone-specific p_l0 if found, defaults otherwise.
 */
export function getPriorForMilestone(
  milestone_id: string,
  age_band: AgeBandMonths,
  priorTable: readonly MilestonePrior[],
): BKTParams {
  const match = priorTable.find(
    (p) => p.milestone_id === milestone_id && p.age_band === age_band,
  );

  if (match === undefined) {
    console.warn(
      `[BKT Priors] No prior found for milestone="${milestone_id}" ` +
      `age_band="${age_band}". Using DEFAULT_BKT_PARAMS (p_l0=${DEFAULT_BKT_PARAMS.p_l0}).`,
    );
    return DEFAULT_BKT_PARAMS;
  }

  return {
    p_l0: match.p_l0,
    p_t: DEFAULT_BKT_PARAMS.p_t,
    p_g: DEFAULT_BKT_PARAMS.p_g,
    p_s: DEFAULT_BKT_PARAMS.p_s,
  };
}

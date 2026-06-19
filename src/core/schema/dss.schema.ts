/**
 * DSS (Developmental Screening System) Schema Contract
 * ═════════════════════════════════════════════════════════
 * Defines the screening domain, items, thresholds, verdicts, and results
 * used by the DSS screener module. Deterministic and explainable - every
 * flag has a human-readable description for the anganwadi worker.
 *
 * This file is a FROZEN CONTRACT - changes require sign-off from all devs.
 */

import type { AgeBandMonths } from './activity.schema.js';

// ─── DSS Domain ─────────────────────────────────────────────────────────────

/**
 * The six developmental screening domains.
 * More granular than the activity Domain type - includes vision/hearing.
 */
export type DSSDomain =
  | 'motor'
  | 'language'
  | 'cognition'
  | 'social'
  | 'vision'
  | 'hearing';

// ─── Screening Items ────────────────────────────────────────────────────────

/**
 * A single item on the developmental screening checklist.
 * Items are organized by domain and age band.
 */
export interface DSSItem {
  readonly item_id: string;
  readonly domain: DSSDomain;
  readonly age_band: AgeBandMonths;
  readonly description: string;
  readonly is_red_flag: boolean;
}

// ─── Thresholds ─────────────────────────────────────────────────────────────

/**
 * Threshold for a screening item. If the child's score meets or exceeds
 * the cutoff_score, the associated flag fires.
 */
export interface DSSThreshold {
  readonly item_id: string;
  readonly domain: DSSDomain;
  readonly age_band: AgeBandMonths;
  readonly cutoff_score: number;
  readonly flag_description: string;
}

// ─── Verdicts ───────────────────────────────────────────────────────────────

/**
 * Final verdict from the DSS screening.
 *
 * - "typical":       No significant concerns identified.
 * - "monitor":       One concern or one red flag - schedule follow-up.
 * - "refer_to_deic": Two or more red flags - refer to District Early
 *                    Intervention Centre immediately.
 */
export type DSSVerdict = 'typical' | 'monitor' | 'refer_to_deic';

// ─── Fired Flags ────────────────────────────────────────────────────────────

/**
 * A flag that fired during screening, with human-readable context.
 * These appear in the DSS result and are displayed to the worker.
 */
export interface FiredFlag {
  readonly item_id: string;
  readonly domain: DSSDomain;
  readonly description: string;
  readonly is_red_flag: boolean;
}

// ─── DSS Result ─────────────────────────────────────────────────────────────

/**
 * Complete result of a developmental screening session.
 * Fully deterministic: same inputs always produce the same result.
 */
export interface DSSResult {
  readonly verdict: DSSVerdict;
  readonly fired_flags: FiredFlag[];
  readonly red_flag_count: number;
  readonly domain_scores: Record<DSSDomain, number>;
  readonly refer_reason?: string | undefined;
}

// ─── DSS Response (input from worker) ───────────────────────────────────────

/**
 * Worker's observation for a single screening item.
 * Score is a numeric rating; observed indicates if the item was assessable.
 */
export interface DSSResponse {
  readonly item_id: string;
  readonly score: number;
  readonly observed: boolean;
}

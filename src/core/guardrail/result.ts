/**
 * Guardrail Result Types
 * ═══════════════════════════════════════════
 * Output types from the guardrail engine evaluation. The rules_fired array
 * feeds into C1Activity.provenance.rules_fired (as rule_id strings) and
 * into the on-screen guardrail chip that Dev 1 renders.
 */

import type { RuleAction } from '../schema/index.js';

// ─── Fired Rule Entry ───────────────────────────────────────────────────────

/**
 * A single rule that fired during guardrail evaluation.
 * Contains everything needed for the UI chip and logging.
 */
export interface FiredRuleEntry {
  readonly rule_id: string;
  readonly message: string;
  readonly severity: 'block' | 'warn';
  readonly action: RuleAction;
}

// ─── Guardrail Result ───────────────────────────────────────────────────────

/**
 * Complete result of a guardrail evaluation pass.
 *
 * - passed: true if no rules fired (action = "pass").
 * - action: the most severe action among all fired rules.
 * - rules_fired: all rules that matched, with full detail.
 * - regeneration_hint: optional hint for the retry loop (Dev 2).
 */
export interface GuardrailResult {
  readonly passed: boolean;
  readonly action: 'pass' | RuleAction;
  readonly rules_fired: readonly FiredRuleEntry[];
  readonly regeneration_hint?: string | undefined;
}

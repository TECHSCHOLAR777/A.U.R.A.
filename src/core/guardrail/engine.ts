/**
 * Guardrail Engine
 * ═══════════════════════════════════════════
 * Stateless, pure evaluation engine. Takes an activity + room context +
 * rule set and returns a GuardrailResult. Same inputs → same outputs always.
 *
 * The engine is called by Dev 2 in the retrieve → guardrail → deliver
 * pipeline. Dev 2 owns the retry loop (max 2 regenerations).
 *
 * Execution flow:
 *   1. Validate activity with isC1Activity() - throw if invalid
 *   2. Build EvaluationContext from activity + room
 *   3. For each rule: check trigger match → evaluate condition → collect
 *   4. Determine overall action (most severe wins)
 *   5. Return GuardrailResult
 */

import type { C1Activity, C2Rule, AgeBandMonths, Domain, VASTParameter } from '../schema/index.js';
import { isC1Activity, ValidationError } from '../schema/index.js';
import type { RoomContext } from './condition-evaluator.js';
import { evaluateCondition, buildEvaluationContext, ageBandToMinMax } from './condition-evaluator.js';
import type { GuardrailResult, FiredRuleEntry } from './result.js';
import { getMostSevereAction } from './actions.js';

// ─── Trigger Matching ───────────────────────────────────────────────────────

/**
 * Checks whether a rule's trigger conditions match the current context.
 * A rule matches if ALL specified trigger dimensions match.
 * Unspecified trigger dimensions (undefined) are treated as "match all".
 */
function matchesTrigger(
  rule: C2Rule,
  activityAgeBand: AgeBandMonths,
  activityDomain: Domain,
  activityVAST: VASTParameter,
): boolean {
  const trigger = rule.trigger;

  // If age_bands specified, check if activity's age band is in the list
  if (trigger.age_bands !== undefined && trigger.age_bands.length > 0) {
    if (!trigger.age_bands.includes(activityAgeBand)) {
      return false;
    }
  }

  // If domains specified, check if activity's domain is in the list
  if (trigger.domains !== undefined && trigger.domains.length > 0) {
    if (!trigger.domains.includes(activityDomain)) {
      return false;
    }
  }

  // If vast_parameters specified, check if activity's VAST param is in the list
  if (trigger.vast_parameters !== undefined && trigger.vast_parameters.length > 0) {
    if (!trigger.vast_parameters.includes(activityVAST)) {
      return false;
    }
  }

  return true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluates an activity against a set of guardrail rules in a given room context.
 *
 * Pure function - stateless, idempotent. Same inputs always produce same outputs.
 *
 * @param activity - The C1Activity to evaluate. Must be valid.
 * @param room     - The room context (age mix, materials, inclusion flags).
 * @param rules    - The set of C2Rules to evaluate against.
 * @returns GuardrailResult with pass/fail, fired rules, and action.
 * @throws ValidationError if activity fails schema validation (programmer error).
 */
export function evaluate(
  activity: C1Activity,
  room: RoomContext,
  rules: readonly C2Rule[],
): GuardrailResult {
  // Step 1: Validate activity schema - throw if invalid (programmer error)
  if (!isC1Activity(activity)) {
    throw new ValidationError('C1Activity', [
      { field: '(runtime)', message: 'Activity failed schema validation at guardrail boundary', received: activity },
    ]);
  }

  // Step 2: Build evaluation context
  const ctx = buildEvaluationContext(activity, room);

  // Step 3: Evaluate each rule
  const firedRules: FiredRuleEntry[] = [];

  for (const rule of rules) {
    // 3a. Check trigger match - skip if no trigger match
    if (!matchesTrigger(
      rule,
      activity.age_band_months,
      activity.targeted_domain,
      activity.inclusion_modifications.vast_parameter,
    )) {
      continue;
    }

    // 3b. Evaluate condition
    const conditionMet = evaluateCondition(rule.condition, ctx);

    // 3c. Collect fired rule
    if (conditionMet) {
      firedRules.push({
        rule_id: rule.rule_id,
        message: rule.message,
        severity: rule.severity,
        action: rule.action,
      });
    }
  }

  // Step 4: Determine overall action
  if (firedRules.length === 0) {
    return {
      passed: true,
      action: 'pass',
      rules_fired: firedRules,
    };
  }

  // Check if any rule has "block" severity
  const hasBlock = firedRules.some((r) => r.severity === 'block');

  if (hasBlock) {
    // Most severe action among block-severity rules wins
    const blockActions = firedRules
      .filter((r) => r.severity === 'block')
      .map((r) => r.action);
    const mostSevere = getMostSevereAction(blockActions);
    const hint = firedRules
      .filter((r) => r.severity === 'block')
      .map((r) => r.message)
      .join(' | ');

    return {
      passed: false,
      action: mostSevere ?? 'block_and_substitute',
      rules_fired: firedRules,
      regeneration_hint: hint,
    };
  }

  // Only warnings fired
  const allActions = firedRules.map((r) => r.action);
  const mostSevere = getMostSevereAction(allActions);

  return {
    passed: false,
    action: mostSevere ?? 'flag_modify',
    rules_fired: firedRules,
    regeneration_hint: firedRules.map((r) => r.message).join(' | '),
  };
}

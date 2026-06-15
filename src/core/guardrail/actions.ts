/**
 * Guardrail Actions
 * ═══════════════════════════════════════════
 * Action priority and resolution utilities for the guardrail engine.
 * Determines the most severe action when multiple rules fire.
 */

import type { RuleAction } from '../schema/index.js';

/**
 * Action severity ranking (higher = more severe).
 * Used to determine the winning action when multiple rules fire.
 */
const ACTION_SEVERITY: Record<RuleAction, number> = {
  flag_modify: 1,
  reject_regenerate: 2,
  block_and_substitute: 3,
};

/**
 * Returns the more severe of two rule actions.
 */
export function resolveMostSevereAction(
  a: RuleAction,
  b: RuleAction,
): RuleAction {
  return ACTION_SEVERITY[a] >= ACTION_SEVERITY[b] ? a : b;
}

/**
 * Given an array of fired rule actions, returns the most severe one.
 * Returns undefined if the array is empty.
 */
export function getMostSevereAction(
  actions: readonly RuleAction[],
): RuleAction | undefined {
  if (actions.length === 0) return undefined;

  let most: RuleAction = actions[0]!; // Safe: we checked length > 0
  for (let i = 1; i < actions.length; i++) {
    const current = actions[i];
    if (current !== undefined) {
      most = resolveMostSevereAction(most, current);
    }
  }
  return most;
}

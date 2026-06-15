/**
 * Rule Loader
 * ═══════════════════════════════════════════
 * Entry point for loading the validated rule table. In browser/offline
 * context, rules are statically imported (no filesystem access needed).
 * All rules are validated with validateC2Rule() at load time via
 * the rules/index.ts module.
 */

import type { C2Rule } from '../schema/index.js';
import { RULE_TABLE } from '../rules/index.js';

/**
 * Loads all validated rules from the static rule table.
 * Rules are validated at module initialization time — if any rule
 * is malformed, the import will throw before this function is ever called.
 *
 * @returns An immutable array of validated C2Rule objects.
 */
export function loadRules(): readonly C2Rule[] {
  return RULE_TABLE;
}

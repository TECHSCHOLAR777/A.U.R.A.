/**
 * Rule Table — Static Rule Registry
 * ═══════════════════════════════════════════
 * Loads all 15 rule JSON files as static imports (no filesystem access needed
 * at runtime — works in browser/offline context). Each rule is validated
 * against the C2Rule schema at import time.
 *
 * If ANY rule is malformed, this module throws a startup error listing
 * all invalid rules. Fail fast at startup, not at runtime.
 */

import type { C2Rule } from '../schema/index.js';
import { validateC2Rule, ValidationError } from '../schema/index.js';

// ─── Static Rule Imports ────────────────────────────────────────────────────

import SAFE_CHOKE_01 from './SAFE_CHOKE_01.json';
import SAFE_WATER_01 from './SAFE_WATER_01.json';
import SAFE_FIRE_01 from './SAFE_FIRE_01.json';
import SAFE_SHARP_01 from './SAFE_SHARP_01.json';
import SAFE_TOXIC_01 from './SAFE_TOXIC_01.json';
import INC_ATTUNE_01 from './INC_ATTUNE_01.json';
import INC_GESTURE_01 from './INC_GESTURE_01.json';
import INC_VISUAL_01 from './INC_VISUAL_01.json';
import INC_SENSORY_LOAD_01 from './INC_SENSORY_LOAD_01.json';
import INC_LANG_01 from './INC_LANG_01.json';
import AGE_FINE_MOTOR_01 from './AGE_FINE_MOTOR_01.json';
import AGE_GROSS_MOTOR_01 from './AGE_GROSS_MOTOR_01.json';
import DSS_MOTOR_FLAG_01 from './DSS_MOTOR_FLAG_01.json';
import DSS_LANG_FLAG_01 from './DSS_LANG_FLAG_01.json';
import VAST_SAFETY_01 from './VAST_SAFETY_01.json';
import VAST_TOGETHERNESS_01 from './VAST_TOGETHERNESS_01.json';
import VAST_VISIBILITY_01 from './VAST_VISIBILITY_01.json';

// ─── Raw Rule Array ─────────────────────────────────────────────────────────

const RAW_RULES: unknown[] = [
  SAFE_CHOKE_01,
  SAFE_WATER_01,
  SAFE_FIRE_01,
  SAFE_SHARP_01,
  SAFE_TOXIC_01,
  INC_ATTUNE_01,
  INC_GESTURE_01,
  INC_VISUAL_01,
  INC_SENSORY_LOAD_01,
  INC_LANG_01,
  AGE_FINE_MOTOR_01,
  AGE_GROSS_MOTOR_01,
  DSS_MOTOR_FLAG_01,
  DSS_LANG_FLAG_01,
  VAST_SAFETY_01,
  VAST_TOGETHERNESS_01,
  VAST_VISIBILITY_01,
];

// ─── Validate All Rules at Import Time ──────────────────────────────────────

function validateAllRules(rawRules: unknown[]): C2Rule[] {
  const validated: C2Rule[] = [];
  const malformed: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < rawRules.length; i++) {
    try {
      const rule = validateC2Rule(rawRules[i]);
      validated.push(rule);
    } catch (e: unknown) {
      if (e instanceof ValidationError) {
        malformed.push({ index: i, error: e.message });
      } else {
        malformed.push({
          index: i,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (malformed.length > 0) {
    const details = malformed
      .map((m) => `  Rule[${m.index}]: ${m.error}`)
      .join('\n');
    throw new Error(
      `STARTUP ERROR: ${malformed.length} malformed rule(s) detected:\n${details}`,
    );
  }

  return validated;
}

// ─── Exported Rule Table ────────────────────────────────────────────────────

/**
 * The validated, immutable rule table. Loaded and validated once at module
 * initialization. If any rule is malformed, the module fails to load.
 */
export const RULE_TABLE: readonly C2Rule[] = validateAllRules(RAW_RULES);

/**
 * Lookup a rule by its ID. Returns undefined if not found.
 */
export function getRuleById(ruleId: string): C2Rule | undefined {
  return RULE_TABLE.find((r) => r.rule_id === ruleId);
}

/**
 * Get all rules of a specific type.
 */
export function getRulesByType(type: C2Rule['type']): readonly C2Rule[] {
  return RULE_TABLE.filter((r) => r.type === type);
}

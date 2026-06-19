/**
 * C2 Rule Schema Contract
 * ═══════════════════════════════════════════
 * Defines the typed condition DSL and rule structure used by the guardrail
 * engine. Rules use discriminated unions for conditions — NEVER string
 * expressions or eval(). Every rule is validated at load time.
 *
 * This file is a FROZEN CONTRACT — changes require sign-off from all devs.
 */

import type { AgeBandMonths, Domain, VASTParameter, FieldError } from './activity.schema.js';
import { ValidationError } from './activity.schema.js';

// ─── Condition DSL (discriminated union) ────────────────────────────────────

export type ConditionNode =
  | MaterialCheckCondition
  | AgeCheckCondition
  | FlagCheckCondition
  | VASTCheckCondition
  | DomainCheckCondition
  | CompoundAndCondition
  | CompoundOrCondition
  | CompoundNotCondition;

export interface MaterialCheckCondition {
  readonly type: 'material_check';
  readonly operator: 'in' | 'not_in';
  readonly values: string[];
}

export interface AgeCheckCondition {
  readonly type: 'age_check';
  readonly operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  readonly field: 'min_age_months' | 'max_age_months';
  readonly value: number;
}

export interface FlagCheckCondition {
  readonly type: 'flag_check';
  readonly flag: 'mobility_impaired' | 'non_verbal' | 'selective_mutism' | 'motor_delay' | 'visual_impaired' | 'shy';
  readonly present: boolean;
}

export interface VASTCheckCondition {
  readonly type: 'vast_check';
  readonly parameter: VASTParameter;
}

export interface DomainCheckCondition {
  readonly type: 'domain_check';
  readonly domain: Domain;
}

export interface CompoundAndCondition {
  readonly type: 'compound_and';
  readonly conditions: ConditionNode[];
}

export interface CompoundOrCondition {
  readonly type: 'compound_or';
  readonly conditions: ConditionNode[];
}

export interface CompoundNotCondition {
  readonly type: 'compound_not';
  readonly condition: ConditionNode;
}

// ─── Rule Types ─────────────────────────────────────────────────────────────

export type RuleAction = 'reject_regenerate' | 'flag_modify' | 'block_and_substitute';
export type RuleType = 'safety' | 'inclusion' | 'age_appropriateness' | 'dss_interaction';

export interface C2Rule {
  readonly rule_id: string;
  readonly type: RuleType;
  readonly description: string;
  readonly trigger: {
    readonly age_bands?: AgeBandMonths[];
    readonly domains?: Domain[];
    readonly vast_parameters?: VASTParameter[];
  };
  readonly condition: ConditionNode;
  readonly action: RuleAction;
  readonly message: string;
  readonly severity: 'block' | 'warn';
}

// ─── Canonical Value Sets ───────────────────────────────────────────────────

const VALID_CONDITION_TYPES: ReadonlySet<string> = new Set([
  'material_check', 'age_check', 'flag_check', 'vast_check',
  'domain_check', 'compound_and', 'compound_or', 'compound_not',
]);

const VALID_MATERIAL_OPS: ReadonlySet<string> = new Set(['in', 'not_in']);
const VALID_AGE_OPS: ReadonlySet<string> = new Set(['lt', 'lte', 'gt', 'gte', 'eq']);
const VALID_AGE_FIELDS: ReadonlySet<string> = new Set(['min_age_months', 'max_age_months']);
const VALID_FLAGS: ReadonlySet<string> = new Set([
  'mobility_impaired', 'non_verbal', 'selective_mutism', 'motor_delay', 'visual_impaired', 'shy',
]);
const VALID_VAST_PARAMS: ReadonlySet<string> = new Set([
  'visibility', 'attunement', 'safety', 'togetherness', 'none',
]);
const VALID_DOMAINS: ReadonlySet<string> = new Set([
  'cognitive', 'language', 'motor_physical', 'socio_emotional', 'creative',
]);
const VALID_AGE_BANDS: ReadonlySet<string> = new Set([
  '0-3', '3-6', '6-9', '9-12', '12-18', '18-24', '24-36',
]);
const VALID_RULE_ACTIONS: ReadonlySet<string> = new Set([
  'reject_regenerate', 'flag_modify', 'block_and_substitute',
]);
const VALID_RULE_TYPES: ReadonlySet<string> = new Set([
  'safety', 'inclusion', 'age_appropriateness', 'dss_interaction',
]);
const VALID_SEVERITIES: ReadonlySet<string> = new Set(['block', 'warn']);

// ─── Condition Validation ───────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function validateConditionNode(
  node: unknown,
  path: string,
  errors: FieldError[],
): void {
  if (!isRecord(node)) {
    errors.push({ field: path, message: 'Expected an object', received: node });
    return;
  }

  const nodeType = node['type'];
  if (typeof nodeType !== 'string' || !VALID_CONDITION_TYPES.has(nodeType)) {
    errors.push({
      field: `${path}.type`,
      message: `Invalid condition type. Expected one of: ${[...VALID_CONDITION_TYPES].join(', ')}`,
      received: nodeType,
    });
    return; // Can't validate further without knowing the type
  }

  switch (nodeType) {
    case 'material_check': {
      const op = node['operator'];
      if (typeof op !== 'string' || !VALID_MATERIAL_OPS.has(op)) {
        errors.push({
          field: `${path}.operator`,
          message: `Expected "in" or "not_in"`,
          received: op,
        });
      }
      const vals = node['values'];
      if (!Array.isArray(vals) || vals.length === 0) {
        errors.push({
          field: `${path}.values`,
          message: 'Expected non-empty string array',
          received: vals,
        });
      } else {
        for (let i = 0; i < vals.length; i++) {
          if (typeof vals[i] !== 'string') {
            errors.push({
              field: `${path}.values[${i}]`,
              message: `Expected string, got ${typeof vals[i]}`,
              received: vals[i],
            });
          }
        }
      }
      break;
    }
    case 'age_check': {
      const op = node['operator'];
      if (typeof op !== 'string' || !VALID_AGE_OPS.has(op)) {
        errors.push({
          field: `${path}.operator`,
          message: `Expected one of: ${[...VALID_AGE_OPS].join(', ')}`,
          received: op,
        });
      }
      const field = node['field'];
      if (typeof field !== 'string' || !VALID_AGE_FIELDS.has(field)) {
        errors.push({
          field: `${path}.field`,
          message: `Expected "min_age_months" or "max_age_months"`,
          received: field,
        });
      }
      const val = node['value'];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        errors.push({
          field: `${path}.value`,
          message: 'Expected finite number',
          received: val,
        });
      }
      break;
    }
    case 'flag_check': {
      const flag = node['flag'];
      if (typeof flag !== 'string' || !VALID_FLAGS.has(flag)) {
        errors.push({
          field: `${path}.flag`,
          message: `Expected one of: ${[...VALID_FLAGS].join(', ')}`,
          received: flag,
        });
      }
      const present = node['present'];
      if (typeof present !== 'boolean') {
        errors.push({
          field: `${path}.present`,
          message: `Expected boolean, got ${typeof present}`,
          received: present,
        });
      }
      break;
    }
    case 'vast_check': {
      const param = node['parameter'];
      if (typeof param !== 'string' || !VALID_VAST_PARAMS.has(param)) {
        errors.push({
          field: `${path}.parameter`,
          message: `Expected one of: ${[...VALID_VAST_PARAMS].join(', ')}`,
          received: param,
        });
      }
      break;
    }
    case 'domain_check': {
      const domain = node['domain'];
      if (typeof domain !== 'string' || !VALID_DOMAINS.has(domain)) {
        errors.push({
          field: `${path}.domain`,
          message: `Expected one of: ${[...VALID_DOMAINS].join(', ')}`,
          received: domain,
        });
      }
      break;
    }
    case 'compound_and':
    case 'compound_or': {
      const conditions = node['conditions'];
      if (!Array.isArray(conditions) || conditions.length === 0) {
        errors.push({
          field: `${path}.conditions`,
          message: 'Expected non-empty array of conditions',
          received: conditions,
        });
      } else {
        for (let i = 0; i < conditions.length; i++) {
          validateConditionNode(conditions[i], `${path}.conditions[${i}]`, errors);
        }
      }
      break;
    }
    case 'compound_not': {
      const condition = node['condition'];
      if (condition === undefined || condition === null) {
        errors.push({
          field: `${path}.condition`,
          message: 'Expected a condition node',
          received: condition,
        });
      } else {
        validateConditionNode(condition, `${path}.condition`, errors);
      }
      break;
    }
  }
}

// ─── Public Validator ───────────────────────────────────────────────────────

/**
 * Validates an unknown object against the C2Rule schema.
 * Throws ValidationError listing ALL field failures, not just the first.
 *
 * @param obj - The unknown value to validate.
 * @returns A validated C2Rule.
 * @throws ValidationError if the object does not conform.
 */
export function validateC2Rule(obj: unknown): C2Rule {
  const errors: FieldError[] = [];

  if (!isRecord(obj)) {
    throw new ValidationError('C2Rule', [
      { field: '(root)', message: 'Expected an object', received: obj },
    ]);
  }

  // rule_id: must match PREFIX_CATEGORY_NN pattern
  const ruleId = obj['rule_id'];
  if (typeof ruleId !== 'string' || ruleId.length === 0) {
    errors.push({
      field: 'rule_id',
      message: 'Expected non-empty string',
      received: ruleId,
    });
  }

  // type
  const rType = obj['type'];
  if (typeof rType !== 'string' || !VALID_RULE_TYPES.has(rType)) {
    errors.push({
      field: 'type',
      message: `Expected one of: ${[...VALID_RULE_TYPES].join(', ')}`,
      received: rType,
    });
  }

  // description
  const desc = obj['description'];
  if (typeof desc !== 'string' || desc.length === 0) {
    errors.push({
      field: 'description',
      message: 'Expected non-empty string',
      received: desc,
    });
  }

  // trigger (optional sub-fields)
  const trigger = obj['trigger'];
  if (!isRecord(trigger)) {
    errors.push({
      field: 'trigger',
      message: 'Expected an object',
      received: trigger,
    });
  } else {
    const ageBands = trigger['age_bands'];
    if (ageBands !== undefined) {
      if (!Array.isArray(ageBands)) {
        errors.push({
          field: 'trigger.age_bands',
          message: 'Expected array',
          received: ageBands,
        });
      } else {
        for (let i = 0; i < ageBands.length; i++) {
          if (typeof ageBands[i] !== 'string' || !VALID_AGE_BANDS.has(ageBands[i] as string)) {
            errors.push({
              field: `trigger.age_bands[${i}]`,
              message: `Invalid age band`,
              received: ageBands[i],
            });
          }
        }
      }
    }

    const domains = trigger['domains'];
    if (domains !== undefined) {
      if (!Array.isArray(domains)) {
        errors.push({
          field: 'trigger.domains',
          message: 'Expected array',
          received: domains,
        });
      } else {
        for (let i = 0; i < domains.length; i++) {
          if (typeof domains[i] !== 'string' || !VALID_DOMAINS.has(domains[i] as string)) {
            errors.push({
              field: `trigger.domains[${i}]`,
              message: `Invalid domain`,
              received: domains[i],
            });
          }
        }
      }
    }

    const vastParams = trigger['vast_parameters'];
    if (vastParams !== undefined) {
      if (!Array.isArray(vastParams)) {
        errors.push({
          field: 'trigger.vast_parameters',
          message: 'Expected array',
          received: vastParams,
        });
      } else {
        for (let i = 0; i < vastParams.length; i++) {
          if (typeof vastParams[i] !== 'string' || !VALID_VAST_PARAMS.has(vastParams[i] as string)) {
            errors.push({
              field: `trigger.vast_parameters[${i}]`,
              message: `Invalid VAST parameter`,
              received: vastParams[i],
            });
          }
        }
      }
    }
  }

  // condition (recursive)
  const condition = obj['condition'];
  validateConditionNode(condition, 'condition', errors);

  // action
  const action = obj['action'];
  if (typeof action !== 'string' || !VALID_RULE_ACTIONS.has(action)) {
    errors.push({
      field: 'action',
      message: `Expected one of: ${[...VALID_RULE_ACTIONS].join(', ')}`,
      received: action,
    });
  }

  // message
  const message = obj['message'];
  if (typeof message !== 'string' || message.length === 0) {
    errors.push({
      field: 'message',
      message: 'Expected non-empty string',
      received: message,
    });
  }

  // severity
  const severity = obj['severity'];
  if (typeof severity !== 'string' || !VALID_SEVERITIES.has(severity)) {
    errors.push({
      field: 'severity',
      message: `Expected "block" or "warn"`,
      received: severity,
    });
  }

  if (errors.length > 0) {
    throw new ValidationError('C2Rule', errors);
  }

  return obj as C2Rule;
}

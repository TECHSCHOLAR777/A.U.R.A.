/**
 * C1 Activity Schema Contract
 * ═══════════════════════════════════════════
 * Defines the canonical activity format exchanged between Dev 2 (retrieval)
 * and Dev 1 (delivery). Every activity flowing through the pipeline must
 * conform to this schema. The guardrail engine stamps provenance metadata
 * after evaluation.
 *
 * This file is a FROZEN CONTRACT - changes require sign-off from all devs.
 */

// ─── Literal Union Types ────────────────────────────────────────────────────

export type AgeBandMonths =
  | '0-3'
  | '3-6'
  | '6-9'
  | '9-12'
  | '12-18'
  | '18-24'
  | '24-36';

export type Domain =
  | 'cognitive'
  | 'language'
  | 'motor_physical'
  | 'socio_emotional'
  | 'creative';

export type ActivitySource =
  | 'cloud_llm'
  | 'local_template'
  | 'last_cache'
  | 'safe_default'
  | 'official_unmodified';

export type VASTParameter =
  | 'visibility'
  | 'attunement'
  | 'safety'
  | 'togetherness'
  | 'none';

export type FallbackTier =
  | 'none'
  | 'last_cache'
  | 'safe_default'
  | 'official';

// ─── C1Activity Interface ───────────────────────────────────────────────────

export interface C1Activity {
  schema_version: '1.0';
  activity_id: string;
  source: ActivitySource;
  targeted_domain: Domain;
  age_band_months: AgeBandMonths;
  milestone_targeted: string;
  adapted_title: string;
  step_by_step_instructions: string[];
  required_materials: string[];
  safety_guard_applied: boolean;
  inclusion_modifications: {
    vast_parameter: VASTParameter;
    instruction_override: string;
  };
  provenance: {
    generated_offline: boolean;
    rules_fired: string[];
    cache_key: string;
    fallback_tier: FallbackTier;
  };
}

// ─── Validation Infrastructure ──────────────────────────────────────────────

/** Describes a single validation failure on a specific field path. */
export interface FieldError {
  readonly field: string;
  readonly message: string;
  readonly received: unknown;
}

/**
 * Thrown when schema validation fails. Collects ALL field errors before
 * throwing so callers can surface every mismatch in a single pass.
 */
export class ValidationError extends Error {
  public readonly fieldErrors: readonly FieldError[];

  constructor(schemaName: string, fieldErrors: readonly FieldError[]) {
    const summary = fieldErrors
      .map((e) => `  • ${e.field}: ${e.message}`)
      .join('\n');
    super(`${schemaName} validation failed:\n${summary}`);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

// ─── Canonical Value Sets ───────────────────────────────────────────────────

const VALID_AGE_BANDS: ReadonlySet<string> = new Set<AgeBandMonths>([
  '0-3', '3-6', '6-9', '9-12', '12-18', '18-24', '24-36',
]);

const VALID_DOMAINS: ReadonlySet<string> = new Set<Domain>([
  'cognitive', 'language', 'motor_physical', 'socio_emotional', 'creative',
]);

const VALID_SOURCES: ReadonlySet<string> = new Set<ActivitySource>([
  'cloud_llm', 'local_template', 'last_cache', 'safe_default', 'official_unmodified',
]);

const VALID_VAST_PARAMS: ReadonlySet<string> = new Set<VASTParameter>([
  'visibility', 'attunement', 'safety', 'togetherness', 'none',
]);

const VALID_FALLBACK_TIERS: ReadonlySet<string> = new Set<FallbackTier>([
  'none', 'last_cache', 'safe_default', 'official',
]);

// ─── Validation Helpers ─────────────────────────────────────────────────────

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function checkStringField(
  errors: FieldError[],
  obj: Record<string, unknown>,
  field: string,
  validSet?: ReadonlySet<string>,
): void {
  const val = obj[field];
  if (typeof val !== 'string') {
    errors.push({ field, message: `Expected string, got ${typeof val}`, received: val });
    return;
  }
  if (validSet && !validSet.has(val)) {
    errors.push({
      field,
      message: `Invalid value "${val}". Expected one of: ${[...validSet].join(', ')}`,
      received: val,
    });
  }
}

function checkStringArrayField(
  errors: FieldError[],
  obj: Record<string, unknown>,
  field: string,
  minLength: number = 0,
): void {
  const val = obj[field];
  if (!Array.isArray(val)) {
    errors.push({ field, message: `Expected array, got ${typeof val}`, received: val });
    return;
  }
  if (val.length < minLength) {
    errors.push({
      field,
      message: `Expected at least ${minLength} element(s), got ${val.length}`,
      received: val,
    });
    return;
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== 'string') {
      errors.push({
        field: `${field}[${i}]`,
        message: `Expected string, got ${typeof val[i]}`,
        received: val[i],
      });
    }
  }
}

function checkBooleanField(
  errors: FieldError[],
  obj: Record<string, unknown>,
  field: string,
): void {
  const val = obj[field];
  if (typeof val !== 'boolean') {
    errors.push({ field, message: `Expected boolean, got ${typeof val}`, received: val });
  }
}

// ─── Public Validators ──────────────────────────────────────────────────────

/**
 * Validates an unknown object against the C1Activity schema.
 * Throws ValidationError listing ALL field failures, not just the first.
 *
 * @param obj - The unknown value to validate.
 * @returns A validated C1Activity.
 * @throws ValidationError if the object does not conform.
 */
export function validateC1(obj: unknown): C1Activity {
  const errors: FieldError[] = [];

  if (!isRecord(obj)) {
    throw new ValidationError('C1Activity', [
      { field: '(root)', message: 'Expected an object', received: obj },
    ]);
  }

  // Top-level scalar fields
  if (obj['schema_version'] !== '1.0') {
    errors.push({
      field: 'schema_version',
      message: 'Must be "1.0"',
      received: obj['schema_version'],
    });
  }

  checkStringField(errors, obj, 'activity_id');
  checkStringField(errors, obj, 'source', VALID_SOURCES);
  checkStringField(errors, obj, 'targeted_domain', VALID_DOMAINS);
  checkStringField(errors, obj, 'age_band_months', VALID_AGE_BANDS);
  checkStringField(errors, obj, 'milestone_targeted');
  checkStringField(errors, obj, 'adapted_title');

  // Arrays
  checkStringArrayField(errors, obj, 'step_by_step_instructions', 1);
  checkStringArrayField(errors, obj, 'required_materials');

  // Boolean
  checkBooleanField(errors, obj, 'safety_guard_applied');

  // Nested: inclusion_modifications
  const incMod = obj['inclusion_modifications'];
  if (!isRecord(incMod)) {
    errors.push({
      field: 'inclusion_modifications',
      message: 'Expected an object',
      received: incMod,
    });
  } else {
    checkStringField(errors, incMod, 'vast_parameter', VALID_VAST_PARAMS);
    if (typeof incMod['vast_parameter'] === 'string' && VALID_VAST_PARAMS.has(incMod['vast_parameter'])) {
      // Field exists and is valid - prefix in error output
    }
    // Re-map field names for nested object clarity
    const vpVal = incMod['vast_parameter'];
    if (typeof vpVal !== 'string' || !VALID_VAST_PARAMS.has(vpVal)) {
      // Already reported above by checkStringField
    }
    const ioVal = incMod['instruction_override'];
    if (typeof ioVal !== 'string') {
      errors.push({
        field: 'inclusion_modifications.instruction_override',
        message: `Expected string, got ${typeof ioVal}`,
        received: ioVal,
      });
    }
  }

  // Nested: provenance
  const prov = obj['provenance'];
  if (!isRecord(prov)) {
    errors.push({
      field: 'provenance',
      message: 'Expected an object',
      received: prov,
    });
  } else {
    checkBooleanField(errors, prov, 'generated_offline');
    // Prefix errors from nested context
    const rulesVal = prov['rules_fired'];
    if (!Array.isArray(rulesVal)) {
      errors.push({
        field: 'provenance.rules_fired',
        message: `Expected array, got ${typeof rulesVal}`,
        received: rulesVal,
      });
    } else {
      for (let i = 0; i < rulesVal.length; i++) {
        if (typeof rulesVal[i] !== 'string') {
          errors.push({
            field: `provenance.rules_fired[${i}]`,
            message: `Expected string, got ${typeof rulesVal[i]}`,
            received: rulesVal[i],
          });
        }
      }
    }
    checkStringField(errors, prov, 'cache_key');
    checkStringField(errors, prov, 'fallback_tier', VALID_FALLBACK_TIERS);
  }

  if (errors.length > 0) {
    throw new ValidationError('C1Activity', errors);
  }

  return obj as C1Activity;
}

/**
 * Type guard wrapping validateC1(). Returns true if the object is a valid
 * C1Activity, false otherwise. Swallows the ValidationError.
 */
export function isC1Activity(obj: unknown): obj is C1Activity {
  try {
    validateC1(obj);
    return true;
  } catch (e: unknown) {
    if (e instanceof ValidationError) {
      return false;
    }
    throw e; // re-throw unexpected errors
  }
}

/**
 * Guardrail Condition Evaluator
 * ═══════════════════════════════════════════
 * Evaluates the typed condition DSL against an activity + room context.
 * Uses a switch dispatch over the ConditionNode discriminated union -
 * NO eval(), NO Function(), NO dynamic property access on untrusted keys.
 *
 * Every ConditionNode type has a dedicated evaluation function.
 * Compound nodes recurse. All material comparisons are case-insensitive.
 */

import type {
  ConditionNode,
  C1Activity,
  AgeBandMonths,
  VASTParameter,
  Domain,
} from '../schema/index.js';

// ─── Context Types ──────────────────────────────────────────────────────────

export type InclusionFlag =
  | 'mobility_impaired'
  | 'non_verbal'
  | 'selective_mutism'
  | 'motor_delay'
  | 'visual_impaired'
  | 'shy';

export interface RoomContext {
  readonly age_mix: ReadonlyArray<{ readonly band: AgeBandMonths; readonly count: number }>;
  readonly materials: readonly string[];
  readonly inclusion_flags: readonly InclusionFlag[];
}

export interface EvaluationContext {
  readonly activity: C1Activity;
  readonly room: RoomContext;
  readonly min_age_months: number;
  readonly max_age_months: number;
}

// ─── Age Band Conversion ────────────────────────────────────────────────────

/**
 * Converts an AgeBandMonths literal to its numeric min/max range.
 * Pure function - no side effects.
 */
export function ageBandToMinMax(band: AgeBandMonths): { min: number; max: number } {
  switch (band) {
    case '0-3': return { min: 0, max: 3 };
    case '3-6': return { min: 3, max: 6 };
    case '6-9': return { min: 6, max: 9 };
    case '9-12': return { min: 9, max: 12 };
    case '12-18': return { min: 12, max: 18 };
    case '18-24': return { min: 18, max: 24 };
    case '24-36': return { min: 24, max: 36 };
  }
}

// ─── Build Evaluation Context ───────────────────────────────────────────────

/**
 * Constructs an EvaluationContext from an activity and room.
 * Derives min/max age from the room's age mix.
 */
export function buildEvaluationContext(
  activity: C1Activity,
  room: RoomContext,
): EvaluationContext {
  let minAge = Infinity;
  let maxAge = -Infinity;

  for (const entry of room.age_mix) {
    const range = ageBandToMinMax(entry.band);
    if (range.min < minAge) minAge = range.min;
    if (range.max > maxAge) maxAge = range.max;
  }

  // Fallback: if room has no children, use the activity's age band
  if (!Number.isFinite(minAge) || !Number.isFinite(maxAge)) {
    const activityRange = ageBandToMinMax(activity.age_band_months);
    minAge = activityRange.min;
    maxAge = activityRange.max;
  }

  return { activity, room, min_age_months: minAge, max_age_months: maxAge };
}

// ─── Individual Condition Evaluators ────────────────────────────────────────

function evaluateMaterialCheck(
  operator: 'in' | 'not_in',
  values: readonly string[],
  ctx: EvaluationContext,
): boolean {
  const normalizedValues = values.map((v) => v.toLowerCase().trim());
  const activityMaterials = ctx.activity.required_materials.map((m) =>
    m.toLowerCase().trim(),
  );
  const roomMaterials = ctx.room.materials.map((m) => m.toLowerCase().trim());
  const allMaterials = [...activityMaterials, ...roomMaterials];

  if (operator === 'in') {
    // True if ANY value is found in the combined material list
    return normalizedValues.some((v) => allMaterials.includes(v));
  }
  // 'not_in': True if NONE of the values are found
  return !normalizedValues.some((v) => allMaterials.includes(v));
}

function evaluateAgeCheck(
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq',
  field: 'min_age_months' | 'max_age_months',
  value: number,
  ctx: EvaluationContext,
): boolean {
  const actual = field === 'min_age_months' ? ctx.min_age_months : ctx.max_age_months;

  switch (operator) {
    case 'lt': return actual < value;
    case 'lte': return actual <= value;
    case 'gt': return actual > value;
    case 'gte': return actual >= value;
    case 'eq': return actual === value;
  }
}

function evaluateFlagCheck(
  flag: 'mobility_impaired' | 'non_verbal' | 'selective_mutism' | 'motor_delay' | 'visual_impaired' | 'shy',
  present: boolean,
  ctx: EvaluationContext,
): boolean {
  const hasFlag = (ctx.room.inclusion_flags as string[]).includes(flag);
  return hasFlag === present;
}

function evaluateVASTCheck(
  parameter: VASTParameter,
  ctx: EvaluationContext,
): boolean {
  return ctx.activity.inclusion_modifications.vast_parameter === parameter;
}

function evaluateDomainCheck(
  domain: Domain,
  ctx: EvaluationContext,
): boolean {
  return ctx.activity.targeted_domain === domain;
}

// ─── Main Evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluates a ConditionNode tree against an EvaluationContext.
 * Pure function - no side effects, fully deterministic.
 *
 * @param node - The condition tree root.
 * @param ctx  - The evaluation context (activity + room derived data).
 * @returns true if the condition is satisfied, false otherwise.
 */
export function evaluateCondition(
  node: ConditionNode,
  ctx: EvaluationContext,
): boolean {
  switch (node.type) {
    case 'material_check':
      return evaluateMaterialCheck(node.operator, node.values, ctx);

    case 'age_check':
      return evaluateAgeCheck(node.operator, node.field, node.value, ctx);

    case 'flag_check':
      return evaluateFlagCheck(node.flag, node.present, ctx);

    case 'vast_check':
      return evaluateVASTCheck(node.parameter, ctx);

    case 'domain_check':
      return evaluateDomainCheck(node.domain, ctx);

    case 'compound_and':
      return node.conditions.every((child) => evaluateCondition(child, ctx));

    case 'compound_or':
      return node.conditions.some((child) => evaluateCondition(child, ctx));

    case 'compound_not':
      return !evaluateCondition(node.condition, ctx);
  }
}

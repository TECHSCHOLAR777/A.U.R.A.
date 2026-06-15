/**
 * Schema Barrel Export
 * ═══════════════════════════════════════════
 * Single import point for all schema contracts.
 *
 * Usage by other devs:
 *   import { C1Activity, validateC1, C2Rule, ... } from '@/core/schema';
 */

// ─── Activity Schema (C1) ───────────────────────────────────────────────────
export type {
  AgeBandMonths,
  Domain,
  ActivitySource,
  VASTParameter,
  FallbackTier,
  C1Activity,
  FieldError,
} from './activity.schema.js';

export {
  ValidationError,
  validateC1,
  isC1Activity,
} from './activity.schema.js';

// ─── Rule Schema (C2) ──────────────────────────────────────────────────────
export type {
  ConditionNode,
  MaterialCheckCondition,
  AgeCheckCondition,
  FlagCheckCondition,
  VASTCheckCondition,
  DomainCheckCondition,
  CompoundAndCondition,
  CompoundOrCondition,
  CompoundNotCondition,
  RuleAction,
  RuleType,
  C2Rule,
} from './rule.schema.js';

export { validateC2Rule } from './rule.schema.js';

// ─── BKT Schema ─────────────────────────────────────────────────────────────
export type {
  ChildMasteryState,
  BKTParams,
  TapOutcome,
  MilestonePrior,
  RoomAggregate,
} from './bkt.schema.js';

// ─── DSS Schema ─────────────────────────────────────────────────────────────
export type {
  DSSDomain,
  DSSItem,
  DSSThreshold,
  DSSVerdict,
  FiredFlag,
  DSSResult,
  DSSResponse,
} from './dss.schema.js';

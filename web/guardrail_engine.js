/**
 * guardrail_engine.js
 * Deterministic symbolic rule validator for the AURA PWA.
 *
 * Checks every activity candidate against a fixed catalogue of 15 safety
 * and inclusion rules before delivery to the AWW. Returns a structured
 * ValidationResult — never throws under any input.
 *
 * Export surface:
 *   GuardrailEngine  {object}  — public API (validate, getRules)
 *
 * Satisfies Req 5.1–5.9, 6.1–6.15, 11.3, 11.9
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hasAny — Returns true if `arr` contains at least one of the given `values`.
 * Gracefully handles non-array inputs by treating them as empty.
 *
 * @param {*}        arr    — The array to test (e.g. activity.materials)
 * @param {string[]} values — Values to look for
 * @returns {boolean}
 */
function hasAny(arr, values) {
  if (!Array.isArray(arr)) return false;
  return values.some(v => arr.includes(v));
}

/**
 * anyProfile — Returns true if any profile in the array satisfies the predicate.
 * Gracefully handles non-array inputs.
 *
 * @param {*}        profiles  — Array of ChildProfile objects
 * @param {Function} predicate — (profile) => boolean
 * @returns {boolean}
 */
function anyProfile(profiles, predicate) {
  if (!Array.isArray(profiles)) return false;
  return profiles.some(predicate);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule catalogue — 15 rules, Order matches the spec exactly.
// Each rule object is frozen individually; the array itself is also frozen.
// Satisfies Req 5.9, 6.1–6.15
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'reject_regenerate' | 'block_and_substitute' | 'flag_modify'} RuleAction
 * @typedef {'safety' | 'inclusion'} RuleType
 *
 * @typedef {Object} GuardrailRule
 * @property {string}     rule_id
 * @property {RuleType}   type
 * @property {string}     trigger
 * @property {Function}   condition  — (activity, profiles) => boolean
 * @property {RuleAction} action
 * @property {string}     message
 */

const _rules = Object.freeze([

  // ── Safety rules ───────────────────────────────────────────────────────────

  /**
   * SAFE_CHOKE_01
   * Small objects (pebbles/beads) + any child < 36 months → choking hazard
   * Satisfies Req 6.1
   */
  Object.freeze({
    rule_id:   'SAFE_CHOKE_01',
    type:      'safety',
    trigger:   'Activity uses small objects (pebbles/beads) AND child age < 36 months',
    condition: (activity, profiles) =>
      hasAny(activity.materials, ['pebbles', 'beads']) &&
      anyProfile(profiles, p => p.age_months < 36),
    action:  'reject_regenerate',
    message: 'Activity contains small objects (pebbles/beads) — choking hazard for children under 36 months.',
  }),

  /**
   * SAFE_CHOKE_02
   * choking_hazard flag + any child < 48 months
   * Satisfies Req 6.2
   */
  Object.freeze({
    rule_id:   'SAFE_CHOKE_02',
    type:      'safety',
    trigger:   'choking_hazard: true AND any child < 48 months',
    condition: (activity, profiles) =>
      activity.choking_hazard === true &&
      anyProfile(profiles, p => p.age_months < 48),
    action:  'reject_regenerate',
    message: 'Activity flagged as choking hazard — not safe for children under 48 months.',
  }),

  /**
   * SAFE_FALL_01
   * Climbing/jumping + any child flagged mobility_impaired
   * Satisfies Req 6.3
   */
  Object.freeze({
    rule_id:   'SAFE_FALL_01',
    type:      'safety',
    trigger:   'Activity involves climbing/jumping AND any child flagged mobility_impaired',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['climb', 'climbing', 'jump', 'jumping']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('mobility_impaired')),
    action:  'block_and_substitute',
    message: 'Activity involves climbing or jumping — substitute required for mobility-impaired children.',
  }),

  /**
   * SAFE_WATER_01
   * Water keyword + no adult_supervision inclusion tag
   * Satisfies Req 6.4
   */
  Object.freeze({
    rule_id:   'SAFE_WATER_01',
    type:      'safety',
    trigger:   'Activity involves water container AND no adult supervision tag',
    condition: (activity, _profiles) =>
      hasAny(activity.keywords, ['water']) &&
      !hasAny(activity.inclusion_tags, ['adult_supervision']),
    action:  'flag_modify',
    message: 'Activity involves water — adult supervision required.',
  }),

  /**
   * SAFE_SHARP_01
   * Sharp materials + any child < 36 months
   * Satisfies Req 6.5
   */
  Object.freeze({
    rule_id:   'SAFE_SHARP_01',
    type:      'safety',
    trigger:   'Activity involves sharp materials AND child < 36 months',
    condition: (activity, profiles) =>
      hasAny(activity.materials, ['scissors', 'cutting_sticks', 'knife']) &&
      anyProfile(profiles, p => p.age_months < 36),
    action:  'reject_regenerate',
    message: 'Activity involves sharp materials — not safe for children under 36 months.',
  }),

  // ── Inclusion rules ────────────────────────────────────────────────────────

  /**
   * INC_ATTUNE_01
   * Verbal-response keywords + any child flagged non_verbal
   * Satisfies Req 6.6
   */
  Object.freeze({
    rule_id:   'INC_ATTUNE_01',
    type:      'inclusion',
    trigger:   'Activity requires verbal response AND any child flagged non_verbal',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['speak', 'tell', 'say', 'name', 'describe']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('non_verbal')),
    action:  'flag_modify',
    message: 'Activity requires verbal response — adaptation needed for non-verbal children.',
  }),

  /**
   * INC_ATTUNE_02
   * Group participation keywords + any child flagged selective_mutism
   * Satisfies Req 6.7
   */
  Object.freeze({
    rule_id:   'INC_ATTUNE_02',
    type:      'inclusion',
    trigger:   'Activity requires group participation AND any child flagged selective_mutism',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['group', 'together', 'share', 'take turns']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('selective_mutism')),
    action:  'flag_modify',
    message: 'Activity requires group participation — adaptation needed for children with selective mutism.',
  }),

  /**
   * INC_MOTOR_01
   * Fine motor grip keywords + any child flagged motor_delay
   * Satisfies Req 6.8
   */
  Object.freeze({
    rule_id:   'INC_MOTOR_01',
    type:      'inclusion',
    trigger:   'Activity requires fine motor grip AND any child flagged motor_delay',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['grip', 'pinch', 'fold', 'tear', 'press', 'roll']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('motor_delay')),
    action:  'flag_modify',
    message: 'Activity requires fine motor skills — adaptation needed for children with motor delay.',
  }),

  /**
   * INC_MOTOR_02
   * Locomotion keywords + any child flagged mobility_impaired
   * Satisfies Req 6.9
   */
  Object.freeze({
    rule_id:   'INC_MOTOR_02',
    type:      'inclusion',
    trigger:   'Activity requires locomotion AND any child flagged mobility_impaired',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['walk', 'run', 'hop', 'jump', 'move', 'balance']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('mobility_impaired')),
    action:  'block_and_substitute',
    message: 'Activity requires locomotion — substitute required for mobility-impaired children.',
  }),

  /**
   * INC_VISUAL_01
   * Purely visual activity (no tactile/audio accommodation) + any child flagged visual_impaired
   * Satisfies Req 6.10
   */
  Object.freeze({
    rule_id:   'INC_VISUAL_01',
    type:      'inclusion',
    trigger:   'Activity is purely visual (no tactile/audio cues) AND any child flagged visual_impaired',
    condition: (activity, profiles) => {
      // The rule fires when there is NO tactile/audio accommodation available.
      const hasTactileOrAudio =
        hasAny(activity.inclusion_tags, ['visual_impaired_ok', 'visual_impaired_partial']) ||
        hasAny(activity.keywords,       ['touch', 'feel', 'sound', 'listen']);
      return (
        !hasTactileOrAudio &&
        anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('visual_impaired'))
      );
    },
    action:  'flag_modify',
    message: 'Activity is purely visual with no tactile or audio cues — adaptation needed for visually impaired children.',
  }),

  /**
   * INC_LANG_01
   * Activity lingua_franca is Hindi (or absent/defaulting to Hindi) AND room lingua_franca differs
   * Satisfies Req 6.11
   */
  Object.freeze({
    rule_id:   'INC_LANG_01',
    type:      'inclusion',
    trigger:   "Activity language assumes Hindi AND room lingua_franca differs",
    condition: (activity, profiles) => {
      // If activity.lingua_franca is absent, default to 'hindi'.
      const activityLang = (activity.lingua_franca && typeof activity.lingua_franca === 'string')
        ? activity.lingua_franca
        : 'hindi';
      if (activityLang !== 'hindi') return false;

      // Check if the first profile with an explicit lingua_franca differs from 'hindi'.
      if (!Array.isArray(profiles) || profiles.length === 0) return false;
      const firstWithLang = profiles[0];
      return (
        firstWithLang.lingua_franca !== undefined &&
        firstWithLang.lingua_franca !== 'hindi'
      );
    },
    action:  'flag_modify',
    message: 'Activity instructions are in Hindi — language adaptation may be needed.',
  }),

  /**
   * INC_SHY_01
   * Solo public performance keywords + any child flagged shy
   * Satisfies Req 6.12
   */
  Object.freeze({
    rule_id:   'INC_SHY_01',
    type:      'inclusion',
    trigger:   'Activity requires solo public performance AND any child flagged shy',
    condition: (activity, profiles) =>
      hasAny(activity.keywords, ['perform', 'introduce', 'present', 'solo']) &&
      anyProfile(profiles, p => Array.isArray(p.needs) && p.needs.includes('shy')),
    action:  'flag_modify',
    message: 'Activity requires solo public performance — adaptation needed for shy children.',
  }),

  // ── Curriculum rules ───────────────────────────────────────────────────────

  /**
   * CURR_SEQ_01
   * Room prerequisite mastery < 0.50 — only fires when roomAggregate is present.
   * If activity.roomAggregate is absent or null the condition returns false (pass).
   * Satisfies Req 6.13 and sub-task 4.6
   */
  Object.freeze({
    rule_id:   'CURR_SEQ_01',
    type:      'safety',
    trigger:   'Activity targets node N AND room aggregate for prerequisite < 0.50 avg_p_mastery',
    condition: (activity, _profiles) => {
      // Sub-task 4.6: absent or null roomAggregate → do not fire (safe default).
      if (activity.roomAggregate == null) return false;
      const agg = activity.roomAggregate;
      return (
        typeof agg.avg_p_mastery === 'number' &&
        agg.avg_p_mastery < 0.50
      );
    },
    action:  'flag_modify',
    message: 'Room prerequisite mastery is below 50% — consider reviewing the prerequisite node first.',
  }),

  /**
   * CURR_AGE_01
   * Activity age_band_months does not overlap with any child in the room.
   * Absent/invalid age_band_months → do not fire (pass).
   * Satisfies Req 6.14
   */
  Object.freeze({
    rule_id:   'CURR_AGE_01',
    type:      'safety',
    trigger:   'Activity age_band does not overlap with any child in the room',
    condition: (activity, profiles) => {
      if (typeof activity.age_band_months !== 'string') return false;
      const parts = activity.age_band_months.split('-');
      if (parts.length !== 2) return false;
      const min = parseInt(parts[0], 10);
      const max = parseInt(parts[1], 10);
      if (!Number.isFinite(min) || !Number.isFinite(max)) return false;

      if (!Array.isArray(profiles) || profiles.length === 0) return false;

      // Rule fires only if NO child falls within [min, max].
      const anyInBand = profiles.some(
        p => typeof p.age_months === 'number' &&
             p.age_months >= min &&
             p.age_months <= max
      );
      return !anyInBand;
    },
    action:  'reject_regenerate',
    message: 'Activity age band does not match any child in the room.',
  }),

  /**
   * CURR_DOM_01
   * Same curriculum domain delivered 3 sessions in a row.
   * Absent activity.recent_domains → do not fire (pass).
   * Satisfies Req 6.15
   */
  Object.freeze({
    rule_id:   'CURR_DOM_01',
    type:      'inclusion',
    trigger:   'Same domain delivered 3 sessions in a row',
    condition: (activity, _profiles) => {
      if (!Array.isArray(activity.recent_domains)) return false;
      if (activity.recent_domains.length < 3) return false;
      const last3 = activity.recent_domains.slice(-3);
      return (
        typeof activity.targeted_domain === 'string' &&
        last3.every(d => d === activity.targeted_domain)
      );
    },
    action:  'flag_modify',
    message: 'Same curriculum domain delivered 3 sessions in a row — consider varying the domain.',
  }),

]); // end Object.freeze(_rules)

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 4.3 — runRules (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runRules — Core rule evaluation loop.
 *
 * Iterates the frozen rules array in order:
 * - Wraps each condition in try/catch; on error logs the rule_id and skips.
 * - Accumulates flag_modify rule IDs in rules_fired.
 * - Short-circuits on the first reject_regenerate or block_and_substitute.
 *
 * @param {object}   activity       — ActivityCandidate object
 * @param {object[]} child_profiles — Array of ChildProfile objects
 * @param {object[]} rules          — The frozen rules array
 * @returns {{ passed: boolean, rules_fired: string[], action: string|null, messages: string[] }}
 *
 * Satisfies Req 5.1–5.8
 */
function runRules(activity, child_profiles, rules) {
  const rules_fired = [];
  const messages    = [];
  let   final_action = null;
  let   passed       = true;

  for (const rule of rules) {
    let fired = false;

    try {
      fired = rule.condition(activity, child_profiles);
    } catch (err) {
      // Req 5.8: treat as not fired; log and continue.
      console.warn(
        `[guardrail_engine] Rule condition threw for rule_id="${rule.rule_id}":`,
        err && err.message ? err.message : err
      );
      continue;
    }

    if (fired) {
      rules_fired.push(rule.rule_id);
      messages.push(rule.message);

      if (rule.action === 'reject_regenerate' || rule.action === 'block_and_substitute') {
        // Hard-stop rules: mark as failed and short-circuit (Req 5.2, 5.3).
        passed       = false;
        final_action = rule.action;
        break;
      } else {
        // flag_modify: accumulate and continue (Req 5.4).
        if (final_action === null) {
          final_action = 'flag_modify';
        }
      }
    }
  }

  return { passed, rules_fired, action: final_action, messages };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 4.4 — validate (public entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validate — Public entry point for guardrail validation.
 *
 * Calls runRules and wraps everything in a top-level try/catch so it can
 * NEVER throw under any input.  Always returns a valid ValidationResult.
 *
 * @param {*} activity  — ActivityCandidate (any value safe — guarded internally)
 * @param {*} profiles  — ChildProfile[] (any value safe — guarded internally)
 * @returns {{ passed: boolean, rules_fired: string[], action: string|null, messages: string[] }}
 *
 * Satisfies Req 5.4, 5.5
 */
function validate(activity, profiles) {
  try {
    // Normalise inputs so runRules helpers don't need to guard against null.
    const safeActivity = (activity !== null && activity !== undefined && typeof activity === 'object')
      ? activity
      : {};
    const safeProfiles = Array.isArray(profiles) ? profiles : [];

    return runRules(safeActivity, safeProfiles, _rules);
  } catch (err) {
    // Last-resort catch: should never be reached due to per-rule try/catch,
    // but guarantees validate() never propagates an exception (Req 5.4).
    console.error('[guardrail_engine] Unexpected error in validate():', err);
    return {
      passed:      true,
      rules_fired: [],
      action:      null,
      messages:    [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 4.5 — getRules (public)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getRules — Return the frozen rules array reference.
 *
 * @returns {object[]}  — The immutable rules catalogue
 *
 * Satisfies Req 5.9
 */
function getRules() {
  return _rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — GuardrailEngine export (Sub-task 4.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GuardrailEngine
 *
 * The public interface for the guardrail validation system.
 * Both methods are synchronous and pure (no I/O).
 *
 * Exported as a named singleton object; no instantiation needed.
 */
export const GuardrailEngine = Object.freeze({
  validate,
  getRules,
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal function exports (for unit testing only — not part of public API)
// ─────────────────────────────────────────────────────────────────────────────

// These allow tests to exercise runRules and helper logic directly.
export { runRules, hasAny, anyProfile };

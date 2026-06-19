/**
 * DSS Items - Stub Screening Checklist Items
 * ═══════════════════════════════════════════
 * Placeholder screening items corresponding to the stub thresholds.
 * Red flags are items that, when triggered, contribute to referral decisions.
 *
 * // STUB - replace with Dev4 data on Day 2.
 */

import type { DSSItem } from '../schema/index.js';

// STUB - replace with Dev4 data on Day 2.
export const STUB_ITEMS: readonly DSSItem[] = [
  // ─── Motor ────────────────────────────────────────────────────────────
  {
    item_id: 'DSS_MOTOR_001',
    domain: 'motor',
    age_band: '0-3',
    description: 'Lifts head when placed on tummy (prone position)',
    is_red_flag: true,
  },
  {
    item_id: 'DSS_MOTOR_002',
    domain: 'motor',
    age_band: '3-6',
    description: 'Reaches for and grasps objects within arm reach',
    is_red_flag: false,
  },

  // ─── Language ─────────────────────────────────────────────────────────
  {
    item_id: 'DSS_LANG_001',
    domain: 'language',
    age_band: '0-3',
    description: 'Makes cooing sounds or vocalisations when spoken to',
    is_red_flag: true,
  },
  {
    item_id: 'DSS_LANG_002',
    domain: 'language',
    age_band: '3-6',
    description: 'Babbles with consonant-vowel combinations (ba-ba, da-da)',
    is_red_flag: false,
  },

  // ─── Cognition ────────────────────────────────────────────────────────
  {
    item_id: 'DSS_COG_001',
    domain: 'cognition',
    age_band: '0-3',
    description: 'Visually tracks a moving object across the visual field',
    is_red_flag: false,
  },
  {
    item_id: 'DSS_COG_002',
    domain: 'cognition',
    age_band: '3-6',
    description: 'Shows interest in exploring objects with hands and mouth',
    is_red_flag: false,
  },

  // ─── Social ───────────────────────────────────────────────────────────
  {
    item_id: 'DSS_SOC_001',
    domain: 'social',
    age_band: '0-3',
    description: 'Responds with a social smile when caregiver smiles',
    is_red_flag: true,
  },
  {
    item_id: 'DSS_SOC_002',
    domain: 'social',
    age_band: '3-6',
    description: 'Shows recognition of familiar faces with animation',
    is_red_flag: false,
  },

  // ─── Vision ───────────────────────────────────────────────────────────
  {
    item_id: 'DSS_VIS_001',
    domain: 'vision',
    age_band: '0-3',
    description: 'Makes eye contact and fixates on faces at close range',
    is_red_flag: true,
  },
  {
    item_id: 'DSS_VIS_002',
    domain: 'vision',
    age_band: '3-6',
    description: 'Tracks moving objects smoothly across the midline',
    is_red_flag: false,
  },

  // ─── Hearing ──────────────────────────────────────────────────────────
  {
    item_id: 'DSS_HEAR_001',
    domain: 'hearing',
    age_band: '0-3',
    description: 'Startles or blinks in response to loud sounds',
    is_red_flag: true,
  },
  {
    item_id: 'DSS_HEAR_002',
    domain: 'hearing',
    age_band: '3-6',
    description: 'Turns head toward the source of a sound',
    is_red_flag: false,
  },
] as const;

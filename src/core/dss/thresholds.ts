/**
 * DSS Thresholds - Stub Data
 * ═══════════════════════════════════════════
 * Placeholder thresholds covering at least 10 items across all 6 DSS domains
 * for age bands 0-3 and 3-6. These are placeholders until Dev 4 delivers
 * the real Navchetana curriculum data.
 *
 * // STUB - replace with Dev4 data on Day 2.
 */

import type { DSSThreshold } from '../schema/index.js';

// STUB - replace with Dev4 data on Day 2.
export const STUB_THRESHOLDS: readonly DSSThreshold[] = [
  // ─── Motor Domain ──────────────────────────────────────────────────────
  {
    item_id: 'DSS_MOTOR_001',
    domain: 'motor',
    age_band: '0-3',
    cutoff_score: 2,
    flag_description: 'Unable to lift head when prone by 3 months',
  },
  {
    item_id: 'DSS_MOTOR_002',
    domain: 'motor',
    age_band: '3-6',
    cutoff_score: 2,
    flag_description: 'No reaching or grasping by 5 months',
  },

  // ─── Language Domain ───────────────────────────────────────────────────
  {
    item_id: 'DSS_LANG_001',
    domain: 'language',
    age_band: '0-3',
    cutoff_score: 2,
    flag_description: 'No cooing or vocalisation by 3 months',
  },
  {
    item_id: 'DSS_LANG_002',
    domain: 'language',
    age_band: '3-6',
    cutoff_score: 2,
    flag_description: 'No babbling or consonant sounds by 6 months',
  },

  // ─── Cognition Domain ─────────────────────────────────────────────────
  {
    item_id: 'DSS_COG_001',
    domain: 'cognition',
    age_band: '0-3',
    cutoff_score: 2,
    flag_description: 'No visual tracking of objects by 3 months',
  },
  {
    item_id: 'DSS_COG_002',
    domain: 'cognition',
    age_band: '3-6',
    cutoff_score: 2,
    flag_description: 'No interest in exploring objects by 5 months',
  },

  // ─── Social Domain ────────────────────────────────────────────────────
  {
    item_id: 'DSS_SOC_001',
    domain: 'social',
    age_band: '0-3',
    cutoff_score: 2,
    flag_description: 'No social smile by 2 months',
  },
  {
    item_id: 'DSS_SOC_002',
    domain: 'social',
    age_band: '3-6',
    cutoff_score: 2,
    flag_description: 'No response to familiar faces by 5 months',
  },

  // ─── Vision Domain ────────────────────────────────────────────────────
  {
    item_id: 'DSS_VIS_001',
    domain: 'vision',
    age_band: '0-3',
    cutoff_score: 3,
    flag_description: 'No eye contact or visual fixation by 2 months',
  },

  // ─── Hearing Domain ───────────────────────────────────────────────────
  {
    item_id: 'DSS_HEAR_001',
    domain: 'hearing',
    age_band: '0-3',
    cutoff_score: 3,
    flag_description: 'No startle response to loud sounds by 1 month',
  },

  // ─── Additional items for coverage ────────────────────────────────────
  {
    item_id: 'DSS_VIS_002',
    domain: 'vision',
    age_band: '3-6',
    cutoff_score: 3,
    flag_description: 'No tracking of moving objects across midline by 4 months',
  },
  {
    item_id: 'DSS_HEAR_002',
    domain: 'hearing',
    age_band: '3-6',
    cutoff_score: 3,
    flag_description: 'No turning toward sound source by 5 months',
  },
] as const;

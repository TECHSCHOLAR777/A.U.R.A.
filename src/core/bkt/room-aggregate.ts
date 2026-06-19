/**
 * Room Aggregate — Single-Pass Room-Level Mastery Statistics
 * ═══════════════════════════════════════════════════════════════
 * Aggregates individual child mastery states into a room-level summary.
 * This is what Dev 2 feeds into the bandit context vector for activity
 * selection.
 *
 * Performance: Single pass over the children array. O(n) where n = number
 * of children. No intermediate allocations beyond the return object.
 */

import type { ChildMasteryState, AgeBandMonths, Domain } from '../schema/index.js';
import type { RoomAggregate } from '../schema/bkt.schema.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_AGE_BANDS: readonly AgeBandMonths[] = [
  '0-3', '3-6', '6-9', '9-12', '12-18', '18-24', '24-36',
];

const ALL_DOMAINS: readonly Domain[] = [
  'cognitive', 'language', 'motor_physical', 'socio_emotional', 'creative',
];

/** Domain is considered a "gap" if average mastery falls below this. */
const DOMAIN_GAP_THRESHOLD = 0.40;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Computes room-level aggregate mastery statistics from individual child states.
 *
 * Single-pass algorithm:
 *   1. Accumulate mastery sums and counts per age band and domain.
 *   2. Count off-trajectory children.
 *   3. Determine dominant band (most children).
 *   4. Identify domain gaps (avg mastery < 0.40).
 *
 * @param children - Array of all child mastery states in the room.
 *                   Can include multiple milestones per child — this function
 *                   aggregates across all of them.
 * @returns RoomAggregate for Dev 2's bandit context vector.
 */
export function getRoomAggregate(children: readonly ChildMasteryState[]): RoomAggregate {
  // Accumulators
  const bandSums: Record<string, number> = {};
  const bandCounts: Record<string, number> = {};
  const domainSums: Record<string, number> = {};
  const domainCounts: Record<string, number> = {};

  let offTrajectoryCount = 0;
  const seenOffTrajectory = new Set<string>(); // avoid double-counting per child

  // Single pass
  for (const child of children) {
    const band = child.age_band;
    const domain = child.domain;

    // Band aggregation
    bandSums[band] = (bandSums[band] ?? 0) + child.p_mastery;
    bandCounts[band] = (bandCounts[band] ?? 0) + 1;

    // Domain aggregation
    domainSums[domain] = (domainSums[domain] ?? 0) + child.p_mastery;
    domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;

    // Off-trajectory counting (per unique child)
    if (child.off_trajectory && !seenOffTrajectory.has(child.child_uuid)) {
      seenOffTrajectory.add(child.child_uuid);
      offTrajectoryCount++;
    }
  }

  // Compute mastery distribution (avg mastery per band)
  const masteryDistribution = {} as Record<AgeBandMonths, number>;
  for (const band of ALL_AGE_BANDS) {
    const sum = bandSums[band] ?? 0;
    const count = bandCounts[band] ?? 0;
    masteryDistribution[band] = count > 0 ? sum / count : 0;
  }

  // Determine dominant band (most children)
  let dominantBand: AgeBandMonths = '0-3';
  let maxCount = 0;
  for (const band of ALL_AGE_BANDS) {
    const count = bandCounts[band] ?? 0;
    if (count > maxCount) {
      maxCount = count;
      dominantBand = band;
    }
  }

  // Identify domain gaps
  const domainGaps: Domain[] = [];
  for (const domain of ALL_DOMAINS) {
    const sum = domainSums[domain] ?? 0;
    const count = domainCounts[domain] ?? 0;
    if (count > 0 && sum / count < DOMAIN_GAP_THRESHOLD) {
      domainGaps.push(domain);
    }
  }

  // Count unique children
  const uniqueChildren = new Set<string>();
  for (const child of children) {
    uniqueChildren.add(child.child_uuid);
  }

  return {
    dominant_band: dominantBand,
    mastery_distribution: masteryDistribution,
    off_trajectory_count: offTrajectoryCount,
    domain_gaps: domainGaps,
    total_children: uniqueChildren.size,
  };
}

/**
 * DSS Screener - Deterministic Developmental Screening
 * ═════════════════════════════════════════════════════════
 * Evaluates worker observations against screening thresholds to produce
 * an explainable verdict with fired flags.
 *
 * The screener NEVER throws. Missing items or thresholds are logged and
 * skipped. The result is always a complete DSSResult.
 *
 * Verdict logic:
 *   - red_flag_count >= 2 → "refer_to_deic"
 *   - red_flag_count === 1 OR any domain_score above warn threshold → "monitor"
 *   - else → "typical"
 */

import type {
  DSSResponse,
  DSSThreshold,
  DSSItem,
  DSSResult,
  DSSVerdict,
  FiredFlag,
  DSSDomain,
} from '../schema/index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_DSS_DOMAINS: readonly DSSDomain[] = [
  'motor', 'language', 'cognition', 'social', 'vision', 'hearing',
];

/** Domain score above this threshold triggers a "monitor" verdict. */
const DOMAIN_WARN_THRESHOLD = 4;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluates developmental screening responses against thresholds and items.
 * Fully deterministic: same inputs always produce the same result.
 * Never throws - unknown items are skipped with a warning.
 *
 * @param responses  - Worker observations for each screening item.
 * @param thresholds - Cutoff scores for each item (from Dev 4 or stubs).
 * @param items      - Screening item definitions (descriptions, red flags).
 * @returns A complete DSSResult with verdict, fired flags, and domain scores.
 */
export function evaluateDSS(
  responses: readonly DSSResponse[],
  thresholds: readonly DSSThreshold[],
  items: readonly DSSItem[],
): DSSResult {
  // Build lookup maps for O(1) access
  const thresholdMap = new Map<string, DSSThreshold>();
  for (const t of thresholds) {
    thresholdMap.set(t.item_id, t);
  }

  const itemMap = new Map<string, DSSItem>();
  for (const item of items) {
    itemMap.set(item.item_id, item);
  }

  // Initialize domain scores
  const domainScores: Record<string, number> = {};
  for (const domain of ALL_DSS_DOMAINS) {
    domainScores[domain] = 0;
  }

  const firedFlags: FiredFlag[] = [];
  let redFlagCount = 0;

  // Process each response
  for (const response of responses) {
    // Skip unobserved items
    if (!response.observed) {
      continue;
    }

    // Look up threshold
    const threshold = thresholdMap.get(response.item_id);
    if (threshold === undefined) {
      console.warn(
        `[DSS] No threshold found for item_id="${response.item_id}". Skipping.`,
      );
      continue;
    }

    // Look up item definition
    const item = itemMap.get(response.item_id);
    if (item === undefined) {
      console.warn(
        `[DSS] No item definition found for item_id="${response.item_id}". Skipping.`,
      );
      continue;
    }

    // Accumulate domain scores
    domainScores[item.domain] = (domainScores[item.domain] ?? 0) + response.score;

    // Check if flag fires (score meets or exceeds cutoff)
    if (response.score >= threshold.cutoff_score) {
      firedFlags.push({
        item_id: item.item_id,
        domain: item.domain,
        description: threshold.flag_description,
        is_red_flag: item.is_red_flag,
      });

      if (item.is_red_flag) {
        redFlagCount++;
      }
    }
  }

  // Cast domain scores to proper type
  const typedDomainScores = domainScores as Record<DSSDomain, number>;

  // Determine verdict
  let verdict: DSSVerdict = 'typical';
  let referReason: string | undefined;

  if (redFlagCount >= 2) {
    verdict = 'refer_to_deic';
    const redFlagMessages = firedFlags
      .filter((f) => f.is_red_flag)
      .map((f) => `[${f.domain}] ${f.description}`)
      .join('; ');
    referReason = `${redFlagCount} red flags detected: ${redFlagMessages}`;
  } else if (redFlagCount === 1) {
    verdict = 'monitor';
  } else {
    // Check if any domain score exceeds warn threshold
    const hasHighDomainScore = ALL_DSS_DOMAINS.some(
      (domain) => (typedDomainScores[domain] ?? 0) > DOMAIN_WARN_THRESHOLD,
    );
    if (hasHighDomainScore) {
      verdict = 'monitor';
    }
  }

  return {
    verdict,
    fired_flags: firedFlags,
    red_flag_count: redFlagCount,
    domain_scores: typedDomainScores,
    ...(referReason !== undefined ? { refer_reason: referReason } : {}),
  };
}

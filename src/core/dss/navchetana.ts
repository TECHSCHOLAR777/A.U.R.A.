import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgeBandMonths, DSSDomain, DSSItem, DSSThreshold } from '../schema/index.js';

type RawDSSItem = {
  item_id: string;
  part?: string;
  milestone_due?: string;
  question: string;
};

type RawDSSDocument = {
  instrument?: string;
  items?: RawDSSItem[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dssPath = join(__dirname, '../../../web/data/dss.json');
const rawDocument = JSON.parse(readFileSync(dssPath, 'utf8')) as RawDSSDocument;

function parseMilestoneDueMonths(value?: string): number {
  if (!value) return 24;
  const lower = value.toLowerCase().trim();
  if (lower.includes('year')) {
    const years = parseInt(lower, 10);
    return Number.isFinite(years) ? years * 12 : 24;
  }
  if (lower.includes('-')) {
    const parts = lower
      .split('-')
      .map((part) => parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
    return parts.length > 0 ? Math.max(...parts) : 24;
  }
  const months = parseInt(lower, 10);
  return Number.isFinite(months) ? months : 24;
}

function toAgeBand(months: number): AgeBandMonths {
  if (months <= 3) return '0-3';
  if (months <= 6) return '3-6';
  if (months <= 9) return '6-9';
  if (months <= 12) return '9-12';
  if (months <= 18) return '12-18';
  if (months <= 24) return '18-24';
  return '24-36';
}

function inferDomain(item: RawDSSItem): DSSDomain {
  const text = `${item.item_id} ${item.question}`.toLowerCase();

  if (/(neck|sat|sit|walk|belly|back|dress|eat|toilet)/.test(text)) return 'motor';
  if (/(babbl|word|name|instruction|gesture)/.test(text)) return 'language';
  if (/(smile|facial|response|joyful)/.test(text)) return 'social';
  if (/(hazard)/.test(text)) return 'cognition';
  if (/(eye|visual|object|night)/.test(text)) return 'vision';
  if (/(ear|sound|head toward)/.test(text)) return 'hearing';
  return 'social';
}

const authoritativePartB = Object.freeze(
  (rawDocument.items || []).filter((item) => item.part === 'B')
);

export const NAVCHETANA_DSS_ITEMS: readonly DSSItem[] = Object.freeze(
  authoritativePartB.map((item) => ({
    item_id: item.item_id,
    domain: inferDomain(item),
    age_band: toAgeBand(parseMilestoneDueMonths(item.milestone_due)),
    description: item.question,
    is_red_flag: true,
  }))
);

export const NAVCHETANA_DSS_THRESHOLDS: readonly DSSThreshold[] = Object.freeze(
  authoritativePartB.map((item) => ({
    item_id: item.item_id,
    domain: inferDomain(item),
    age_band: toAgeBand(parseMilestoneDueMonths(item.milestone_due)),
    cutoff_score: 1,
    flag_description: item.question,
  }))
);

export const NAVCHETANA_DSS_METADATA = Object.freeze({
  instrument: rawDocument.instrument || 'Navchetana DSS',
  source_path: dssPath,
  part_b_count: authoritativePartB.length,
});

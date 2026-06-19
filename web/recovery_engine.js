import { AURA_DB } from './aura-api.js';
import { GuardrailEngine } from './guardrail_engine.js';

const ACTIVITY_DOMAINS = ['cognitive', 'language', 'motor_physical', 'socio_emotional', 'creative'];
const TEMPLATE_SOURCE = '/data/remediation_templates.json';
const RECENT_DOMAINS_KEY = 'aura::recentDomains';

function normalizeDomain(value) {
  return ACTIVITY_DOMAINS.includes(value) ? value : 'socio_emotional';
}

function domainFromNode(nodeId) {
  const clean = String(nodeId || '').trim().toLowerCase();
  if (clean.startsWith('fm') || clean.startsWith('gm') || clean.includes('motor') || clean.includes('physical')) return 'motor_physical';
  if (clean.startsWith('cg') || clean.includes('cog') || clean.includes('num')) return 'cognitive';
  if (clean.startsWith('la') || clean.includes('lang')) return 'language';
  if (clean.startsWith('cr') || clean.includes('create') || clean.includes('art')) return 'creative';
  return 'socio_emotional';
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function euclideanDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += (a[i] - b[i]) ** 2;
  return Math.sqrt(total);
}

function meanVector(vectors) {
  if (!vectors.length) return ACTIVITY_DOMAINS.map(() => 0.45);
  return ACTIVITY_DOMAINS.map((_, idx) => average(vectors.map((vector) => vector[idx])));
}

function clampProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.45;
  return Math.max(0.001, Math.min(0.999, num));
}

function materialKeyFromContext(materials) {
  if (!Array.isArray(materials) || !materials.length) return 'none';
  return materials.map((item) => String(item).trim().toLowerCase()).filter(Boolean).sort().join('|') || 'none';
}

function getRecentDomains() {
  try {
    const raw = localStorage.getItem(RECENT_DOMAINS_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => ACTIVITY_DOMAINS.includes(item)) : [];
  } catch {
    return [];
  }
}

function rememberDomain(domain) {
  const next = [...getRecentDomains(), normalizeDomain(domain)].slice(-6);
  try {
    localStorage.setItem(RECENT_DOMAINS_KEY, JSON.stringify(next));
  } catch (_err) {
    // Best-effort only; activity delivery must not fail on localStorage issues.
  }
}

async function ensureTemplatesLoaded() {
  const existing = await AURA_DB.getRemediationTemplates();
  if (Array.isArray(existing) && existing.length > 0) return existing;
  try {
    const resp = await fetch(TEMPLATE_SOURCE);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const templates = Array.isArray(data) ? data : [];
    await AURA_DB.saveRemediationTemplates(templates);
    return templates;
  } catch (err) {
    console.warn('[recovery_engine] remediation templates unavailable', err);
    return [];
  }
}

function buildDomainVector(records, nodeId) {
  const recordMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const domain = normalizeDomain(record.domain || domainFromNode(record.node_id));
    const current = recordMap.get(domain);
    if (!current || String(record.last_updated || '') > String(current.last_updated || '')) {
      recordMap.set(domain, record);
    }
  }
  const targetDomain = domainFromNode(nodeId);
  return ACTIVITY_DOMAINS.map((domain) => {
    const record = recordMap.get(domain);
    if (record) return clampProbability(record.p_mastery);
    return domain === targetDomain ? 0.4 : 0.45;
  });
}

function kMeansTwo(vectors) {
  let centroidA = vectors[0].slice();
  let centroidB = vectors[vectors.length - 1].slice();
  let assignments = vectors.map((_vector, idx) => idx % 2);

  for (let iteration = 0; iteration < 6; iteration++) {
    assignments = vectors.map((vector) => {
      const distA = euclideanDistance(vector, centroidA);
      const distB = euclideanDistance(vector, centroidB);
      return distA <= distB ? 0 : 1;
    });

    const groupA = vectors.filter((_vector, idx) => assignments[idx] === 0);
    const groupB = vectors.filter((_vector, idx) => assignments[idx] === 1);
    if (!groupA.length || !groupB.length) break;
    centroidA = meanVector(groupA);
    centroidB = meanVector(groupB);
  }

  return { assignments, centroidA, centroidB };
}

function chooseRemediationDomain(vectors) {
  const centroid = meanVector(vectors);
  let minDomain = ACTIVITY_DOMAINS[0];
  let minValue = centroid[0];
  centroid.forEach((value, idx) => {
    if (value < minValue) {
      minValue = value;
      minDomain = ACTIVITY_DOMAINS[idx];
    }
  });
  return { remediationDomain: minDomain, betaMean: average(centroid), centroid };
}

async function pickTemplate(remediationDomain, ageBand, roomContext) {
  const templates = await ensureTemplatesLoaded();
  const materialsKey = materialKeyFromContext(roomContext && roomContext.materials);
  const candidates = templates.filter((template) => template && template.domain === remediationDomain);
  if (!candidates.length) return null;

  const exact = candidates.find((template) => template.age_band_months === ageBand && template.material_key === materialsKey);
  if (exact) return exact;

  const materialMatch = candidates.find((template) => template.material_key === materialsKey);
  if (materialMatch) return materialMatch;

  const ageMatch = candidates.find((template) => template.age_band_months === ageBand);
  if (ageMatch) return ageMatch;

  return candidates.find((template) => template.material_key === 'none') || candidates[0];
}

function toGuardrailCandidate(activity) {
  return {
    ...activity,
    materials: Array.isArray(activity.required_materials) ? activity.required_materials : [],
    keywords: Array.isArray(activity.keywords) ? activity.keywords : [],
    inclusion_tags: Array.isArray(activity.inclusion_tags) ? activity.inclusion_tags : [],
    recent_domains: Array.isArray(activity.recent_domains) ? activity.recent_domains : getRecentDomains().slice(-3)
  };
}

export async function buildRecoveryActivity({ baseActivity, payload, presentChildren, childMasteryMap }) {
  const safeActivity = baseActivity || {};
  const children = Array.isArray(presentChildren) ? presentChildren : [];
  if (children.length < 3) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'too_few_children' } };
  }

  const vectors = children.map((child) => ({
    childId: child.childId,
    vector: buildDomainVector(childMasteryMap.get(child.childId) || [], payload.node_id)
  }));

  const uniqueVectors = new Set(vectors.map((entry) => entry.vector.map((value) => value.toFixed(3)).join('|')));
  if (uniqueVectors.size <= 1) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'identical_vectors' } };
  }

  const { assignments, centroidA, centroidB } = kMeansTwo(vectors.map((entry) => entry.vector));
  const meanA = average(centroidA);
  const meanB = average(centroidB);
  const betaClusterId = meanA <= meanB ? 0 : 1;

  const betaEntries = vectors.filter((_entry, idx) => assignments[idx] === betaClusterId);
  const alphaEntries = vectors.filter((_entry, idx) => assignments[idx] !== betaClusterId);

  if (!betaEntries.length || !alphaEntries.length) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'empty_cluster' } };
  }

  const { remediationDomain, betaMean } = chooseRemediationDomain(betaEntries.map((entry) => entry.vector));
  if (betaMean > 0.60) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'beta_not_delayed' } };
  }

  const alphaMean = average(meanVector(alphaEntries.map((entry) => entry.vector)));
  if (alphaMean - betaMean < 0.08) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'weak_separation' } };
  }

  const template = await pickTemplate(remediationDomain, payload.age_band_months, payload.context || {});
  if (!template || !template.scaffold_text) {
    return { activity: safeActivity, cohort: { is_split: false, suppression_reason: 'template_missing' } };
  }

  const duoActivity = {
    ...safeActivity,
    remediation_domain: remediationDomain,
    recent_domains: getRecentDomains().slice(-3),
    macro_cohort_split: {
      is_split: true,
      remediation_domain: remediationDomain,
      cohort_beta_uuids: betaEntries.map((entry) => entry.childId)
    },
    path_alpha_core: Array.isArray(safeActivity.step_by_step_instructions) ? safeActivity.step_by_step_instructions : [],
    path_beta_remediation: String(template.scaffold_text).split(/\s*\|\s*/).filter(Boolean),
    provenance: {
      ...(safeActivity.provenance || {}),
      duo_path: true,
      template_key: template.template_key || `${remediationDomain}:${template.material_key || 'none'}`,
      rules_fired: Array.isArray(safeActivity.provenance && safeActivity.provenance.rules_fired)
        ? [...safeActivity.provenance.rules_fired]
        : []
    }
  };

  const guardrailResult = GuardrailEngine.validate(toGuardrailCandidate(duoActivity), payload.child_profiles || []);
  if (!guardrailResult.passed) {
    return {
      activity: safeActivity,
      cohort: { is_split: false, suppression_reason: `guardrail_${guardrailResult.action || 'blocked'}` }
    };
  }

  duoActivity.provenance.rules_fired = Array.from(new Set([
    ...(duoActivity.provenance.rules_fired || []),
    ...(guardrailResult.rules_fired || [])
  ]));

  return {
    activity: duoActivity,
    cohort: {
      is_split: true,
      cohort_beta_uuids: betaEntries.map((entry) => entry.childId),
      remediation_domain: remediationDomain,
      beta_mean: betaMean,
      suppression_reason: null
    }
  };
}

export async function getRecoveryInsight(childId, nodeId) {
  const domain = domainFromNode(nodeId);
  const history = await AURA_DB.getBktHistory(childId, domain);
  if (!Array.isArray(history) || history.length < 3) {
    return { state: 'needs_data', label: 'Needs Data', domain, points: Array.isArray(history) ? history.length : 0 };
  }

  const sorted = history
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const startTs = new Date(sorted[0].timestamp).getTime();
  const points = sorted.map((item) => ({
    x: Math.max(0, Math.round((new Date(item.timestamp).getTime() - startTs) / 86400000)),
    y: clampProbability(item.p_mastery)
  }));

  const meanX = average(points.map((item) => item.x));
  const meanY = average(points.map((item) => item.y));
  const numerator = points.reduce((sum, point) => sum + ((point.x - meanX) * (point.y - meanY)), 0);
  const denominator = points.reduce((sum, point) => sum + ((point.x - meanX) ** 2), 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - (slope * meanX);

  if (slope <= 0) {
    return { state: 'increase_dosage', label: 'Increase Dosage', domain, slope, points: history.length };
  }

  const daysToTarget = Math.max(0, (0.85 - intercept) / slope);
  const weeksToTarget = Math.max(0, Math.ceil(daysToTarget / 7));
  return {
    state: 'on_track',
    label: weeksToTarget <= 1 ? 'On Track' : `${weeksToTarget} weeks`,
    domain,
    slope,
    points: history.length
  };
}

export { ACTIVITY_DOMAINS, domainFromNode, getRecentDomains, rememberDomain };

/**
 * bkt_engine.js
 * Bayesian Knowledge Tracing (BKT) engine for the AURA PWA.
 *
 * Implements the 4-parameter Hidden Markov Model for per-child, per-node
 * mastery tracking. All reads/writes go exclusively through IndexedDB via
 * the MasteryStore helpers in aura-api.js — no data is ever transmitted to
 * a remote server (Req 11.1, 11.2).
 *
 * Export surface:
 *   BKTEngine  {object}  — public API (tapMastery, getMasteryRecord,
 *                          getRoomAggregate, getAllChildMastery, resetMastery)
 */

import { MasteryStore } from './aura-api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Default BKT Parameters (Req 1.6)
// ─────────────────────────────────────────────────────────────────────────────

/** Default BKT parameters used when no node-specific overrides are present. */
const DEFAULT_PARAMS = Object.freeze({
  p_l0: 0.15,  // prior probability of initial knowledge
  p_t:  0.20,  // learning transition probability
  p_g:  0.20,  // lucky-guess probability
  p_s:  0.10,  // slip probability
});

/** A child with p_mastery >= MASTERY_THRESHOLD is considered to have mastered the node. */
const MASTERY_THRESHOLD = 0.80;

/** Maximum length of the rolling p_history window. */
const HISTORY_WINDOW = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level curriculum DAG cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Promise that resolves to the loaded curriculum DAG as a Map<node_id, KnowledgeNode>.
 * Loaded once at module initialisation time (Req 1.7, 2.8).
 *
 * If the fetch fails (offline, missing file) the engine logs a warning and
 * falls back to DEFAULT_PARAMS for every node (Req 1.6).
 *
 * @type {Promise<Map<string, object>>}
 */
const _dagPromise = (async () => {
  try {
    // In a browser, fetch is always available.  In Node.js test environments
    // the caller can polyfill globalThis.fetch or the try/catch handles it.
    const response = await fetch('./knowledge_dag.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const nodes = await response.json();

    // Build a Map for O(1) look-ups by node_id.
    const map = new Map();
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (node && typeof node.node_id === 'string') {
          map.set(node.node_id, node);
        }
      }
    } else if (nodes && typeof nodes === 'object') {
      // Accept either an array or an object keyed by node_id.
      for (const [key, node] of Object.entries(nodes)) {
        if (node && typeof node === 'object') {
          map.set(key, node);
        }
      }
    }

    return map;
  } catch (err) {
    console.warn(
      '[bkt_engine] Could not load knowledge_dag.json; using default BKT params for all nodes.',
      err && err.message ? err.message : err
    );
    return new Map(); // empty → callers fall back to DEFAULT_PARAMS
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up node-specific BKT parameter overrides from the curriculum DAG and
 * merge them with DEFAULT_PARAMS.  If the node is not in the DAG, or if the
 * `bkt_params` field is absent, DEFAULT_PARAMS is returned as-is (Req 1.6, 1.7).
 *
 * @param {string} node_id
 * @returns {Promise<{p_l0:number, p_t:number, p_g:number, p_s:number}>}
 */
async function _resolveParams(node_id) {
  const dag = await _dagPromise;
  const node = dag.get(node_id);

  if (!node || !node.bkt_params || typeof node.bkt_params !== 'object') {
    return DEFAULT_PARAMS;
  }

  // Partial override — merge with defaults so any missing keys use their default.
  return {
    p_l0: typeof node.bkt_params.p_l0 === 'number' ? node.bkt_params.p_l0 : DEFAULT_PARAMS.p_l0,
    p_t:  typeof node.bkt_params.p_t  === 'number' ? node.bkt_params.p_t  : DEFAULT_PARAMS.p_t,
    p_g:  typeof node.bkt_params.p_g  === 'number' ? node.bkt_params.p_g  : DEFAULT_PARAMS.p_g,
    p_s:  typeof node.bkt_params.p_s  === 'number' ? node.bkt_params.p_s  : DEFAULT_PARAMS.p_s,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.2 — Core BKT update (pure function)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * updateBKT — 4-parameter Bayesian Knowledge Tracing update.
 *
 * Implements the exact 5-step algorithm from the design pseudocode.
 * This is a pure synchronous function with no I/O side-effects.
 *
 * @param {number}  prior   — P(Learned) before this observation, in (0, 1)
 * @param {boolean} got_it  — true if the child answered correctly
 * @param {{ p_l0:number, p_t:number, p_g:number, p_s:number }} params — BKT parameters
 * @returns {number}  — Updated P(Learned), clamped to [0.001, 0.999]
 *
 * Satisfies Req 1.2, 1.3, 1.4
 */
function updateBKT(prior, got_it, params) {
  const { p_t, p_g, p_s } = params;

  // Step 1: Likelihood of the observation given the latent state
  let p_obs_given_known;
  let p_obs_given_unknown;

  if (got_it) {
    p_obs_given_known   = 1 - p_s;   // known but did not slip → correct
    p_obs_given_unknown = p_g;        // unknown but lucky guess → correct
  } else {
    p_obs_given_known   = p_s;        // known but slipped → incorrect
    p_obs_given_unknown = 1 - p_g;    // unknown and no lucky guess → incorrect
  }

  // Step 2: Bayes update (unnormalised joint probabilities)
  const p_known_and_obs   = prior * p_obs_given_known;
  const p_unknown_and_obs = (1 - prior) * p_obs_given_unknown;
  const p_obs             = p_known_and_obs + p_unknown_and_obs;

  // Step 3: Normalise → posterior P(Learned | observation)
  const p_learned_given_obs = p_known_and_obs / p_obs;

  // Step 4: Apply learning transition
  //   Even after a wrong answer the child may have just learned the skill.
  const posterior = p_learned_given_obs + (1 - p_learned_given_obs) * p_t;

  // Step 5: Clamp to valid probability range [0.001, 0.999]
  return Math.min(0.999, Math.max(0.001, posterior));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.3 — Trajectory flag derivation (pure function)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeTrajectoryFlag — Derive the categorical trajectory label from the
 * p_mastery history.
 *
 * @param {number[]} p_history          — Rolling window of PREVIOUS p_mastery values
 *                                        (oldest first; does NOT include current)
 * @param {number}   current_p_mastery  — The newly computed p_mastery value
 * @param {number}   [threshold=0.80]   — Mastery threshold
 * @returns {'mastered'|'rising'|'stalled'|'at_risk'}
 *
 * Satisfies Req 2.1–2.5
 */
function computeTrajectoryFlag(p_history, current_p_mastery, threshold = MASTERY_THRESHOLD) {
  // Rule 1 — mastered (Req 2.1): takes absolute precedence.
  if (current_p_mastery >= threshold) {
    return 'mastered';
  }

  // Rule 2 — insufficient data (Req 2.2): optimistic default.
  if (p_history.length < 3) {
    return 'rising';
  }

  // Use the last 3 values from the history for delta computation.
  const h = p_history.slice(-3); // [h0, h1, h2] — oldest to newest in last-3

  const deltas = [
    h[1] - h[0],                 // delta between h0 → h1
    h[2] - h[1],                 // delta between h1 → h2
    current_p_mastery - h[2],    // delta between h2 → current
  ];

  // Rule 3 — at_risk (Req 2.3): all three deltas < -0.01 AND current < 0.50.
  if (deltas.every(d => d < -0.01) && current_p_mastery < 0.50) {
    return 'at_risk';
  }

  // Rule 4 — stalled (Req 2.4): all three absolute deltas < 0.02.
  if (deltas.every(d => Math.abs(d) < 0.02)) {
    return 'stalled';
  }

  // Rule 5 — rising (Req 2.5): none of the above conditions met.
  return 'rising';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.4 — tapMastery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tapMastery — Record one tap observation for a child × node pair.
 *
 * 1. Validates inputs (Req 11.5).
 * 2. Reads the existing MasteryRecord from IDB, or initialises with P_L0 (Req 1.1).
 * 3. Calls updateBKT with node-specific params (Req 1.6, 1.7).
 * 4. Updates the rolling p_history window (keep last HISTORY_WINDOW values).
 * 5. Derives the trajectory_flag.
 * 6. Writes the updated record to IDB and awaits completion before resolving (Req 1.5, 11.1).
 * 7. Returns the updated MasteryRecord.
 *
 * @param {string}  child_id  — Non-empty opaque local identifier for the child
 * @param {string}  node_id   — Non-empty curriculum node identifier (e.g. "FM-3")
 * @param {boolean} got_it    — true = correct response; false = incorrect response
 * @returns {Promise<object>}  — Resolves with the updated MasteryRecord
 */
async function tapMastery(child_id, node_id, got_it) {
  // ── Input validation (Req 11.5) ───────────────────────────────────────────
  if (typeof child_id !== 'string' || child_id.trim() === '') {
    return Promise.reject(
      new Error('[bkt_engine] tapMastery: child_id must be a non-empty string.')
    );
  }
  if (typeof node_id !== 'string' || node_id.trim() === '') {
    return Promise.reject(
      new Error('[bkt_engine] tapMastery: node_id must be a non-empty string.')
    );
  }
  if (typeof got_it !== 'boolean') {
    return Promise.reject(
      new Error('[bkt_engine] tapMastery: got_it must be a boolean.')
    );
  }

  // ── Resolve BKT parameters for this node (Req 1.6, 1.7) ─────────────────
  const params = await _resolveParams(node_id);

  // ── Read existing record or initialise from P_L0 (Req 1.1) ───────────────
  let existing = await MasteryStore.get(child_id, node_id);

  let prior;
  let observation_count;
  let p_history;

  if (!existing) {
    // Cold start — initialise from the prior (P_L0).
    prior             = params.p_l0;
    observation_count = 0;
    p_history         = [];
  } else {
    prior             = existing.p_mastery;
    observation_count = typeof existing.observation_count === 'number'
      ? existing.observation_count
      : 0;
    p_history = Array.isArray(existing.p_history) ? existing.p_history : [];
  }

  // ── Compute new p_mastery (Req 1.2, 1.3, 1.4) ────────────────────────────
  const new_p_mastery = updateBKT(prior, got_it, params);

  // ── Derive trajectory_flag BEFORE appending new value to history ──────────
  // Pass the CURRENT p_history (before update) to computeTrajectoryFlag so
  // the history contains the previous values only (per spec instructions).
  const trajectory_flag = computeTrajectoryFlag(p_history, new_p_mastery);

  // ── Update rolling p_history window — append then keep last HISTORY_WINDOW
  const updated_p_history = [...p_history, new_p_mastery].slice(-HISTORY_WINDOW);

  // ── Assemble the updated MasteryRecord ────────────────────────────────────
  const record = {
    child_node_key:    `${child_id}|${node_id}`,
    child_id,
    node_id,
    p_mastery:         new_p_mastery,
    last_updated:      new Date().toISOString(),
    trajectory_flag,
    observation_count: observation_count + 1,
    p_history:         updated_p_history,
  };

  // ── Persist to IDB and await completion before resolving (Req 1.5, 11.1) ─
  await MasteryStore.put(record);

  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.5 — getMasteryRecord
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getMasteryRecord — Retrieve a single MasteryRecord from IDB.
 *
 * Returns null (instead of undefined) when no record exists, for a more
 * ergonomic API for callers.
 *
 * @param {string} child_id
 * @param {string} node_id
 * @returns {Promise<object|null>}  — MasteryRecord, or null if not found
 *
 * Satisfies Req 4.3
 */
async function getMasteryRecord(child_id, node_id) {
  const record = await MasteryStore.get(child_id, node_id);
  return record !== undefined ? record : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.6 — getAllChildMastery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAllChildMastery — Retrieve all MasteryRecords for a given child.
 *
 * @param {string} child_id
 * @returns {Promise<object[]>}
 *
 * Satisfies Req 4.3
 */
async function getAllChildMastery(child_id) {
  return MasteryStore.getAllByChild(child_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-task 2.7 — resetMastery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resetMastery — Delete a MasteryRecord from IDB, resetting a child's progress
 * for a given knowledge node.
 *
 * @param {string} child_id
 * @param {string} node_id
 * @returns {Promise<void>}
 *
 * Satisfies Req 4.3
 */
async function resetMastery(child_id, node_id) {
  return MasteryStore.delete(child_id, node_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 implementation — getRoomAggregate
// (included here per spec guidance to implement in full now)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getRoomAggregate — Compute room-level mastery statistics for a knowledge node.
 *
 * Queries all MasteryRecords for the given node, then derives:
 *   - total_count     : total number of records (children tracked for this node)
 *   - mastered_count  : count of records where p_mastery >= MASTERY_THRESHOLD
 *   - avg_p_mastery   : arithmetic mean of all p_mastery values
 *
 * mastered_count is computed as a single-pass filter so it is structurally
 * impossible for it to exceed total_count (Req 3.3).
 *
 * @param {string} node_id
 * @returns {Promise<{node_id:string, mastered_count:number, total_count:number, avg_p_mastery:number}>}
 *
 * Satisfies Req 3.1, 3.2, 3.3, 3.4
 */
async function getRoomAggregate(node_id) {
  const records = await MasteryStore.getAllByNode(node_id);

  const total_count = records.length;

  if (total_count === 0) {
    return {
      node_id,
      mastered_count: 0,
      total_count:    0,
      avg_p_mastery:  0,
    };
  }

  // Single-pass computation: accumulate sum and mastered count together
  // so mastered_count can never logically exceed total_count (Req 3.3).
  let mastered_count = 0;
  let sum = 0;

  for (const record of records) {
    sum += record.p_mastery;
    if (record.p_mastery >= MASTERY_THRESHOLD) {
      mastered_count++;
    }
  }

  const avg_p_mastery = sum / total_count;

  return {
    node_id,
    mastered_count,
    total_count,
    avg_p_mastery,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — BKTEngine export (Sub-task 2.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BKTEngine
 *
 * The public interface for the BKT mastery tracking system.
 * All methods are async and operate exclusively against IndexedDB.
 *
 * Exported as a named singleton object; no instantiation needed.
 */
export const BKTEngine = Object.freeze({
  tapMastery,
  getMasteryRecord,
  getRoomAggregate,
  getAllChildMastery,
  resetMastery,
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal function exports (for unit testing only — not part of public API)
// ─────────────────────────────────────────────────────────────────────────────

// These are exported so tests can exercise the pure algorithmic functions
// directly without needing a live IndexedDB environment.
export { updateBKT, computeTrajectoryFlag };

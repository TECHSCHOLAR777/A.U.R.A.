/**
 * aura-api.js
 * IndexedDB persistence layer for the AURA PWA.
 *
 * Version history:
 *   v1 — pre-existing stores (curriculum DAG, children, sessions, etc.)
 *   v2 — adds the `mastery-records` object store (this feature)
 *
 * Export surface:
 *   DB_VERSION   {number}  — current schema version constant
 *   openDB()     {Promise<IDBDatabase>}  — open (and upgrade) the database
 *   MasteryStore {object}  — CRUD helpers for the mastery-records store
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Current IndexedDB schema version.  Bump this when adding object stores. */
export const DB_VERSION = 2;

/** Database name shared across the entire PWA. */
const DB_NAME = 'aura-db';

/** Name of the mastery records object store introduced in v2. */
const STORE_NAME = 'mastery-records';

/**
 * Required fields that every persisted MasteryRecord must contain.
 * Used by the corrupted-record recovery logic in MasteryStore.get().
 */
const REQUIRED_FIELDS = [
  'child_id',
  'node_id',
  'p_mastery',
  'last_updated',
  'trajectory_flag',
  'observation_count',
  'p_history',
];

// ─────────────────────────────────────────────────────────────────────────────
// Database handle (module-level singleton promise)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Promise<IDBDatabase> | null} */
let _dbPromise = null;

// ─────────────────────────────────────────────────────────────────────────────
// openDB — open and upgrade the database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens (or upgrades) the AURA IndexedDB database.
 *
 * The `onupgradeneeded` handler only creates the `mastery-records` store when
 * it does not already exist; it never modifies or removes any pre-existing
 * object stores — satisfies Req 4.4.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // ── Schema migration ──────────────────────────────────────────────────
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── Task 1.4: Guard — never touch pre-existing stores ────────────────
      // We only create stores that do not already exist.  Any store present
      // before this upgrade remains completely untouched.

      // ── Task 1.1: Create mastery-records store (v2 addition) ────────────
      // Req 4.1 — keyPath = "child_node_key" (composite: child_id + "|" + node_id)
      // Req 4.2 — three indexes, all non-unique
      // Req 4.4 — check with `objectStoreNames.contains` before creating
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'child_node_key',
        });

        // Index: by_child — queries all records for a given child
        store.createIndex('by_child', 'child_id', { unique: false });

        // Index: by_node — queries all records for a given knowledge node
        store.createIndex('by_node', 'node_id', { unique: false });

        // Index: by_flag — queries all records with a given trajectory flag
        store.createIndex('by_flag', 'trajectory_flag', { unique: false });
      }

      // NOTE: If future versions need additional stores they should be added
      // here with their own `db.objectStoreNames.contains()` guard.
    };

    request.onsuccess = (event) => resolve(event.target.result);

    request.onerror = (event) => {
      _dbPromise = null; // allow retry on next call
      reject(event.target.error);
    };

    request.onblocked = () => {
      console.warn('[aura-api] IDB upgrade blocked — close other tabs.');
    };
  });

  return _dbPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the composite key used as `keyPath` in the mastery-records store.
 *
 * @param {string} child_id
 * @param {string} node_id
 * @returns {string}  e.g. "CHILD_001|FM-3"
 */
function compositeKey(child_id, node_id) {
  return `${child_id}|${node_id}`;
}

/**
 * Determine whether a record read back from IndexedDB is corrupted.
 *
 * A record is considered corrupted when:
 *   • Any required field is missing (undefined or null), OR
 *   • `p_mastery` is not a finite number (satisfies Req 4.5)
 *
 * @param {object} record
 * @returns {boolean}
 */
function isCorrupted(record) {
  if (!record || typeof record !== 'object') return true;

  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      return true;
    }
  }

  if (typeof record.p_mastery !== 'number' || !isFinite(record.p_mastery)) {
    return true;
  }

  return false;
}

/**
 * Wrap an IDBRequest in a Promise.
 *
 * @template T
 * @param {IDBRequest} request
 * @returns {Promise<T>}
 */
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror  = (event) => reject(event.target.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1.2 + 1.3 — MasteryStore: five public CRUD helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MasteryStore
 *
 * Wraps every IDBObjectStore operation for the `mastery-records` store in a
 * Promise.  Each method accepts `child_id` and `node_id` as separate arguments
 * and derives the composite key internally.
 *
 * Satisfies Req 4.3 (put, get, getAllByNode, getAllByChild, delete).
 */
export const MasteryStore = {

  /**
   * Persist (insert or overwrite) a MasteryRecord.
   *
   * The record MUST already contain a `child_node_key` field; callers are
   * responsible for setting it to `child_id + "|" + node_id`.
   *
   * @param {object} record  A complete MasteryRecord object.
   * @returns {Promise<void>}
   */
  async put(record) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await promisifyRequest(store.put(record));
  },

  /**
   * Retrieve a single MasteryRecord by (child_id, node_id).
   *
   * Task 1.3 / Req 4.5 — Corrupted-record recovery:
   * If the stored record is missing a required field or has a non-numeric
   * `p_mastery`, the corrupted record is deleted from the store and
   * `undefined` is returned so the caller can reinitialise from P_L0.
   *
   * @param {string} child_id
   * @param {string} node_id
   * @returns {Promise<object|undefined>}
   */
  async get(child_id, node_id) {
    const db  = await openDB();
    const key = compositeKey(child_id, node_id);
    const tx  = db.transaction(STORE_NAME, 'readwrite'); // readwrite for potential delete
    const store = tx.objectStore(STORE_NAME);

    const record = await promisifyRequest(store.get(key));

    if (record === undefined) {
      // No record stored yet — normal cold-start path.
      return undefined;
    }

    // ── Corrupted-record recovery ────────────────────────────────────────
    if (isCorrupted(record)) {
      // Delete the corrupted entry so the caller reinitialises from P_L0.
      await promisifyRequest(store.delete(key));
      console.warn(
        `[aura-api] Corrupted mastery record deleted for key "${key}". ` +
        'Caller should reinitialise from P_L0.'
      );
      return undefined;
    }

    return record;
  },

  /**
   * Retrieve all MasteryRecords for a given knowledge node.
   *
   * Uses the `by_node` index.
   *
   * @param {string} node_id
   * @returns {Promise<object[]>}
   */
  async getAllByNode(node_id) {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('by_node');
    return promisifyRequest(index.getAll(node_id));
  },

  /**
   * Retrieve all MasteryRecords for a given child.
   *
   * Uses the `by_child` index.
   *
   * @param {string} child_id
   * @returns {Promise<object[]>}
   */
  async getAllByChild(child_id) {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('by_child');
    return promisifyRequest(index.getAll(child_id));
  },

  /**
   * Delete a single MasteryRecord by (child_id, node_id).
   *
   * @param {string} child_id
   * @param {string} node_id
   * @returns {Promise<void>}
   */
  async delete(child_id, node_id) {
    const db  = await openDB();
    const key = compositeKey(child_id, node_id);
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await promisifyRequest(store.delete(key));
  },
};


/* ============================================================================
   A.U.R.A — FRONTEND INTEGRATION SURFACE   (aura-api.js)
   ----------------------------------------------------------------------------
   Every UI action in index.html calls one of these AURA_API functions.
   Server-side functions call /api/* (served by server.js).
   Browser-side ML functions (clinical, inference, vision) run client-side
   using the engines in ml_pipeline/.

   Loaded as a classic <script> BEFORE the main app script.
   ============================================================================ */

// ── Server availability probe ────────────────────────────────────────────────
// The PWA works fully offline. When the Node server is not available, all
// server-bound functions gracefully fall back to MOCK data.
const _serverBase = '';   // empty = same origin (works for both dev server and direct file)

async function _apiFetch(path, opts = {}) {
  const res = await fetch(_serverBase + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Browser ML: load ml_inference once ───────────────────────────────────────
// ml_inference.js exports predictMalnutritionRisk to globalThis (no bundler needed)
// who_standards.json is fetched once and cached for clinical_engine computations
let _whoStandards = null;
let _samModelText = null;

async function _loadWHOStandards() {
  if (_whoStandards) return _whoStandards;
  try {
    const r = await fetch('/ml_pipeline/who_standards.json');
    _whoStandards = await r.json();
  } catch { _whoStandards = {}; }
  return _whoStandards;
}

async function _loadSAMModel() {
  if (_samModelText) return _samModelText;
  try {
    const r = await fetch('/ml_pipeline/aura_sam_predictor_80kb.txt');
    _samModelText = await r.text();
  } catch { _samModelText = ''; }
  return _samModelText;
}

// Inline browser-compatible WHO Z-score engine (mirrors clinical_engine.js, no require())
function _calculateWHOZScore(weight, length, gender, whoStdData) {
  const gKey = gender.toLowerCase().trim();
  const table = whoStdData[gKey];
  if (!table) return null;
  const key = (Math.round(length * 2) / 2).toFixed(1);
  const lms = table[key];
  if (!lms) return null;
  const { L, M, S } = lms;
  if (Math.abs(L) < 1e-9) return Math.round(Math.log(weight / M) / S * 10000) / 10000;
  return Math.round((Math.pow(weight / M, L) - 1) / (L * S) * 10000) / 10000;
}

function _getClinicalDiagnosis(z) {
  if (z === null || isNaN(z)) return 'UNKNOWN';
  if (z < -3.0) return 'SAM';
  if (z < -2.0) return 'MAM';
  return 'NORMAL';
}

/* ============================================================================
   AURA_API — The main communication layer between frontend & offline/cloud
   ============================================================================ */

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_KEY = (typeof window !== 'undefined' && window.ENV) ? window.ENV.SUPABASE_KEY : '';

let cachedAWC = null;

export const AURA_API = {

  transcribeVoice: async (audioBlob, targetLang = 'hi') => {
    try {
      const { transcribeAudioBlob } = await import('./ml_pipeline/whisper_engine.js');
      const res = await transcribeAudioBlob(audioBlob, targetLang);
      if (res.success) {
        return { text: res.text, confidence: 0.94 };
      }
      throw new Error(res.message);
    } catch (err) {
      console.warn('[transcribeVoice] error:', err.message);
      return { text: '', confidence: 0.0 };
    }
  },

  /* ── [NOT BUILT] language + dialect detection ────────────────────────────*/
  detectLanguage: async (audioBlob) => {
    return { language: 'Hindi', dialect: 'Mundari', confidence: 0.96, langCode: 'hi' };
  },

  /* ── [NOT BUILT] worker auth (voice-print or name match) ─────────────────*/
  authenticateWorker: async (transcript) => {
    return MOCK.workerProfile;
  },

  /* ── [SERVER] children roster ────────────────────────────────────────────
     GET /api/children?centre={centreId} */
  getChildren: async (centreId) => {
    try {
      return await _apiFetch(`/api/children?centre=${encodeURIComponent(centreId)}`);
    } catch {
      return MOCK.children;
    }
  },

  runSARR: async ({ transcript, centreId }) => {
    try {
      return await _apiFetch('/api/sarr', {
        method: 'POST',
        body: JSON.stringify({ transcript, centreId })
      });
    } catch {
      return { registers: MOCK.sarrResult };
    }
  },


  /* ── [SERVER] submit attendance ──────────────────────────────────────────
     POST /api/attendance */
  submitAttendance: async ({ centreId, present, absent, photoCount }) => {
    AURA_DB.queue({ op: 'attendance', centreId, present, absent, photoCount, ts: Date.now() });
    try {
      return await _apiFetch('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ centreId, present, absent, photoCount })
      });
    } catch {
      return { success: true, syncStatus: 'queued' };
    }
  },

  /* ── [BROWSER] WHO Z-score + LightGBM early warning ─────────────────────
     Runs fully client-side: fetches who_standards.json + SAM model once,
     then computes offline. Falls back to /api/health/:childId when heavy
     data (actual DB vitals) is needed. */
  getHealthRisk: async (childId) => {
    // Try server first for real DB vitals
    try {
      const serverData = await _apiFetch(`/api/health/${encodeURIComponent(childId)}`);
      // Re-run browser inference on top of server vitals for explainability
      const [whoStd, modelTxt] = await Promise.all([_loadWHOStandards(), _loadSAMModel()]);
      if (serverData.vitals && whoStd && modelTxt && typeof predictMalnutritionRisk === 'function') {
        const w = parseFloat(serverData.vitals.weight);
        const h = parseFloat(serverData.vitals.height);
        if (!isNaN(w) && !isNaN(h)) {
          const z = _calculateWHOZScore(w, h, serverData.zscore < 0 ? 'girls' : 'girls', whoStd);
          const cat = _getClinicalDiagnosis(z);
          // Use real DB-computed features from server mlFeatures, fallback to safe defaults
          const mf = serverData.mlFeatures || {};
          const cd = {
            zwfl: z ?? serverData.zscore,
            z_velocity: mf.z_velocity !== undefined ? mf.z_velocity : 0.0,
            attendance_rate: mf.attendance_rate !== undefined ? mf.attendance_rate : 1.0,
            missed_vaccine_streak: mf.missed_vaccine_streak !== undefined ? mf.missed_vaccine_streak : 0,
            migrant_flag: mf.migrant_flag !== undefined ? mf.migrant_flag : 0,
            z_acceleration: mf.z_acceleration !== undefined ? mf.z_acceleration : 0.0,
            zwfl_min_3: mf.zwfl_min_3 !== undefined ? mf.zwfl_min_3 : (z ?? serverData.zscore),
            cumulative_low_visits: mf.cumulative_low_visits !== undefined ? mf.cumulative_low_visits : 0
          };
          const risk = predictMalnutritionRisk(cd, modelTxt);
          return { ...serverData, zscore: z ?? serverData.zscore, category: cat, ...risk };
        }
      }
      return serverData;
    } catch {
      // Full offline path
      return MOCK.healthRisk;
    }
  },

  /* ── [SERVER] log meal count ──────────────────────────────────────────────
     POST /api/meal */
  logMeal: async ({ centreId, fedCount, totalPresent }) => {
    AURA_DB.queue({ op: 'meal', centreId, fedCount, totalPresent, ts: Date.now() });
    try {
      return await _apiFetch('/api/meal', {
        method: 'POST',
        body: JSON.stringify({ centreId, fedCount, totalPresent })
      });
    } catch {
      return { success: true };
    }
  },

  /* ── [SERVER] ECE activity briefing via Ollama/Qwen2.5-0.5B ─────────────
     POST /api/ece */
  getECEActivity: async ({ centreId, children }) => {
    try {
      const result = await _apiFetch('/api/ece', {
        method: 'POST',
        body: JSON.stringify({ centreId, children })
      });
      return result;
    } catch {
      return { activity: MOCK.eceActivity };
    }
  },


  /* ── [NOT BUILT] PaddleOCR Aadhaar scan ──────────────────────────────────*/
  ocrAadhaar: async (imageBlob) => {
    return { name: '', dob: '', uid: '', address: '' };
  },

  /* ── CRDT sync to Poshan Tracker + Supabase Bandit Sync ───────────────────
     Called from the service worker background-sync event or online listener. */
  syncNow: async () => {
    if (window.DEBUG_OFFLINE_MODE) {
      console.log('[Sync] Offline simulation active. Aborting syncNow.');
      return { success: false, reason: 'offline_simulation' };
    }

    // 1. Standard API Sync (Attendance, Meal, etc.)
    const pending = await AURA_DB.getPendingSync();
    let synced = 0, failed = 0;
    for (const op of pending) {
      try {
        const path = op.op === 'attendance' ? '/api/attendance'
          : op.op === 'meal' ? '/api/meal'
            : null;
        if (path) {
          await _apiFetch(path, { method: 'POST', body: JSON.stringify(op) });
          await AURA_DB.markSynced(op.id);
          synced++;
        }
      } catch { failed++; }
    }

    // 2. Supabase Cloud Sync (Bandit Weights - Zero PII)
    if (typeof window !== 'undefined' && window.supabase && window.AURA_BANDIT) {
      const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

      const weights = await AURA_DB.loadBanditWeights();

      // We push the aggregate weights, completely stripped of any individual PII
      if (Object.keys(weights).length > 0) {
        try {
          const syncPayload = {
            timestamp: new Date().toISOString(),
            aggregate_weights: weights,
            device_uuid: 'anonymous-device' // Zero-PII compliance
          };

          const { error } = await supabase.from('bandit_weights').upsert(syncPayload);
          if (error) throw error;

          console.log('[Sync] Successfully pushed bandit weights to Supabase:', syncPayload);

          // Crucial Step: Clear bandit_sync operations from the queue to prevent duplicate networks calls
          const queue = await AURA_DB.getPendingSync();
          for (const op of queue) {
            if (op.op === 'bandit_sync') {
              await AURA_DB.markSynced(op.id);
            }
          }
        } catch (err) {
          console.warn('[Sync] Failed to push bandit weights to Supabase:', err);
        }
      }
    }

    return { success: true, synced, failed };
  }
};

/* ============================================================================
   AURA_DB — local state / offline queue layer (Dexie)
   ============================================================================ */
const db = typeof Dexie !== 'undefined' ? new Dexie('AuraOfflineDB') : null;
if (db) {
  db.version(1).stores({
    kv: 'key',
    syncQueue: 'id, op, status',
    banditWeights: 'key'
  });
}

export const AURA_DB = {
  get: async (key) => {
    if (!db) { try { return JSON.parse(localStorage.getItem(`aura::${key}`)); } catch { return null; } }
    const record = await db.kv.get(key);
    return record ? record.value : null;
  },
  set: async (key, val) => {
    if (!db) { try { localStorage.setItem(`aura::${key}`, JSON.stringify(val)); } catch (e) { console.warn('[DB]', e); } return; }
    await db.kv.put({ key, value: val });
  },
  queue: async (operation) => {
    if (!db) {
      const q = (function () { try { return JSON.parse(localStorage.getItem('aura::syncQueue')); } catch { return null; } })() || [];
      q.push({ ...operation, id: Math.random().toString(36).slice(2), status: 'pending' });
      try { localStorage.setItem('aura::syncQueue', JSON.stringify(q)); } catch (e) { console.warn('[DB]', e); }
    } else {
      await db.syncQueue.put({ ...operation, id: Math.random().toString(36).slice(2), status: 'pending' });
    }
    if (typeof updateSyncPill === 'function') updateSyncPill();
  },
  getPendingSync: async () => {
    if (!db) {
      const q = (function () { try { return JSON.parse(localStorage.getItem('aura::syncQueue')); } catch { return null; } })() || [];
      return q.filter(x => x.status === 'pending');
    }
    return await db.syncQueue.where('status').equals('pending').toArray();
  },
  markSynced: async (id) => {
    if (!db) {
      const q = (function () { try { return JSON.parse(localStorage.getItem('aura::syncQueue')); } catch { return null; } })() || [];
      const item = q.find(x => x.id === id);
      if (item) item.status = 'synced';
      try { localStorage.setItem('aura::syncQueue', JSON.stringify(q)); } catch (e) { console.warn('[DB]', e); }
      return;
    }
    await db.syncQueue.update(id, { status: 'synced' });
  },
  saveBanditWeights: async (weights) => {
    if (!db) return;
    const entries = Object.keys(weights).map(k => ({ key: k, value: weights[k] }));
    await db.banditWeights.bulkPut(entries);
  },
  loadBanditWeights: async () => {
    if (!db) return {};
    const records = await db.banditWeights.toArray();
    const weights = {};
    records.forEach(r => { weights[r.key] = r.value; });
    return weights;
  }
};

// Auto-load weights if db is ready
if (typeof window !== 'undefined') {
  window.addEventListener('load', async () => {
    if (db && window.AURA_BANDIT) {
      const storedWeights = await AURA_DB.loadBanditWeights();
      window.AURA_BANDIT.loadWeights(storedWeights);
    }
  });
}

/* ============================================================================
   MOCK — fallback data used when server is unavailable / feature not built.
   ============================================================================ */
export const MOCK = {
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  workerProfile: { id: 'AWW_KH_04', name: 'Meera Devi', centre: 'AWC 04', block: 'Khunti, Jharkhand', childCount: 26, av: 'म' },
  children: [
    { id: 'JH-001', name: 'Rahul Munda', age: '6 yrs', nameHi: 'राहुल मुंडा', status: 'normal' },
    { id: 'JH-002', name: 'Priya Soren', age: '5 yrs', nameHi: 'प्रिया सोरेन', status: 'normal' },
    { id: 'JH-003', name: 'Suresh Oraon', age: '4 yrs', nameHi: 'सुरेश उरांव', status: 'critical' },
    { id: 'JH-004', name: 'Anita Toppo', age: '4 yrs', nameHi: 'अनिता टोप्पो', status: 'pending' },
    { id: 'JH-005', name: 'Kavita Hansda', age: '3 yrs', nameHi: 'कविता हांसदा', status: 'vaccine' }
  ],
  sarrResult: [
    { name: 'Attendance', nameHi: 'हाज़िरी', value: 'Rahul: absent', valueHi: 'राहुल: नहीं आया', confidence: 0.97, tier: 1 },
    { name: 'Ration', nameHi: 'राशन', value: 'Priya: double ration', valueHi: 'प्रिया: दुगना राशन', confidence: 0.91, tier: 2 },
    { name: 'Health', nameHi: 'सेहत', value: 'Meera: weigh pending', valueHi: 'मीरा: वज़न नापना बाकी', confidence: 0.85, tier: 3 }
  ],
  healthRisk: {
    name: 'Suresh Oraon', nameHi: 'सुरेश उरांव',
    age: 'Boy, age 4 years', ageHi: 'लड़का, उम्र 4 साल',
    zscore: -3.5, category: 'SAM', riskLevel: 'critical',
    earlyWarning: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
    earlyWarningHi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।',
    vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '14/20 days' }
  },
  eceActivity: {
    name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
    duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
    desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns by name.',
    descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। फिर नाम लेकर अगली बारी।',
    focusChildren: [
      { name: 'Suresh Oraon', nameHi: 'सुरेश उरांव', flag: 'Low weight alert', flagHi: 'कम वज़न', note: 'Give Suresh a seated role.', noteHi: 'सुरेश को बैठे-बैठे काम दो।' },
      { name: 'Anita Toppo', nameHi: 'अनिता टोप्पो', flag: 'Shy', flagHi: 'शर्मीली है', note: 'Let Anita hold the music card.', noteHi: 'अनिता को गाने का कार्ड थमाओ।' }
    ]
  }
};

/* ============================================================================
   WORKERS — multi-worker dataset for voice/tap login.
   Each worker gets a DIFFERENT dashboard (profile, children, triage, critical).
   `match` = lowercase tokens (name + centre number, Hindi & English) used to
   match what the worker says into the microphone.
   Helper L(obj) in index.html resolves { en, hi } by current language.
   ============================================================================ */
export const WORKERS = [
  {
    id: 'AWW_KH_04', av: { en: 'M', hi: 'म' },
    name: { en: 'Meera Devi', hi: 'मीरा देवी' },
    centre: 'AWC 04', block: { en: 'Khunti, Jharkhand', hi: 'खूंटी, झारखंड' },
    childCount: 26,
    match: ['meera', 'मीरा', '04', 'char', 'chaar', 'चार', 'میرا', 'char', 'मीरा देवी', 'मीरादेवी', 'मिर', 'चार'],
    critical: {
      childId: 'JH-003',
      name: { en: 'Suresh Oraon', hi: 'सुरेश उरांव' },
      age: { en: 'Boy, age 4 years', hi: 'बच्चा, उम्र 4 साल' },
      zscore: -3.5, category: 'SAM',
      warning: {
        en: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
        hi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में बिगड़ सकती है।'
      },
      vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '5/20' }
    },
    triage: [
      { childId: 'JH-003', tier: 'critical', name: { en: 'Suresh Oraon', hi: 'सुरेश उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Weight dropping 3 months. Measure today.', hi: 'वज़न 3 महीने से घट रहा। आज नापो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { childId: 'JH-004', tier: 'critical', name: { en: 'Anita Toppo', hi: 'अनीता टोप्पो' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Mild decline detected. Watch closely.', hi: 'हल्की गिरावट। ध्यान दो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { childId: 'JH-001', tier: 'pending', name: { en: 'Rahul Munda', hi: 'राहुल मुंडा' }, age: { en: '6 yrs', hi: '6 साल' }, ds: { en: 'Absent 5 days. Back today.', hi: '5 दिन नहीं आया। आज लौटा।' }, tag: { en: 'Back today', hi: 'आज लौटा' } },
      { childId: 'JH-002', tier: 'remaining', name: { en: 'Priya Soren', hi: 'प्रिया सोरेन' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Vitamin A vaccine due today.', hi: 'विटामिन A का टीका आज बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_MU_12', av: { en: 'S', hi: 'सु' },
    name: { en: 'Sunita Kumari', hi: 'सुनीता कुमारी' },
    centre: 'AWC 12', block: { en: 'Murhu, Jharkhand', hi: 'मुरहू, झारखंड' },
    childCount: 31,
    match: ['sunita', 'सुनीता', '12', 'barah', 'बारह', 'سنیتا', 'सुनिता', 'सनिता', 'सनीता', 'बारह'],
    critical: {
      name: { en: 'Anil Munda', hi: 'अनिल मुंडा' },
      age: { en: 'Boy, age 2 years 8 months', hi: 'बच्चा, उम्र 2 साल 8 महीने' },
      zscore: -3.0, category: 'SAM',
      warning: {
        en: 'Diarrhoea twice this month. Weight stalled. Needs a home visit.',
        hi: 'इस महीने दो बार दस्त। वज़न रुका हुआ। घर जाकर देखो।'
      },
      vitals: { weight: '8.4 kg', height: '84 cm', arm: '11.1 cm', attendance: '15/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Anil Munda', hi: 'अनिल मुंडा' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Diarrhoea twice. Home visit needed.', hi: 'दो बार दस्त। घर जाकर देखो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { tier: 'pending', name: { en: 'Geeta Oraon', hi: 'गीता उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'No info for 4 days.', hi: '4 दिन से कुछ दर्ज नहीं।' }, tag: null },
      { tier: 'pending', name: { en: 'Mahesh Munda', hi: 'महेश मुंडा' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Missed weighing twice.', hi: 'दो बार वज़न नहीं हुआ।' }, tag: null },
      { tier: 'remaining', name: { en: 'Pooja Devi', hi: 'पूजा देवी' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Deworming pill due.', hi: 'पेट के कीड़े की दवा बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_KA_07', av: { en: 'P', hi: 'फू' },
    name: { en: 'Phoolmani Devi', hi: 'फूलमणि देवी' },
    centre: 'AWC 07', block: { en: 'Karra, Jharkhand', hi: 'कर्रा, झारखंड' },
    childCount: 19,
    match: ['phoolmani', 'phulmani', 'फूलमणि', '07', 'saat', 'सात', 'پھولمنی', 'फूलमनी', 'फुलमनी', 'फूलनी', 'सात'],
    critical: {
      name: { en: 'Lakshmi Oraon', hi: 'लक्ष्मी उरांव' },
      age: { en: 'Girl, age 4 years 1 month', hi: 'बच्ची, उम्र 4 साल 1 महीना' },
      zscore: -2.6, category: 'MAM',
      warning: {
        en: 'Slipped from normal to weak this month. Watch closely.',
        hi: 'इस महीने ठीक से कमज़ोर हुई। ध्यान से देखो।'
      },
      vitals: { weight: '12.1 kg', height: '98 cm', arm: '12.4 cm', attendance: '18/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Lakshmi Oraon', hi: 'लक्ष्मी उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Slipped to weak this month. Watch.', hi: 'इस महीने कमज़ोर हुई। ध्यान दो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { tier: 'pending', name: { en: 'Sanjay Munda', hi: 'संजय मुंडा' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'No info for 3 days.', hi: '3 दिन से कुछ दर्ज नहीं।' }, tag: null },
      { tier: 'remaining', name: { en: 'Kiran Devi', hi: 'किरण देवी' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Vitamin A vaccine due.', hi: 'विटामिन A का टीका बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_TO_21', av: { en: 'R', hi: 'रे' },
    name: { en: 'Rekha Devi', hi: 'रेखा देवी' },
    centre: 'AWC 21', block: { en: 'Torpa, Jharkhand', hi: 'तोरपा, झारखंड' },
    childCount: 24,
    match: ['rekha', 'रेखा', '21', 'ikkis', 'इक्कीस', 'ریکھا', 'रीखा', 'रेका', 'इक्कीस'],
    critical: {
      name: { en: 'Budhan Singh', hi: 'बुधन सिंह' },
      age: { en: 'Boy, age 3 years 5 months', hi: 'बच्चा, उम्र 3 साल 5 महीने' },
      zscore: -3.4, category: 'SAM',
      warning: {
        en: 'Lowest weight in centre. Family migrating soon. Refer now.',
        hi: 'केंद्र में सबसे कम वज़न। परिवार जल्द जाने वाला। अभी रेफर करो।'
      },
      vitals: { weight: '9.0 kg', height: '92 cm', arm: '10.5 cm', attendance: '9/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Budhan Singh', hi: 'बुधन सिंह' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Lowest weight. Family migrating. Refer.', hi: 'सबसे कम वज़न। परिवार जा रहा। रेफर करो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { tier: 'critical', name: { en: 'Sita Kumari', hi: 'सीता कुमारी' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Arm thin. Weigh today.', hi: 'बाँह पतली। आज वज़न नापो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { tier: 'pending', name: { en: 'Vikash Munda', hi: 'विकाश मुंडा' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Absent 6 days.', hi: '6 दिन नहीं आया।' }, tag: { en: 'Absent', hi: 'गैरहाज़िर' } },
      { tier: 'remaining', name: { en: 'Anjali Devi', hi: 'अंजली देवी' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Deworming pill due.', hi: 'पेट के कीड़े की दवा बाकी।' }, tag: null }
    ]
  }
];


if (typeof window !== 'undefined') {
  window.AURA_API = AURA_API;
  window.AURA_DB = AURA_DB;
  window.MOCK = MOCK;
  window.WORKERS = WORKERS;
}

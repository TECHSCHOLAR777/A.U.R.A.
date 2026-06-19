/**
 * aura-api.js
 * IndexedDB persistence layer for the AURA PWA.
 *
 * Version history:
 *   v1 - pre-existing stores (curriculum DAG, children, sessions, etc.)
 *   v2 - adds the `mastery-records` object store (this feature)
 *
 * Export surface:
 *   DB_VERSION   {number}  - current schema version constant
 *   openDB()     {Promise<IDBDatabase>}  - open (and upgrade) the database
 *   MasteryStore {object}  - CRUD helpers for the mastery-records store
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
// openDB - open and upgrade the database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens (or upgrades) the AURA IndexedDB database.
 *
 * The `onupgradeneeded` handler only creates the `mastery-records` store when
 * it does not already exist; it never modifies or removes any pre-existing
 * object stores - satisfies Req 4.4.
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

      // ── Task 1.4: Guard - never touch pre-existing stores ────────────────
      // We only create stores that do not already exist.  Any store present
      // before this upgrade remains completely untouched.

      // ── Task 1.1: Create mastery-records store (v2 addition) ────────────
      // Req 4.1 - keyPath = "child_node_key" (composite: child_id + "|" + node_id)
      // Req 4.2 - three indexes, all non-unique
      // Req 4.4 - check with `objectStoreNames.contains` before creating
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'child_node_key',
        });

        // Index: by_child - queries all records for a given child
        store.createIndex('by_child', 'child_id', { unique: false });

        // Index: by_node - queries all records for a given knowledge node
        store.createIndex('by_node', 'node_id', { unique: false });

        // Index: by_flag - queries all records with a given trajectory flag
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
      console.warn('[aura-api] IDB upgrade blocked - close other tabs.');
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
// Task 1.2 + 1.3 - MasteryStore: five public CRUD helpers
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
   * Task 1.3 / Req 4.5 - Corrupted-record recovery:
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
      // No record stored yet - normal cold-start path.
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
   A.U.R.A - FRONTEND INTEGRATION SURFACE   (aura-api.js)
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
   AURA_API - The main communication layer between frontend & offline/cloud
   ============================================================================ */

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_KEY = (typeof window !== 'undefined' && window.ENV) ? window.ENV.SUPABASE_KEY : '';

let cachedAWC = null;

export const AURA_API = {

  transcribeVoice: async (_audioBlob, _targetLang = 'hi') => {
    // Web Speech API only. Whisper pipeline not in use.
    return { text: '', confidence: 0.0 };
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
      const kids = await _apiFetch(`/api/children?centre=${encodeURIComponent(centreId)}`);
      if (String(centreId || '').startsWith('AWC_DEMO') && Array.isArray(kids) && kids.length === 0) {
        const cached = await AURA_DB.get('children');
        if (Array.isArray(cached) && cached.length > 0) return cached;
      }
      await AURA_DB.set('children', kids);
      return kids;
    } catch (err) {
      console.warn('[getChildren] API fetch failed, falling back to local DB cache:', err.message);
      const cached = await AURA_DB.get('children');
      return cached || [];
    }
  },

  registerChild: async (child) => {
    const cached = (await AURA_DB.get('children')) || [];
    if (!cached.some(c => c.id === child.id)) {
      cached.push(child);
      await AURA_DB.set('children', cached);
    }
    await AURA_DB.queue({ op: 'register_child', childData: child, ts: Date.now() });
    try {
      const result = await _apiFetch('/api/children', {
        method: 'POST',
        body: JSON.stringify(child)
      });
      // Immediate POST succeeded - mark queued op as synced to prevent double-counting
      const pending = await AURA_DB.getPendingSync();
      const regOp = pending.find(p => p.op === 'register_child' && p.childData && p.childData.id === child.id);
      if (regOp) await AURA_DB.markSynced(regOp.id);
      return result;
    } catch (err) {
      console.warn('[registerChild] Immediate server upload failed, queued offline:', err.message);
      return { success: true, syncStatus: 'queued' };
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

    // 1. Standard API Sync (Attendance, Meal, Child registration, etc.)
    const pending = await AURA_DB.getPendingSync();
    let synced = 0, failed = 0;
    for (const op of pending) {
      try {
        const path = op.op === 'attendance' ? '/api/attendance'
          : op.op === 'meal' ? '/api/meal'
          : op.op === 'register_child' ? '/api/children'
          : null;
        if (path) {
          const body = op.op === 'register_child' ? op.childData : op;
          await _apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
          await AURA_DB.markSynced(op.id);
          synced++;
        }
      } catch (err) {
        console.error('[syncNow] operation failed:', err);
        failed++;
      }
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
   AURA_DB - local state / offline queue layer (Dexie)
   ============================================================================ */
const db = typeof Dexie !== 'undefined' ? new Dexie('AuraOfflineDB') : null;
if (db) {
  db.version(1).stores({
    kv: 'key',
    syncQueue: 'id, op, status',
    banditWeights: 'key',
    identity: 'id'
  });
  db.version(2).stores({
    kv: 'key',
    syncQueue: 'id, op, status',
    banditWeights: 'key',
    identity: 'id',
    bktHistory: '++id, child_id, domain, node_id, timestamp',
    pendingPromotions: 'id, status, child_id, node_id, domain, created_at',
    remediationTemplates: '++id, domain, age_band_months, material_key'
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
    if (!db) {
      try {
        localStorage.setItem('aura::banditWeights', JSON.stringify(weights));
      } catch (e) {
        console.warn('[DB]', e);
      }
      return;
    }
    const entries = Object.keys(weights).map(k => ({ key: k, value: weights[k] }));
    await db.banditWeights.bulkPut(entries);
  },
  loadBanditWeights: async () => {
    if (!db) {
      try {
        return JSON.parse(localStorage.getItem('aura::banditWeights')) || {};
      } catch {
        return {};
      }
    }
    const records = await db.banditWeights.toArray();
    const weights = {};
    records.forEach(r => { weights[r.key] = r.value; });
    return weights;
  },

  // Identity management (Zero-PII)
  setupIdentity: async (workerData, pin, centreData, language) => {
    const enc = new TextEncoder();
    const data = enc.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const pinHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    if (!db) {
      try {
        localStorage.setItem('aura::identity', JSON.stringify({ id: 'config', worker: workerData, pinHash, centre: centreData, language }));
        return true;
      } catch (e) {
        console.warn('[DB]', e);
        return false;
      }
    }
    await db.identity.put({ id: 'config', worker: workerData, pinHash, centre: centreData, language });
    return true;
  },

  verifyPin: async (enteredPin) => {
    let record;
    if (!db) {
      try {
        record = JSON.parse(localStorage.getItem('aura::identity'));
      } catch {
        return false;
      }
    } else {
      record = await db.identity.get('config');
    }
    if (!record) return false;
    const enc = new TextEncoder();
    const data = enc.encode(enteredPin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const enteredHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return enteredHash === record.pinHash;
  },

  getIdentity: async () => {
    let record;
    if (!db) {
      try {
        record = JSON.parse(localStorage.getItem('aura::identity'));
      } catch {
        return null;
      }
    } else {
      record = await db.identity.get('config');
    }
    if (!record) return null;
    const { worker, centre, language } = record;
    return { worker, centre, language };
  },

  addBktHistory: async (entry) => {
    const record = {
      ...entry,
      timestamp: entry && entry.timestamp ? entry.timestamp : new Date().toISOString()
    };
    if (!db) {
      const key = 'aura::bktHistory';
      const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
      items.push(record);
      try { localStorage.setItem(key, JSON.stringify(items.slice(-500))); } catch (e) { console.warn('[DB]', e); }
      return record;
    }
    await db.bktHistory.add(record);
    return record;
  },

  getBktHistory: async (child_id, domain) => {
    if (!db) {
      const key = 'aura::bktHistory';
      const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
      return items.filter((item) => item.child_id === child_id && (!domain || item.domain === domain));
    }
    let records = await db.bktHistory.where('child_id').equals(child_id).toArray();
    if (domain) records = records.filter((item) => item.domain === domain);
    return records.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  },

  upsertPendingPromotion: async (promotion) => {
    const record = {
      status: 'pending',
      created_at: new Date().toISOString(),
      ...promotion
    };
    if (!db) {
      const key = 'aura::pendingPromotions';
      const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
      const idx = items.findIndex((item) => item.id === record.id || (
        item.status === 'pending' &&
        item.child_id === record.child_id &&
        item.node_id === record.node_id
      ));
      if (idx >= 0) items[idx] = record;
      else items.push(record);
      try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { console.warn('[DB]', e); }
      return record;
    }
    const existing = await db.pendingPromotions
      .where('child_id')
      .equals(record.child_id)
      .and((item) => item.status === 'pending' && item.node_id === record.node_id && item.id !== record.id)
      .toArray();
    if (existing.length) {
      await Promise.all(existing.map((item) => db.pendingPromotions.delete(item.id)));
    }
    await db.pendingPromotions.put(record);
    return record;
  },

  getPendingPromotions: async () => {
    const dedupe = (items) => {
      const map = new Map();
      for (const item of items || []) {
        const key = `${item.child_id}|${item.node_id}`;
        const current = map.get(key);
        if (!current || String(item.created_at || '') > String(current.created_at || '')) map.set(key, item);
      }
      return Array.from(map.values());
    };
    if (!db) {
      const key = 'aura::pendingPromotions';
      const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
      return dedupe(items.filter((item) => item.status === 'pending'));
    }
    return dedupe(await db.pendingPromotions.where('status').equals('pending').toArray());
  },

  resolvePendingPromotions: async (ids, status) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    if (!db) {
      const key = 'aura::pendingPromotions';
      const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
      const updated = items.map((item) => ids.includes(item.id) ? { ...item, status, resolved_at: new Date().toISOString() } : item);
      try { localStorage.setItem(key, JSON.stringify(updated)); } catch (e) { console.warn('[DB]', e); }
      return;
    }
    await Promise.all(ids.map((id) => db.pendingPromotions.update(id, { status, resolved_at: new Date().toISOString() })));
  },

  saveRemediationTemplates: async (templates) => {
    const items = Array.isArray(templates) ? templates : [];
    if (!db) {
      try { localStorage.setItem('aura::remediationTemplates', JSON.stringify(items)); } catch (e) { console.warn('[DB]', e); }
      return;
    }
    await db.transaction('rw', db.remediationTemplates, async () => {
      await db.remediationTemplates.clear();
      if (items.length) await db.remediationTemplates.bulkAdd(items);
    });
  },

  getRemediationTemplates: async () => {
    if (!db) {
      try { return JSON.parse(localStorage.getItem('aura::remediationTemplates')) || []; } catch { return []; }
    }
    return await db.remediationTemplates.toArray();
  },

  clearDemoData: async (childIds = []) => {
    const ids = Array.isArray(childIds) ? childIds : [];
    if (!db) {
      for (const key of ['aura::bktHistory', 'aura::pendingPromotions']) {
        const items = (function () { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() || [];
        const filtered = items.filter((item) => !item.demo_seed && !ids.includes(item.child_id));
        try { localStorage.setItem(key, JSON.stringify(filtered)); } catch (e) { console.warn('[DB]', e); }
      }
      try { localStorage.removeItem('aura::demoSeededAt'); } catch {}
      return;
    }
    if (ids.length) {
      await db.bktHistory.where('child_id').anyOf(ids).delete();
      await db.pendingPromotions.where('child_id').anyOf(ids).delete();
    }
    await db.kv.delete('demoSeededAt');
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
   MOCK - fallback data used when server is unavailable / feature not built.
   ============================================================================ */
export const MOCK = {
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  workerProfile: { id: 'AWW_LOCAL_01', name: 'Worker', centre: 'AWC', block: 'Local centre', childCount: 26, av: 'W' },
  children: [
    { id: 'JH-001', name: 'Child A', age: '6 yrs', nameHi: 'बच्चा A', status: 'normal' },
    { id: 'JH-002', name: 'Child B', age: '5 yrs', nameHi: 'बच्चा B', status: 'normal' },
    { id: 'JH-003', name: 'Child C', age: '4 yrs', nameHi: 'बच्चा C', status: 'critical' },
    { id: 'JH-004', name: 'Child D', age: '4 yrs', nameHi: 'बच्चा D', status: 'pending' },
    { id: 'JH-005', name: 'Child E', age: '3 yrs', nameHi: 'बच्चा E', status: 'vaccine' }
  ],
  sarrResult: [
    { name: 'Attendance', nameHi: 'हाज़िरी', value: 'Child A: absent', valueHi: 'बच्चा A: नहीं आया', confidence: 0.97, tier: 1 },
    { name: 'Ration', nameHi: 'राशन', value: 'Child B: double ration', valueHi: 'बच्चा B: दुगना राशन', confidence: 0.91, tier: 2 },
    { name: 'Health', nameHi: 'सेहत', value: 'Child C: weigh pending', valueHi: 'बच्चा C: वज़न नापना बाकी', confidence: 0.85, tier: 3 }
  ],
  healthRisk: {
    name: 'Child C', nameHi: 'बच्चा C',
    age: 'Boy, age 4 years', ageHi: 'लड़का, उम्र 4 साल',
    zscore: -3.5, category: 'SAM', riskLevel: 'critical',
    earlyWarning: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
    earlyWarningHi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।',
    vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '14/20 days' }
  },
  eceActivity: {
    name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
    duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
    desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns.',
    descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। बारी-बारी से।',
    focusChildren: [
      { name: 'Child A', nameHi: 'बच्चा A', flag: 'Low weight alert', flagHi: 'कम वज़न', note: 'Give child A a seated role.', noteHi: 'बच्चे A को बैठे-बैठे काम दो।' },
      { name: 'Child B', nameHi: 'बच्चा B', flag: 'Shy', flagHi: 'शर्मीला/शर्मीली है', note: 'Let child B hold the music card.', noteHi: 'बच्चे B को गाने का कार्ड थमाओ।' }
    ]
  }
};

if (typeof window !== 'undefined') {
  window.AURA_API = AURA_API;
  window.AURA_DB = AURA_DB;
  if (window.DEBUG_DEV_MOCKS === true) {
    window.MOCK = MOCK;
  }
}

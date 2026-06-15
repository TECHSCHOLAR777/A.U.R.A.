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

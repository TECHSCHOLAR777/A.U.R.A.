/**
 * bkt_engine.test.js
 *
 * Unit tests for bkt_engine.js using Node.js built-in test runner.
 * Tests pure exported functions (updateBKT, computeTrajectoryFlag) directly,
 * and tests tapMastery input validation via a minimal IDB shim.
 *
 * Run from AURA/web:
 *   node --test tests/bkt_engine.test.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment setup - must happen BEFORE any module imports that use these APIs
// ─────────────────────────────────────────────────────────────────────────────

// Stub fetch so the module-level _dagPromise in bkt_engine.js doesn't throw.
// Returning a non-ok response causes the engine to fall back to default params (Req 1.6).
globalThis.fetch = async () => ({
  ok: false,
  status: 404,
  json: async () => ({}),
});

// ── Minimal in-memory IndexedDB shim ────────────────────────────────────────
// Provides just enough surface to satisfy openDB() and MasteryStore calls
// without installing fake-indexeddb. openDB() is lazy - it is only called
// when an IDB method is actually invoked, so this shim only matters for tests
// that exercise tapMastery (8.8) where IDB is NOT reached due to early rejection.
//
// For complete isolation the shim fully implements the mastery-records store
// operations so that future tests that call through can also work.

function createMinimalIDB() {
  const stores = {};

  function makeRequest(value, error) {
    const req = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => {
      if (error) {
        req.error = error;
        if (req.onerror) req.onerror({ target: req });
      } else {
        req.result = value;
        if (req.onsuccess) req.onsuccess({ target: req });
      }
    }, 0);
    return req;
  }

  function makeObjectStore(storeName) {
    if (!stores[storeName]) stores[storeName] = {};
    const data = stores[storeName];

    const indexData = {};

    return {
      put(record) {
        const key = record[this._keyPath];
        data[key] = record;
        return makeRequest(key);
      },
      get(key) {
        return makeRequest(data[key]);
      },
      delete(key) {
        delete data[key];
        return makeRequest(undefined);
      },
      index(indexName) {
        return {
          getAll(value) {
            const results = Object.values(data).filter(r => r[indexName.replace('by_', '')] === value
              || (indexName === 'by_child' && r.child_id === value)
              || (indexName === 'by_node' && r.node_id === value)
              || (indexName === 'by_flag' && r.trajectory_flag === value)
            );
            return makeRequest(results);
          },
        };
      },
      _keyPath: 'child_node_key',
      createIndex() {},
    };
  }

  const db = {
    objectStoreNames: {
      contains: (name) => !!stores[name],
    },
    createObjectStore(name, opts) {
      stores[name] = {};
      return makeObjectStore(name);
    },
    transaction(storeName, _mode) {
      return {
        objectStore(_name) {
          return makeObjectStore(storeName);
        },
      };
    },
  };

  return {
    open(dbName, version) {
      const req = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      setTimeout(() => {
        // Simulate upgrade if stores don't exist
        if (req.onupgradeneeded && !stores['mastery-records']) {
          req.onupgradeneeded({ target: req, oldVersion: 0, newVersion: version });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);

      return req;
    },
  };
}

globalThis.indexedDB = createMinimalIDB();

// ─────────────────────────────────────────────────────────────────────────────
// Imports - must come AFTER globalThis stubs are set up
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { updateBKT, computeTrajectoryFlag } from '../bkt_engine.js';
import { BKTEngine } from '../bkt_engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Default BKT parameters (matching Req 1.6 and the constants in bkt_engine.js)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = Object.freeze({
  p_l0: 0.15,
  p_t:  0.15,
  p_g:  0.20,
  p_s:  0.10,
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute expected BKT posterior analytically for test assertions
// ─────────────────────────────────────────────────────────────────────────────

function expectedBKT(prior, got_it, params) {
  const { p_t, p_g, p_s } = params;
  let p_obs_given_known, p_obs_given_unknown;
  if (got_it) {
    p_obs_given_known   = 1 - p_s;
    p_obs_given_unknown = p_g;
  } else {
    p_obs_given_known   = p_s;
    p_obs_given_unknown = 1 - p_g;
  }
  const p_known_and_obs   = prior * p_obs_given_known;
  const p_unknown_and_obs = (1 - prior) * p_obs_given_unknown;
  const p_obs             = p_known_and_obs + p_unknown_and_obs;
  const p_learned_given_obs = p_known_and_obs / p_obs;
  const posterior         = p_learned_given_obs + (1 - p_learned_given_obs) * p_t;
  return Math.min(0.999, Math.max(0.001, posterior));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.1 - Cold-start initialisation (Req 1.1)
// ─────────────────────────────────────────────────────────────────────────────
// The cold-start path initialises prior from P_L0 = 0.15 before calling
// updateBKT.  We test this by calling updateBKT with prior = P_L0 directly,
// which mirrors exactly what tapMastery does on a cold-start (got_it = true).

describe('8.1 Cold-start initialisation (Req 1.1)', () => {
  it('updateBKT starting from P_L0 = 0.15 returns a value greater than 0.15 on correct response', () => {
    const result = updateBKT(DEFAULT_PARAMS.p_l0, true, DEFAULT_PARAMS);
    assert.ok(
      result > DEFAULT_PARAMS.p_l0,
      `Expected result (${result}) > P_L0 (${DEFAULT_PARAMS.p_l0})`
    );
  });

  it('cold-start prior of 0.15 produces the expected posterior after a correct answer', () => {
    const result = updateBKT(0.15, true, DEFAULT_PARAMS);
    const expected = expectedBKT(0.15, true, DEFAULT_PARAMS);
    assert.ok(
      Math.abs(result - expected) < 1e-9,
      `Expected ≈${expected.toFixed(6)}, got ${result.toFixed(6)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.2 - Default params verification (Req 1.6)
// ─────────────────────────────────────────────────────────────────────────────
// A node absent from the DAG (fetch returns 404 → empty map) uses the default
// params.  We verify the arithmetic: prior=0.15, got_it=true, defaults →
// expected posterior ≈ 0.5541.

describe('8.2 Default params produce the correct posterior (Req 1.6)', () => {
  it('updateBKT(0.15, true, DEFAULT_PARAMS) ≈ 0.5262', () => {
    const result = updateBKT(0.15, true, DEFAULT_PARAMS);

    // Manual derivation:
    //   p_obs_given_known   = 1 - 0.10 = 0.90
    //   p_obs_given_unknown = 0.20
    //   p_known_and_obs     = 0.15 * 0.90 = 0.135
    //   p_unknown_and_obs   = 0.85 * 0.20 = 0.170
    //   p_obs               = 0.305
    //   p_learned_given_obs = 0.135 / 0.305 ≈ 0.44262
    //   posterior           = 0.44262 + 0.55738 * 0.15 ≈ 0.52623
    const expected = 0.5262295081967213;

    assert.ok(
      Math.abs(result - expected) < 1e-9,
      `Expected ≈${expected.toFixed(6)}, got ${result.toFixed(6)}`
    );
  });

  it('default params use P_L0=0.15, P_T=0.15, P_G=0.20, P_S=0.10', () => {
    // Verify by computing with explicit values matching the spec defaults
    const explicitResult = updateBKT(
      0.15,
      true,
      { p_l0: 0.15, p_t: 0.15, p_g: 0.20, p_s: 0.10 }
    );
    const defaultResult  = updateBKT(0.15, true, DEFAULT_PARAMS);
    assert.equal(explicitResult, defaultResult);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.3 - DAG override params produce a different posterior (Req 1.7)
// ─────────────────────────────────────────────────────────────────────────────
// When a node provides custom bkt_params, those values are used instead of
// the defaults.  We test updateBKT directly with override params and verify
// the result differs from the default calculation.

describe('8.3 DAG override params are applied (Req 1.7)', () => {
  it('override params {p_l0:0.30, p_t:0.35, p_g:0.15, p_s:0.05} produce a different result', () => {
    const overrideParams = { p_l0: 0.30, p_t: 0.35, p_g: 0.15, p_s: 0.05 };

    const defaultResult  = updateBKT(0.15, true, DEFAULT_PARAMS);
    const overrideResult = updateBKT(0.15, true, overrideParams);

    assert.notEqual(
      overrideResult,
      defaultResult,
      'Override params must produce a different posterior than defaults'
    );
  });

  it('override params produce the analytically expected posterior', () => {
    const overrideParams = { p_l0: 0.30, p_t: 0.35, p_g: 0.15, p_s: 0.05 };
    const prior          = 0.15;

    const result   = updateBKT(prior, true, overrideParams);
    const expected = expectedBKT(prior, true, overrideParams);

    assert.ok(
      Math.abs(result - expected) < 1e-9,
      `Expected ≈${expected.toFixed(6)}, got ${result.toFixed(6)}`
    );
  });

  it('override params with higher learning rate produce higher posterior', () => {
    const highLearnParams = { p_l0: 0.30, p_t: 0.50, p_g: 0.20, p_s: 0.10 };
    const lowLearnResult  = updateBKT(0.15, true, DEFAULT_PARAMS);
    const highLearnResult = updateBKT(0.15, true, highLearnParams);
    // Higher p_t means more learning probability → higher posterior
    assert.ok(
      highLearnResult > lowLearnResult,
      `Higher p_t should produce higher posterior: ${highLearnResult} > ${lowLearnResult}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.4 - Trajectory with < 3 observations returns 'rising' (Req 2.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('8.4 Insufficient history (<3) defaults to rising (Req 2.2)', () => {
  it('empty p_history → rising', () => {
    const flag = computeTrajectoryFlag([], 0.30);
    assert.equal(flag, 'rising');
  });

  it('p_history with 1 entry → rising', () => {
    const flag = computeTrajectoryFlag([0.20], 0.25);
    assert.equal(flag, 'rising');
  });

  it('p_history with 2 entries → rising', () => {
    const flag = computeTrajectoryFlag([0.20, 0.22], 0.24);
    assert.equal(flag, 'rising');
  });

  it('empty history below mastery threshold → rising (not mastered)', () => {
    const flag = computeTrajectoryFlag([], 0.50);
    assert.equal(flag, 'rising');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.5 - at_risk trajectory (Req 2.3)
// ─────────────────────────────────────────────────────────────────────────────
// Craft a p_history where the last 3 deltas are all < -0.01 AND current < 0.50.
// history = [0.50, 0.45, 0.40], current = 0.35
//   delta 0→1: 0.45 - 0.50 = -0.05  ✓ < -0.01
//   delta 1→2: 0.40 - 0.45 = -0.05  ✓ < -0.01
//   delta 2→c: 0.35 - 0.40 = -0.05  ✓ < -0.01
//   current 0.35 < 0.50              ✓

describe('8.5 at_risk trajectory (Req 2.3)', () => {
  it('last 3 deltas all < -0.01 AND current < 0.50 → at_risk', () => {
    const flag = computeTrajectoryFlag([0.50, 0.45, 0.40], 0.35);
    assert.equal(flag, 'at_risk');
  });

  it('steeper decline confirms at_risk', () => {
    // history = [0.48, 0.42, 0.36], current = 0.30
    const flag = computeTrajectoryFlag([0.48, 0.42, 0.36], 0.30);
    assert.equal(flag, 'at_risk');
  });

  it('not at_risk if current >= 0.50 even though deltas are negative', () => {
    // All deltas < -0.01 but current = 0.52 (above at_risk threshold)
    // Should fall through to rising
    const flag = computeTrajectoryFlag([0.70, 0.65, 0.60], 0.52);
    assert.notEqual(flag, 'at_risk');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.6 - stalled trajectory (Req 2.4)
// ─────────────────────────────────────────────────────────────────────────────
// Craft a p_history where all last 3 absolute deltas < 0.02 AND current < 0.80.
// history = [0.40, 0.41, 0.40], current = 0.41
//   delta 0→1: |0.41 - 0.40| = 0.01  ✓ < 0.02
//   delta 1→2: |0.40 - 0.41| = 0.01  ✓ < 0.02
//   delta 2→c: |0.41 - 0.40| = 0.01  ✓ < 0.02
//   current 0.41 < 0.80               ✓

describe('8.6 stalled trajectory (Req 2.4)', () => {
  it('all last 3 absolute deltas < 0.02 AND current < 0.80 → stalled', () => {
    const flag = computeTrajectoryFlag([0.40, 0.41, 0.40], 0.41);
    assert.equal(flag, 'stalled');
  });

  it('flat history around 0.60 → stalled', () => {
    // All changes ≤ 0.01
    const flag = computeTrajectoryFlag([0.60, 0.61, 0.60], 0.61);
    assert.equal(flag, 'stalled');
  });

  it('not stalled if current >= 0.80 (should be mastered instead)', () => {
    // Even with tiny deltas, mastered takes precedence
    const flag = computeTrajectoryFlag([0.79, 0.80, 0.80], 0.81);
    assert.equal(flag, 'mastered');
  });

  it('not stalled if any delta >= 0.02', () => {
    // Third delta = 0.03 → should be rising
    const flag = computeTrajectoryFlag([0.40, 0.41, 0.40], 0.43);
    assert.notEqual(flag, 'stalled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.7 - mastered trajectory (Req 2.1)
// ─────────────────────────────────────────────────────────────────────────────
// Any record where p_mastery >= 0.80 must return 'mastered' regardless of history.

describe('8.7 mastered trajectory takes absolute precedence (Req 2.1)', () => {
  it('p_mastery = 0.82 with mixed history → mastered', () => {
    const flag = computeTrajectoryFlag([0.30, 0.50, 0.70], 0.82);
    assert.equal(flag, 'mastered');
  });

  it('p_mastery = 0.80 exactly → mastered', () => {
    const flag = computeTrajectoryFlag([0.50, 0.60, 0.70], 0.80);
    assert.equal(flag, 'mastered');
  });

  it('p_mastery = 0.80 with empty history → mastered', () => {
    const flag = computeTrajectoryFlag([], 0.80);
    assert.equal(flag, 'mastered');
  });

  it('p_mastery = 0.999 (clamped max) with at_risk-shaped history → mastered (not at_risk)', () => {
    // History shaped like at_risk but p_mastery is above threshold
    const flag = computeTrajectoryFlag([0.50, 0.45, 0.40], 0.999);
    assert.equal(flag, 'mastered');
  });

  it('p_mastery = 0.7999 (just below threshold) does NOT return mastered', () => {
    const flag = computeTrajectoryFlag([], 0.7999);
    assert.notEqual(flag, 'mastered');
  });

  it('p_mastery = 0.80 with declining history → mastered (precedence over at_risk)', () => {
    // Even though history looks like at_risk, mastery threshold wins
    const flag = computeTrajectoryFlag([0.90, 0.87, 0.83], 0.80);
    assert.equal(flag, 'mastered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 8.8 - Input validation rejects Promise without IDB write (Req 11.5)
// ─────────────────────────────────────────────────────────────────────────────
// tapMastery validates child_id and node_id before any IDB access.
// The Promise rejection must happen before openDB() is ever called.

describe('8.8 Input validation rejects Promise without IDB write (Req 11.5)', () => {
  it('empty child_id rejects with an Error', async () => {
    await assert.rejects(
      () => BKTEngine.tapMastery('', 'FM-3', true),
      (err) => {
        assert.ok(err instanceof Error, 'Should be an Error instance');
        assert.ok(
          err.message.includes('child_id'),
          `Error message should mention child_id, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  it('whitespace-only child_id rejects with an Error', async () => {
    await assert.rejects(
      () => BKTEngine.tapMastery('   ', 'FM-3', true),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('child_id'));
        return true;
      }
    );
  });

  it('empty node_id rejects with an Error', async () => {
    await assert.rejects(
      () => BKTEngine.tapMastery('CHILD_001', '', true),
      (err) => {
        assert.ok(err instanceof Error, 'Should be an Error instance');
        assert.ok(
          err.message.includes('node_id'),
          `Error message should mention node_id, got: "${err.message}"`
        );
        return true;
      }
    );
  });

  it('whitespace-only node_id rejects with an Error', async () => {
    await assert.rejects(
      () => BKTEngine.tapMastery('CHILD_001', '   ', false),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('node_id'));
        return true;
      }
    );
  });

  it('both empty child_id and node_id rejects (child_id checked first)', async () => {
    await assert.rejects(
      () => BKTEngine.tapMastery('', '', true),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });
});

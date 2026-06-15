# AURA — Adaptive Universal Response for Anganwadis

A Progressive Web App (PWA) for Anganwadi Workers (AWWs) that tracks children's learning progress and delivers safe, inclusive activity recommendations — fully offline.

---

## What it does

AURA gives AWWs two core tools:

**1. Per-child mastery tracking (BKT Engine)**
After each activity session, the AWW taps a grid of child avatars to mark who understood the skill. Each tap runs a 4-parameter Bayesian Knowledge Tracing (BKT) model for that child × curriculum node pair. The app stores everything locally in IndexedDB — no data ever leaves the device.

**2. Safe activity delivery (Guardrail Engine)**
Before any activity reaches the AWW, it passes through a 15-rule symbolic rules engine that checks for safety hazards (choking, falling, sharp materials, water) and inclusion needs (non-verbal children, motor delay, visual impairment, language mismatch, shyness). Rules that fire are recorded on the activity card as a visible guardrail chip.

---

## Tech stack

- **Vanilla JS ES modules** — no bundler, no framework
- **Node.js + Express** — lightweight REST API (`server.js`)
- **IndexedDB** — all mastery data stored on-device (`aura-api.js`)
- **`fast-check`** — property-based testing (dev only)
- **Node built-in test runner** — `node --test`

---

## Project structure

```
AURA/web/
├── index.html              # PWA UI — child avatar tap grid + guardrail chip
├── aura-api.js             # IndexedDB layer (mastery-records store)
├── bkt_engine.js           # BKT mastery tracking engine
├── guardrail_engine.js     # 15-rule symbolic validator
├── server.js               # Express API server
├── ml_pipeline/
│   └── activity_bank.json  # Activity catalogue
└── tests/
    ├── bkt_engine.test.js          # BKT unit tests
    ├── bkt_engine.pbt.test.js      # BKT property-based tests
    ├── guardrail_engine.test.js    # Guardrail unit tests
    ├── guardrail_engine.pbt.test.js # Guardrail property-based tests
    └── integration.test.js         # API integration tests
```

---

## API routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/mastery/tap` | Record a tap — updates BKT state for one child × node pair |
| `GET` | `/api/mastery/aggregate/:node_id` | Room-level mastery summary for a knowledge node |
| `POST` | `/api/activity/next` | Fetch the next validated C1 activity for the room |

### POST /api/mastery/tap
```json
{ "child_id": "UUID", "node_id": "FM-3", "got_it": true }
```
Returns `{ "p_mastery": 0.42, "trajectory_flag": "rising" }`

### POST /api/activity/next
```json
{ "child_profiles": [{ "child_id": "UUID", "age_months": 36, "needs": [] }], "node_id": "FM-3" }
```
Returns a full C1 activity object with `provenance.rules_fired` and `safety_guard_applied`.

---

## BKT model

Default parameters (overridable per node in `knowledge_dag.json`):

| Parameter | Symbol | Default |
|-----------|--------|---------|
| Prior knowledge | P_L0 | 0.15 |
| Learning rate | P_T | 0.20 |
| Guess rate | P_G | 0.20 |
| Slip rate | P_S | 0.10 |
| Mastery threshold | — | 0.80 |

Trajectory flags: `rising` · `stalled` · `at_risk` · `mastered`

---

## Guardrail rules

| ID | Type | Trigger | Action |
|----|------|---------|--------|
| SAFE_CHOKE_01 | safety | Pebbles/beads + child < 36 months | reject |
| SAFE_CHOKE_02 | safety | `choking_hazard: true` + child < 48 months | reject |
| SAFE_FALL_01 | safety | Climbing/jumping + `mobility_impaired` | substitute |
| SAFE_WATER_01 | safety | Water + no adult supervision tag | flag |
| SAFE_SHARP_01 | safety | Sharp materials + child < 36 months | reject |
| INC_ATTUNE_01 | inclusion | Verbal response + `non_verbal` | flag |
| INC_ATTUNE_02 | inclusion | Group participation + `selective_mutism` | flag |
| INC_MOTOR_01 | inclusion | Fine motor grip + `motor_delay` | flag |
| INC_MOTOR_02 | inclusion | Locomotion + `mobility_impaired` | substitute |
| INC_VISUAL_01 | inclusion | Purely visual + `visual_impaired` | flag |
| INC_LANG_01 | inclusion | Hindi instruction + different lingua franca | flag |
| INC_SHY_01 | inclusion | Solo performance + `shy` | flag |
| CURR_SEQ_01 | curriculum | Prerequisite avg mastery < 0.50 | flag |
| CURR_AGE_01 | curriculum | Age band mismatch | reject |
| CURR_DOM_01 | curriculum | Same domain 3 sessions in a row | flag |

---

## Running the server

```bash
cd AURA/web
npm install
node server.js
```

Server starts on port 3000 by default. Set `PORT` env var to override.

---

## Running the tests

```bash
cd AURA/web
node --test tests/bkt_engine.test.js
node --test tests/guardrail_engine.test.js
node --test tests/bkt_engine.pbt.test.js
node --test tests/guardrail_engine.pbt.test.js
node --test tests/integration.test.js
```

Or run all at once:

```bash
npm test
```

---

## Offline and privacy guarantees

- All mastery data is keyed by opaque local UUIDs — no real child names stored
- IndexedDB is never synced to any remote server
- The guardrail engine is a pure synchronous function with zero network calls
- The mastery store is never exposed through the Service Worker cache

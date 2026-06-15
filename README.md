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
AURA/
├── README.md               # Unified documentation
├── validate.py             # Activity bank schema validator
└── web/
    ├── index.html          # PWA UI — child avatar tap grid + guardrail chip
    ├── aura-api.js         # IndexedDB layer (mastery-records store)
    ├── bkt_engine.js       # BKT mastery tracking engine
    ├── guardrail_engine.js # 15-rule symbolic validator
    ├── server.js           # Express API server
    ├── data/               # Navchetana data layer files
    │   ├── activity_bank.json
    │   ├── activity_bank.seed.json
    │   ├── dss.json
    │   ├── dss.seed.json
    │   ├── milestone_priors.json
    │   ├── milestone_priors.seed.json
    │   └── navchetana.pdf
    ├── schema/
    │   └── c1_activity.schema.json
    └── tests/
        ├── bkt_engine.test.js           # BKT unit tests
        ├── bkt_engine.pbt.test.js       # BKT property-based tests
        ├── guardrail_engine.test.js     # Guardrail unit tests
        ├── guardrail_engine.pbt.test.js # Guardrail property-based tests
        └── integration.test.js          # API integration tests
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
cd web
npm install
node server.js
```

Server starts on port 3000 by default. Set `PORT` env var to override.

---

## Running the tests

```bash
cd web
npm test
```

---

## Offline and privacy guarantees

- All mastery data is keyed by opaque local UUIDs — no real child names stored
- IndexedDB is never synced to any remote server
- The guardrail engine is a pure synchronous function with zero network calls
- The mastery store is never exposed through the Service Worker cache

---

# Navchetana Data Layer (Dev 4 — Parv)

Source-of-truth data for AURA's **Star 1** (screening + tracking) and **Star 2** (activity adapter), ingested from the government **Navchetana — National Framework for Early Childhood Stimulation (0–3 years), 2024**. All content traces back to that PDF — nothing is invented.

## Files

| File | Feeds | What it is |
|------|-------|-----------|
| `web/data/activity_bank.json` | Star 2 (Dev 2) | 60 stimulation activities, C1-schema-compliant, across all 5 domains and age bands 0–36 months. Each carries `inclusion_modifications` per Navchetana §4.3 (VAKT downgrade principle). |
| `web/data/dss.json` | Star 1 (Dev 3) | The Disability Screening Schedule — yes/no red-flag items with scoring + result logic. |
| `web/data/milestone_priors.json` | Star 1 / BKT (Dev 3) | One `P(L0)` prior per milestone × age band, plus the fixed BKT params. |
| `web/schema/c1_activity.schema.json` | contract | The frozen activity-node schema. Do not change without sign-off. |
| `validate.py` | gate | Validates the activity bank against the schema. |

## Schema contract (C1)

Every activity node has: `activity_id`, `source` (`official_unmodified` for all base nodes), `targeted_domain` (cognitive / language / motor_physical / socio_emotional / creative), `age_band_months` (0-3 / 3-6 / 6-9 / 9-12 / 12-18 / 18-24 / 24-36), `milestone_targeted`, `adapted_title`, `step_by_step_instructions[]`, `required_materials[]`, `safety_guard_applied`, `inclusion_modifications { vast_parameter, instruction_override }`, and `provenance`.

## How to test / validate

From the repo root:

```bash
pip install jsonschema
python validate.py web/data/activity_bank.json
```

Passing output: `60 node(s) checked, 0 error(s).` (exit code 0).
Any schema violation or duplicate `activity_id` prints the offending node and exits 1.

### DSS scoring logic
- Any "yes" to a red-flag item → that item is a red flag.
- 0 red flags → typical; 1 → monitor; 2 or more → refer (RBSK → District Early Intervention Centre).

### Milestone priors
- `P_L0` = prior probability a child of that age has already attained the milestone (seeds BKT).
- Fixed params apply to every skill: `P_T_learn=0.15`, `P_G_guess=0.20`, `P_S_slip=0.10`.

## Handoff
- **Dev 2:** index `activity_bank.json` for lexical retrieval (BM25 / weighted regex on materials + domain + age band).
- **Dev 3:** load `dss.json` for the screener; seed BKT from `milestone_priors.json`.

## Provenance note
Age bands, domains, and inclusion overrides were corrected against the actual PDF ranges during ingestion (e.g. months 22–23 activities moved into 18–24; three domain reclassifications to fill gaps; one milestone entry added to cover a 9–12 socio-emotional gap).

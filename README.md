# AURA — Adaptive Universal Response for Anganwadis

A Progressive Web App (PWA) for Anganwadi Workers (AWWs) that tracks children's learning progress, performs health screeners, and delivers safe, inclusive activity recommendations — fully offline.

---

## What it does

AURA provides Anganwadi Workers with three core offline-first tools:

1. **Per-Child Mastery Tracking (BKT Engine)**
   After each activity session, the AWW taps a grid of child avatars to mark who understood the skill. Each tap runs a 4-parameter Bayesian Knowledge Tracing (BKT) Hidden Markov Model for that child × curriculum node pair. All mastery data is stored on-device in IndexedDB.
   
2. **Safe Activity Delivery (Guardrail Engine)**
   Before any activity reaches the AWW, it passes through a 15-rule symbolic rules engine that checks for safety hazards (choking, falling, sharp materials, water) and inclusion needs (non-verbal, motor delay, visual impairment, language mismatch, shyness). Rules that fire are recorded on the activity card as a visible guardrail chip.

3. **Contextual Bandit Adapter & Offline Sync**
   Uses an offline-first epsilon-greedy linear reward model updated via Stochastic Gradient Descent (SGD) to select optimal activity variants based on age-mix, available materials, and curriculum domain. Keeps anonymous weights stored locally in Dexie.js and queues them for synchronization with Supabase when online (Zero-PII compliant).

---

## Tech Stack

- **Frontend & Core Logic:** Pure Vanilla JS ES modules (no bundler, no framework) to satisfy sub-300MB tab memory constraints.
- **Local Storage Layer:** IndexedDB for mastery records, plus Dexie.js for the offline queue (`syncQueue`) and bandit weights database (`AuraOfflineDB`).
- **Backend Routing Layer:** Node.js + Express REST API (`server.js`) for serving retrieved activities and processing aggregates.
- **Reference Codebase:** TypeScript (`src/`) compiled with Vitest for testing backend models, logical AST execution, and clinical health algorithms.

---

## Project Structure

```
AURA/
├── README.md               # Unified project documentation
├── validate.py             # Python script validating activities against JSON schema
├── package.json            # Tooling/dependencies configuration at root
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Vitest configuration for reference modules
├── src/                    # Reference TypeScript Backend Intelligence
│   ├── core/
│   │   ├── bkt/            # TS BKT engine, room aggregates & projection math
│   │   ├── dss/            # Disability Screening Schedule (DSS) checklists
│   │   ├── guardrail/      # AST-based JSON rule evaluation framework
│   │   ├── health/         # WHO growth Z-scores & anomaly faltering engines
│   │   ├── rules/          # Declarative JSON rules catalogue
│   │   └── schema/         # Frozen data contracts
│   └── tests/              # Vitest test suite for reference modules
└── web/                    # Production Browser PWA Runtime
    ├── index.html          # Main PWA UI (tap-grid, guardrail chip log, node selector)
    ├── aura-api.js         # Unified frontend IndexedDB & offline Dexie/sync surface
    ├── bandit_engine.js    # Client-side Contextual Bandit engine (SGD / epsilon-greedy)
    ├── bkt_engine.js       # Pure-JS BKT core logic (mastered, rising, stalled, at_risk)
    ├── guardrail_engine.js # Pure-JS programmatic symbolic validator (15 rules)
    ├── server.js           # Express API server & activity retrieval adapter
    ├── config.example.js   # Configuration sample
    ├── data/               # Navchetana government-ingested database layer
    │   ├── activity_bank.json        # 60 stimulation activities
    │   ├── activity_bank.seed.json   # Seed activities template
    │   ├── dss.json                  # DSS screening items & red flags
    │   ├── dss.seed.json             # DSS seed parameters
    │   ├── milestone_priors.json     # seeded P(L0) priors per age band × milestone
    │   ├── milestone_priors.seed.json
    │   └── navchetana.pdf            # Source stimulation framework PDF
    ├── schema/
    │   └── c1_activity.schema.json   # Frozen C1 adapted-activity JSON schema
    └── tests/              # Production test suite (node --test)
        ├── bkt_engine.test.js        # BKT unit tests
        ├── bkt_engine.pbt.test.js    # BKT property-based tests
        ├── guardrail_engine.test.js  # Guardrail unit tests
        ├── guardrail_engine.pbt.test.js # Guardrail property-based tests
        └── integration.test.js       # Integration endpoints test
```

---

## Running the Web Server

1. Navigate to the web folder and install dependencies:
   ```bash
   cd web
   npm install
   ```
2. Start the Express server:
   ```bash
   node server.js
   ```
   *The server starts on port `3000` by default.*

---

## Ingested Data Layer (Navchetana 0–3 Framework)

Source-of-truth data resides in `web/data/`, ingested directly from the official **Navchetana Early Childhood Stimulation (0-3 years) 2024** PDF.

- **Activity Ingestion**: 60 C1-schema-compliant activities mapped across 5 domains (`cognitive`, `language`, `motor_physical`, `socio_emotional`, `creative`) and 7 age bands.
- **DSS Screener**: Yes/no red-flag items. Score: `0 red flags = typical`, `1 = monitor`, `2+ = refer to RBSK / DEIC`.
- **Milestone Priors**: Seeds first-encounter BKT prior `P_L0` based on child age and node difficulty. Fixed params: `P_T=0.15`, `P_G=0.20`, `P_S=0.10`, `Mastery_Threshold=0.80`.

---

## Validation & Testing

### 1. Activity Bank Schema Validation
You can validate the activity bank against the C1 schema from the repository root:
```bash
pip install jsonschema
python validate.py web/data/activity_bank.json
```
*Expected output: `60 node(s) checked, 0 error(s).`*

### 2. PWA Unit & Property-Based Tests (JS Runtime)
Run the built-in Node.js test runner inside `/web`:
```bash
cd web
npm test
```
*Executes 79 tests covering BKT monotonicity limits, trajectory flag transitions, guardrail short-circuits, cache determinism, and UI component chip counts.*

### 3. Reference Module Tests (TS Layer)
Run Vitest tests at the repository root:
```bash
npm run test:ts   # Runs Vitest tests
```
*Verifies the AST condition parser, WHO growth Z-score equations, and health anomaly alerts.*

---

## Offline & Privacy Guarantees

- **Zero-PII Compliance**: No names or PII leave the device. IndexedDB records use opaque, local child UUIDs.
- **Offline Integrity**: The BKT math and Guardrail logic evaluate locally. Remote sync triggers only when online and pushes anonymous, aggregated bandit weight updates.

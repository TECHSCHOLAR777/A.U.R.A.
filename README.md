# A.U.R.A.

Anganwadi Unified Resource Assistant is an offline-first Progressive Web App for Anganwadi workers. It runs on low-cost mobile devices, digitizes Navchetana-based developmental screening, tracks child milestone progress, and adapts daily ECCE activities to the children and room context available in the moment.

Live deployment: [https://a-u-r-a-s7jf.onrender.com/](https://a-u-r-a-s7jf.onrender.com/)

## Overview

A.U.R.A. is designed for low-connectivity field use. The app keeps core interaction inside the browser, stores state locally, and degrades gracefully when the network is unavailable. The current codebase focuses on:

- attendance and child roster handling
- photo-assisted headcount verification for attendance
- Navchetana-based ECE activity delivery
- DSS screening with age-based child filtering
- Bayesian Knowledge Tracing for child milestone progress
- guardrail validation for safety and inclusion
- recovery support through cohorting, reflection review, and local forecasting
- support-first visual triage for children who need observation or guided practice
- child-level progress profiles across the 5 activity domains
- room-level 5-domain progress visualization
- production UI polish based on the AURA v2 design specification
- offline queueing and zero-PII sync primitives

## What Is Implemented Today

### Frontend

The live product surface is the `web/` PWA, not the `src/` reference layer.

Current user-facing screens include:

- splash and profile setup/login
- signup demo seed utility for a realistic 15-child Anganwadi room with 10 days of local history
- home dashboard
- attendance
- ECE activity
- DSS screening
- day review
- more/settings
- child roster management
- child profile with domain progress, recent observations, forecast, and DSS status

The ECE flow currently supports:

- room-aware activity adaptation
- structured Activity Brief cards with age, domain, source, step-by-step guidance, milestone, and inclusion support
- offline fallback activity resolution
- BKT tap updates per child
- recovery insight chips
- Needs Support First visual triage and tap-to-open explanation drawer
- duo-path recovery guidance for a selected beta cohort
- pending promotion review through a reflection modal

The current UI follows the AURA v2 design direction:

- Noto Sans typography
- teal, green, amber, red, and neutral design tokens
- 44px minimum touch targets for primary interactions
- 3-column mobile BKT grid
- workflow progress tabs and home progress indicators
- worker-facing recovery copy instead of technical cohort labels
- accessible modal, navigation, progress, and focus-state improvements

### Intelligence and local logic

The current runtime includes:

- `web/bkt_engine.js`
  - per-child, per-node Bayesian Knowledge Tracing
  - rolling history and trajectory flags
  - pending promotion staging at high mastery confidence
- `web/guardrail_engine.js`
  - deterministic safety and inclusion checks
- `web/bandit_engine.js`
  - local contextual reward-weight updates
- `web/recovery_engine.js`
  - 5-domain recovery cohorting
  - duo-path assembly
  - local forecasting from stored history
- `web/ml_pipeline/vision_engine.js`
  - browser-side photo headcount inference for attendance support
  - local model asset path at `web/ml_pipeline/yolov8n.onnx`

### Data model ground truth

The activity system currently uses these 5 domains:

- `cognitive`
- `language`
- `motor_physical`
- `socio_emotional`
- `creative`

These are the ground truth for activity adaptation and recovery logic.

DSS is a separate screening model and should not be treated as the same domain system.

## Architecture

### System diagram

```mermaid
flowchart LR
    A["Anganwadi worker"] --> B["PWA UI<br/>web/index.html"]
    B --> C["Client modules<br/>aura-api, BKT, guardrail, bandit, recovery"]
    C --> D["Local browser storage<br/>IndexedDB + Dexie"]
    C --> E["Service worker cache"]
    B --> F["Express server<br/>web/server.js"]
    F --> G["Static JSON data<br/>activity bank, DSS, priors"]
    F --> H["Runtime config<br/>config.js"]
    C -. optional aggregate sync .-> I["Supabase-compatible sync path"]
```

### Runtime responsibilities

- `web/index.html` is the main application shell and screen renderer.
- `web/index.html` also contains the current design-token layer and screen-level UI composition.
- `web/server.js` serves the PWA, static data, and current backend endpoints.
- `web/aura-api.js` is the browser-side integration layer for local storage, queueing, and API calls.
- `web/bkt_engine.js` manages child mastery state.
- `web/guardrail_engine.js` validates activity safety and inclusion fit.
- `web/bandit_engine.js` stores and updates local reward weights.
- `web/recovery_engine.js` adds cohorting, duo-path recovery guidance, and forecasting.

### 1. PWA runtime

The browser app is served from `web/index.html` and its ES modules. It handles:

- UI rendering
- local storage and IndexedDB access
- offline fallbacks
- client-side BKT and recovery logic
- service worker registration

### 2. Express server

`web/server.js` serves the PWA and a small set of backend endpoints used by the current runtime.

Current server routes:

- `GET /config.js`
- `POST /api/mastery/tap`
- `GET /api/mastery/aggregate/:node_id`
- `POST /api/activity/next`
- `GET /api/children`
- `POST /api/children`

Important note:

- Attendance and meal submission are queued client-side in the current app flow.
- The frontend can attempt `POST /api/attendance` and `POST /api/meal`, but those endpoints are not implemented in the shipped `web/server.js` at this time.

### 3. Local persistence

The app currently uses two browser-side persistence layers:

- `mastery-records` in IndexedDB for mastery state
- `AuraOfflineDB` in Dexie for:
  - sync queue
  - key-value state
  - bandit weights
  - identity
  - BKT history
  - pending promotions
  - remediation templates

### Local data diagram

```mermaid
flowchart TD
    A["Identity setup"] --> B["AuraOfflineDB.identity"]
    C["Syncable actions"] --> D["AuraOfflineDB.syncQueue"]
    E["Bandit updates"] --> F["AuraOfflineDB.banditWeights"]
    G["Recovery templates"] --> H["AuraOfflineDB.remediationTemplates"]
    I["BKT history writes"] --> J["AuraOfflineDB.bktHistory"]
    K["Pending promotion staging"] --> L["AuraOfflineDB.pendingPromotions"]
    M["Committed mastery state"] --> N["IndexedDB mastery-records"]
```

### 4. Offline behavior

The app is service-worker enabled and caches core shell assets plus curriculum data. Core user flows are designed to continue with local state and cached data when the network is unavailable.

### ECE adaptation and recovery flow

```mermaid
flowchart TD
    A["Present children + room context"] --> B["Build payload"]
    B --> C["POST /api/activity/next"]
    C --> D["Normalize base activity"]
    D --> E["Recovery engine"]
    E --> F["Read child mastery by 5 domains"]
    F --> G["Cohort suppression or K=2 split"]
    G --> H["Template lookup"]
    H --> I["Guardrail validation"]
    I --> J["Render single-path or duo-path activity"]
    J --> K["BKT tap updates"]
    K --> L["Write history"]
    K --> M["Stage pending promotion if threshold crossed"]
    M --> N["Reflection modal confirms or rejects"]
```

### User flow diagram

```mermaid
flowchart TD
    A["Signup or login"] --> B["Optional demo seed"]
    B --> C["Home workflow"]
    C --> D["Attendance + optional photo headcount"]
    D --> E["Activity adaptation"]
    E --> F["Start and complete activity"]
    F --> G["Observe children with Got it or Support"]
    G --> H["Support-first triage + recovery insights"]
    H --> I["Reflection review"]
    H --> J["Child profile"]
    H --> K["DSS screening"]
    I --> L["Day Review"]
    J --> L
    K --> L
    L --> M["Queued or synced records"]
```

### Request and data flow summary

- Child roster is loaded from `GET /api/children` and cached locally.
- Activity requests are sent to `POST /api/activity/next`.
- Recovery enrichment happens in the browser after the base activity is resolved.
- BKT writes committed mastery into `mastery-records`.
- BKT history powers the support-first list, child profile mini-lines, recovery forecast, and room 5-domain graph.
- Higher-confidence milestone changes are first staged in `pendingPromotions`.
- Reflection review decides whether staged promotions are committed.
- Attendance can store an optional photo headcount value alongside the manual roster count.
- When online sync is available, queued aggregate-safe data can be sent later.

## Repository Structure

```text
A.U.R.A/
|-- web/
|   |-- index.html
|   |-- server.js
|   |-- aura-api.js
|   |-- bkt_engine.js
|   |-- bandit_engine.js
|   |-- guardrail_engine.js
|   |-- recovery_engine.js
|   |-- sw.js
|   |-- manifest.json
|   |-- data/
|   |-- schema/
|   |-- tests/
|   `-- ml_pipeline/
|-- src/
|   `-- reference TypeScript core
|-- package.json
|-- Dockerfile
|-- DEPLOYMENT.md
`-- README.md
```

## Tech Stack

- Node.js
- Express
- HTML/CSS/JavaScript modules
- Dexie.js
- IndexedDB
- Service Worker APIs
- Web Speech API for limited non-PII voice capture
- ONNX Runtime Web for browser-side attendance photo headcount inference
- Vitest for root TypeScript-side tests
- Node test runner for `web/tests`

## API Surface

### Implemented server endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/config.js` | Inject runtime environment config into the client |
| `POST` | `/api/mastery/tap` | Server-side mastery tap endpoint |
| `GET` | `/api/mastery/aggregate/:node_id` | Aggregate mastery summary for a node |
| `POST` | `/api/activity/next` | Resolve the next activity candidate |
| `GET` | `/api/children` | Fetch child roster |
| `POST` | `/api/children` | Register a child |

### Frontend-queued but not shipped as server routes here

These are used by the frontend queueing model, but are not implemented in the current `web/server.js`:

- `POST /api/attendance`
- `POST /api/meal`

## Getting Started

### Prerequisites

- Node.js 18 or newer
- npm

### Install

```bash
npm install
```

### Run the app locally

```bash
npm start
```

Then open:

- [http://localhost:3000](http://localhost:3000)

The root start script runs `node web/server.js`.

## Environment Configuration

The server exposes runtime configuration through `GET /config.js`.

Supported environment variables:

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_KEY`

Local example:

```js
window.ENV = {
  SUPABASE_URL: "YOUR_SUPABASE_URL_HERE",
  SUPABASE_KEY: "YOUR_SUPABASE_KEY_HERE"
};
```

See `web/config.example.js`.

## Testing

### Root tests

Run the TypeScript-side verification suite:

```bash
npm test
```

### Web runtime tests

Run the browser-runtime unit tests from the `web` package:

```bash
cd web
npm test
```

Note: the root `package.json` currently contains a `smoke:test` script, but the referenced `scripts/smoke-test.mjs` file is not present in this checkout. Use the root and web test suites above, plus manual browser smoke testing, as the current reliable validation path.

## Operations Notes

### PWA behavior

- The app registers `web/sw.js` when supported by the browser.
- `web/manifest.json` enables installable PWA behavior.
- HTTPS is strongly recommended for real installability and stable service worker behavior.
- Attendance photo headcount runs in the browser using `web/ml_pipeline/yolov8n.onnx`. The ONNX Runtime Web module is currently loaded through the import map CDN entry in `web/index.html`.
- Photo headcount is assistive only. Manual roster confirmation remains the source of truth for attendance.

### Recovery feature behavior

- Recovery cohorting uses the current 5-domain activity model.
- Duo-path activities are additive wrappers around the base activity flow.
- Forecasting is advisory only and does not auto-change milestones or activities.
- Reflection review is the final gate before committing staged promotions.
- Child Profile is an additive read-only progress view. It does not change milestones by itself.
- The Needs Support First section, support explanation drawer, child profile sparklines, and room 5-domain graph all depend on stored BKT history.

### Demo seed behavior

- The demo seed button is available from signup for testing and recording only.
- It creates a demo worker, 15 child profiles, village context, realistic inclusion needs, DSS summaries, pending promotions, room materials, and 10 days of local BKT history.
- Seeded data is not part of the normal app state unless the demo seed button is explicitly used.
- Seeding resets the current demo day to an unfinished workflow so the recording can show attendance, activity, observation, recovery, DSS, and day review in order.

### Design system behavior

- The production PWA uses AURA v2 design tokens directly in the frontend shell.
- Text is protected against unreadably small inline sizes through the current CSS layer.
- The mobile BKT grid is constrained to 3 columns for better legibility.
- Technical terms such as probability values and beta cohort labels are hidden from worker-facing recovery review copy.
- `AURA_DESIGN_SPEC.md`, when present in the workspace, is the authoritative design source for future UI decisions.

## Deployment

The project is already deployed on Render:

- [https://a-u-r-a-s7jf.onrender.com/](https://a-u-r-a-s7jf.onrender.com/)

For local production-style container execution:

```bash
docker build -t aura-app .
docker run -p 3000:3000 aura-app
```

The current Docker entrypoint runs:

```bash
node web/server.js
```

More deployment detail is available in `DEPLOYMENT.md`.

## Data Sources

The current codebase uses local JSON assets under `web/data/`, including:

- activity bank data
- milestone priors
- DSS screening data
- remediation templates

The app is currently aligned to Navchetana-based activity and screening data in the shipped runtime.

## Security and Privacy

Current privacy approach:

- child-facing logic is designed to stay local-first
- sync uses queue-based client logic
- identity is stored locally with hashed PIN verification
- the intended cloud sync model is zero-PII and aggregate-oriented

This does not mean every operational deployment is automatically privacy-complete. You should still review your server configuration, cloud keys, access controls, and data handling before production use.

## Current Limitations

- The main production UI is still a single-file PWA shell in `web/index.html`.
- Some frontend flows queue data locally even when matching backend endpoints are not yet implemented on the server.
- The design-token layer is implemented in the single-file shell. A future refactor can extract it into dedicated CSS/components without changing behavior.
- The `src/` TypeScript layer is useful reference code, but the `web/` runtime is the real product surface.
- Manual browser verification is still essential before production pushes, especially for offline and PWA behavior.

## Recommended Manual Smoke Test

Before a production release, verify:

1. login or signup works
2. child roster loads correctly
3. attendance can be marked and confirmed
4. optional photo headcount opens camera or file picker and does not block manual attendance if inference fails
5. ECE activity loads online and renders the structured Activity Brief
6. offline fallback activity still loads when the server path is unavailable
7. Start Activity and Activity Done gates observation actions correctly
8. BKT Got it and Support taps update child state as expected
9. Needs Support First opens the support explanation drawer
10. pending promotion review opens and confirms correctly
11. DSS still filters questions by child age
12. child profile opens from a BKT child card and shows domain progress sparklines
13. More shows the room-level 5-domain progress graph
14. demo seed creates the 15-child, 10-day local test room only when explicitly triggered
15. Day Review shows Today, Saved on device, and Sync status sections
16. service worker registration succeeds on HTTPS deployment

## License

This repository is marked `UNLICENSED`.

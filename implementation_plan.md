# Implementation Plan — Frontend Refactoring & Backend Integration Roadmap

Check and clean up the PWA frontend, resolve translation and navigation bugs, package ML assets locally to resolve 404 errors, and refactor the styling from a hardcoded simulated desktop device wrapper to a fully responsive native shell. Additionally, provide the Express backend roadmap to connect ready features and outline the missing ones.

## User Review Required

> [!IMPORTANT]
> **1. Responsive Layout Refactor (Replacing Simulated Bezel shell):**
> Currently, the PWA is wrapped in a fixed `.phone` container (390px x 780px) with simulated hardware borders and a dark backdrop. On a real phone, this looks like a double-nested frame.
> *   **Proposal:** We will replace the device bezel simulator with a modern responsive wrapper. On screen widths `<=` 480px (mobile), the app will run edge-to-edge (100% width, 100% height, no shadow/bezel). On desktop, it will display as a centered, clean app card with a max-width: 430px and soft shadow (no device frame).
>
> **2. Header Merging & Cleanup:**
> We will eliminate the outer `.top` desktop-only header which duplicates the app title and language toggles. Instead, we will merge the language toggle and synchronization status directly into the top navigation chrome (`header()`), making the interface compact and native.
>
> **3. Server Setup for Backend Integration:**
> To connect the database and SLM engines to the frontend, we propose adding a lightweight Node.js Express server (`server.js` in the workspace root) that hosts static files and routes `/api/*` endpoints.

---

## Proposed Changes

### Phase 1: Standalone PWA Self-Containment (Fix 404s)

#### [NEW] [web/ml_pipeline/](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/ml_pipeline/)
Copy client-side browser files from the parent `ml_pipeline/` to `web/ml_pipeline/` to prevent HTTP 404 errors during direct static serving:
*   `ml_inference.js` (LightGBM SAM early warning model predictor)
*   `who_standards.json` (WHO child growth reference standards)
*   `aura_sam_predictor_80kb.txt` (SAM early warning LightGBM weights)
*   `vision_engine.js` (YOLOv8 headcount parser)
*   `yolov8n.onnx` (YOLOv8 ONNX model weight)

---

### Phase 2: Responsive Shell & Header Refactoring

#### [MODIFY] [index.html](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/index.html)
*   **Remove Outer Header:** Delete the desktop-only `<div class="top">...</div>` container.
*   **Remove Bezel Styling:** Refactor `.phone` styling to be fully responsive.
    *   Change width/height constraints so that on viewports `<= 480px`, the app runs full-screen (`width: 100%`, `height: 100vh`/`100dvh`, no rounded corners, no double bezels).
    *   On desktop viewports, render it as a clean mobile card layout (`max-width: 430px`, centered, minimal shadow).
*   **Header Refactor:**
    *   Update `header(showBack = false)` to support rendering a back button `‹` on sub-screens.
    *   Integrate a language toggle selector (`हिंदी` / `English`) and sync indicator directly inside the header bar to save vertical space.
*   **Load ML Predictor Script:** Load `<script src="ml_pipeline/ml_inference.js"></script>` to register `predictMalnutritionRisk` in the global scope.

---

### Phase 3: i18n Translations & Navigation Fixes

#### [MODIFY] [index.html](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/index.html) (Cont.)
*   **Back Button Translation:** Translate the hardcoded `‹ back` labels to `‹ वापस` in Hindi mode.
*   **Triage Age Unit Localizer:** Render triage list kids' ages dynamically using `L(k.age)`.
*   **Body Margin / Scrolling:** Adjust `.body` margin and padding rules so that bottom buttons (like "Review & send" on the attendance page) are fully scrollable and not clipped by the bottom navigation bar.

#### [MODIFY] [aura-api.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/aura-api.js)
*   **Worker Initials Translation:** Convert `av: 'म'` in the `WORKERS` array to localized objects `av: { en: 'M', hi: 'म' }`.
*   **Triage Kids Age Translation:** Change triage kids' ages to localized objects (e.g. `age: { en: '3 yrs', hi: '3 साल' }`).
*   **Dynamic Import Paths:** Update dynamic imports (e.g. for `vision_engine.js`) to refer to the new relative path `ml_pipeline/vision_engine.js`.

---

### Phase 4: Express Server Integration (Roadmap)

#### [NEW] [server.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/server.js)
Initialize an Express server in the root of the workspace to:
1.  Serve static files from `web/` at `/`.
2.  Serve static files from `web/ml_pipeline/` at `/ml_pipeline`.
3.  Implement Express routes to map SQLite queries and ML models:
    *   `GET /api/children` -> Query `beneficiary_directory`
    *   `POST /api/attendance` -> Insert into `daily_tracking`
    *   `POST /api/meal` -> Log hot cooked meal feedings
    *   `POST /api/ece` -> Call `ml_pipeline/education_engine.js` (SLM ECE activity briefings)
    *   `POST /api/audit/commit` -> Commit audit status and call `db/universal_pdf_generator.js`
4.  Expose stubs for voice transcriptions and ASR queries.

---

## 🔍 plan.md Feature Gap Matrix

Mapping of all **16 features defined in `plan.md`** against the PWA frontend and backend directory states:

### Priority 1: Core Foundation (Infrastructure & UX)
*   **1. CRDT Survival Engine (cr-sqlite):**
    *   *PWA Status:* Mocked (`localStorage` sync queue).
    *   *Backend Status:* ❌ Missing (`better-sqlite3` standard DB, no CRDT wrapper).
*   **2. Zero-Depth, Time-Contextual UI:**
    *   *PWA Status:* ✅ Built (screens load based on hour).
    *   *Backend Status:* ✅ Supported (tables structured for daily operations).
*   **3. Semantic Automated Register Routing (SARR):**
    *   *PWA Status:* Mocked (returns predefined register updates).
    *   *Backend Status:* ❌ Missing (no router or name-matching algorithms built).
*   **4. Bulk Exception Attendance:**
    *   *PWA Status:* ✅ Built (UX tracks absentees).
    *   *Backend Status:* ✅ Supported (schema includes attendance bits).

### Priority 2: Core Education Engine (The Heart of A.U.R.A.)
*   **5. Offline ECE Content Engine (Daily Planner):**
    *   *PWA Status:* Mocked (returns static activity).
    *   *Backend Status:* ✅ Built (`education_engine.js` queries local Ollama).
*   **6. Focus Child & Re-integration Protocol:**
    *   *PWA Status:* Mocked (hardcoded kids).
    *   *Backend Status:* ✅ Built (processes database nudges).
*   **7. Introvert Integration (Behavioral Adaptation):**
    *   *PWA Status:* Mocked (hardcoded observations).
    *   *Backend Status:* ✅ Built (processes voice observation strings).

### Priority 3: Clinical Safety & Predictive Intelligence
*   **8. Neuro-Symbolic Health Engine:**
    *   *PWA Status:* ✅ Inlined (runs Box-Cox formulas client-side).
    *   *Backend Status:* ✅ Built (`clinical_engine.js` is implemented).
*   **9. Velocity-Based Early Warning System:**
    *   *PWA Status:* Mocked (does not load script).
    *   *Backend Status:* ✅ Built (`ml_inference.js` executes LightGBM parsed trees).
*   **10. Explainable AI Alerts:**
    *   *PWA Status:* ✅ Built (UI prints warning reasons).
    *   *Backend Status:* ✅ Built (`generateXAIReason` is ready).

### Priority 4: Safeguards, Trust, & Compliance
*   **11. Three-Tier Confidence Routing:**
    *   *PWA Status:* ✅ Built (shows classification confidence and manual fallbacks).
    *   *Backend Status:* ❌ Missing (no backend score classifier).
*   **12. Reflection Audit (Human Gate):**
    *   *PWA Status:* ✅ Built (audit verification screen is ready).
    *   *Backend Status:* ❌ Missing (endpoint not connected).
*   **13. Interruption-Safe Checkpointing:**
    *   *PWA Status:* Mocked (needs `localStorage` state saving).
    *   *Backend Status:* ❌ Missing (no checkpoint database layers).
*   **14. Visual Headcount & Low-Light CLAHE:**
    *   *PWA Status:* ✅ Built (camera verification layout).
    *   *Backend Status:* ✅ Built (`vision_engine.js` runs YOLOv8 model).
*   **15. Last-Mile Infrastructure Grievance Portal:**
    *   *PWA Status:* ❌ Missing (no UI button/card).
    *   *Backend Status:* ❌ Missing (no DB schema).
*   **16. Print-Ready PDF Export:**
    *   *PWA Status:* Mocked (Review screen has submit button but no PDF trigger).
    *   *Backend Status:* ✅ Built (`universal_pdf_generator.js` prints formatted registers).

---

## Verification Plan

### Automated / Syntax Check
*   Ensure the page loads and parses without any JavaScript execution errors or unhandled promises in the console.

### Manual Verification
*   **On Desktop Browser:** Open `http://localhost:3000` and confirm the card layout is centered, fits the screen height, and has clean borders.
*   **On Mobile Simulation / Real Device:** Check that the app occupies the full screen without nested margins or black bezels.
*   **Functionality Verification:**
    1.  Test screen flow: splash -> voice login -> name selection -> dashboard -> sub-screens.
    2.  Toggle language directly in the header and verify that the language and initials change instantly.
    3.  Confirm back buttons appear on all sub-screens (`triage`, `voice`, `att`, `meal`, `ece`, `audit`) and navigate back successfully.
    4.  Verify that `/ml_pipeline/who_standards.json` loads correctly when accessing the health card details screen.

# **AURA TECHNICAL IMPLEMENTATION BLUEPRINT v2.0**

**Document Purpose:** Single source of truth for AI coding agents and developers to implement the end-to-end Developmental Recovery expansion of the AURA platform.

## **STEP 0: SYSTEM ARCHITECTURE DELTA ANALYSIS**

**Existing Modules Reused:**

* IndexedDB (Dexie) Per-Child UUID Store (Layer 0\)  
* BM25 / Weighted Regex Lexical Cache (Layer 0\)  
* Tap-First Input UI & Room Context State (Layer 1\)  
* DSS Screener & 4-Parameter BKT HMM Engine (Layer 2\)  
* Symbolic Guardrail Engine (15-20 validation rules) (Layer 2\)  
* Supabase Zero-PII Sync Engine (Layer 0 Backend)

**Existing Modules Modified:**

* **Layer 2 Adapter:** Cloud LLM generation is completely stripped. Replaced with local Template Assembly Matrix.  
* **Layer 2 Bandit Context:** Now receives trajectory velocity flags to adjust epsilon-greedy weights.  
* **BKT Engine Output:** Now writes to a historical time-series array alongside current state mutation.

**New Modules Required:**

* **Local AI Clustering Engine:** ml-kmeans (or lightweight equivalent) for JS-native device-side macro-cohort allocation.  
* **Trajectory Forecaster:** Local Simple Linear Regression utility.  
* **Template DB Store:** New IndexedDB store for pre-verified scaffolding instruction blocks.  
* **Progression Queue:** Local queue for batched UI reflection approvals.  
* **Reflection Popup UI:** Batched checklist modal for data-entry validation.

## **STEP 1: PRE-IMPLEMENTATION REQUIREMENTS**

| Requirement | Description | Purpose | Dependency Level | Status |
| :---- | :---- | :---- | :---- | :---- |
| **JS Math Libraries** | ml-kmeans, simple-statistics | Local AI clustering and linear regression without cloud compute. | P0 \- Core AI Architecture | Mandatory |
| **IndexedDB Expansion** | Dexie schema migration for bkt\_history, pending\_promotions, and remediation\_templates. | To support offline forecasting and batched UI workflows. | P0 \- Storage | Mandatory |
| **Template Ingestion Pipeline** | JSON loader for Navchetana-compliant scaffolding blocks mapped to domain/material tokens. | Powers the rule-based Duo-Path generator. | P0 \- Business Logic | Mandatory |
| **UI Component Library** | Checkbox list modal, Duo-path split-column card renderer. | Frontend delivery of new features. | P1 \- Frontend | Mandatory |
| **Offline Test Harness** | Jest/Cypress hooks simulating 0kbps network states and cache misses. | Ensures new features don't break offline-first mandate. | P1 \- Testing | Mandatory |

## **STEP 2: COMPLETE FEATURE SPECIFICATION**

### **Feature Set: Post-Detection Recovery Suite**

**Problem Statement:** Identifying a delay is insufficient; AURA must actively remediate delays without isolating children, overloading the worker's cognitive capacity, or hallucinating unsafe instructions.  
**Objectives:**

1. Group children automatically by shared developmental deficits using local AI.  
2. Generate safe, rule-based, multi-tier instruction cards offline.  
3. Calculate recovery velocity to validate intervention dosage.  
4. Prevent faulty data entry via batched human-in-the-loop progression validation.

**User Personas:**

* **Anganwadi Worker (AWW):** High administrative load, low tech literacy, operating in noisy, 1:25 ratio environments.

**User Stories:**

* As an AWW, I want the system to tell me which children have shared delays, so I can help them together.  
* As an AWW, I want a single activity card that tells me exactly what to do for the main group and the delayed group simultaneously.  
* As an AWW, I want to review who is ready to move to the next milestone at the end of the day, so I can correct accidental taps.  
* As an AWW, I want to know if my extra attention is actually helping a child catch up, so I know whether to adjust my effort.

**Success Criteria:**

* K-Means clustering executes locally in $\<50$ms.  
* Template Assembly generates valid JSON in $\<10$ms offline.  
* Reflection UI batches correctly and prevents false-positive BKT promotions.

**Failure Criteria:**

* UI thread blocks during clustering or regression calculations.  
* Duo-path generation recommends materials not present in the room.

**Constraints:** 2-4GB RAM device, strictly offline execution for critical paths, strict adherence to Navchetana curriculum.  
**Risks & Edge Cases:**

* **Edge Case:** All children have identical BKT scores. *Mitigation:* System defaults to single-path Alpha instruction.  
* **Edge Case:** Worker ignores batched popup for weeks. *Mitigation:* Queue caps at 14 days; unverified promotions decay to baseline state.

## **STEP 3: SYSTEM ARCHITECTURE**

**High-Level Architecture:**  
The architecture operates strictly client-side for intelligence generation. The Supabase backend remains a dumb data sink for zero-PII analytics. The IndexedDB acts as the primary state machine.  
**Component Responsibilities:**

* **AI Cohort Allocator (Local JS):** Reads $V\_c \= \[cog, mot, lan, soc\]$ vectors, runs $K=2$ Means, identifies the cluster with the lowest centroid, and outputs cohort\_beta\_uuids and target\_domain.  
* **Duo-Path Assembly (Local JS):** Queries lexical index for base activity. Queries Template Store for scaffolding matching target\_domain. Merges strings.  
* **Trajectory Forecaster (Local JS):** Fetches bkt\_history. Runs $y=mx+b$. Outputs expected weeks to threshold or dosage warning.  
* **Progression Queue (Local JS):** Intercepts BKT updates where $p(L\_c) \\ge 0.85$. Parks them pending UI validation.

**Event Architecture:**

1. TAPS\_SUBMITTED \-\> triggers BKT\_UPDATE  
2. BKT\_UPDATE \-\> triggers EVALUATE\_PROGRESSION & WRITE\_HISTORY  
3. SESSION\_END \-\> triggers RENDER\_REFLECTION\_POPUP  
4. NEXT\_DAY\_INIT \-\> triggers RUN\_KMEANS \-\> ASSEMBLE\_DUO\_PATH

## **STEP 4: DATA FLOW DIAGRAMS (DFDs)**

**Level 1 DFD: Duo-Path Generation via K-Means**  
**\[BKT State DB\] \-\> (Extract Vectors) \-\> \[V\_c Array\] \-\> (ml-kmeans K=2) \-\> \[Clusters Alpha & Beta\]**  
**\[Clusters\] \-\> (Centroid Eval) \-\> \[Target Domain\]**  
**\[Target Domain\] \+ \[Room Context\] \-\> (BM25 Search) \-\> \[Base Activity JSON\]**  
**\[Target Domain\] \+ \[Materials\] \-\> (Template Lookup) \-\> \[Scaffold String\]**  
**\[Base JSON\] \+ \[Scaffold String\] \-\> (Template Assembler) \-\> \[Duo-Path JSON\]**  
**\[Duo-Path JSON\] \-\> (Symbolic Guardrail) \-\> \[Final UI Render\]**

**Level 1 DFD: Forecasting & Adaptive Progression**  
**\[Tap Grid Input\] \-\> (BKT Engine HMM Update) \-\> \[New p(L\_c)\]**  
**\[New p(L\_c)\] \-\> (Condition: \>= 0.85?)**  
   **├─\> YES: (Push to Queue) \-\> \[pending\_promotions DB\]**  
   **└─\> NO:  (Write DB) \-\> \[bkt\_history DB\]**  
**\[pending\_promotions DB\] \-\> (Session End Event) \-\> \[Reflection UI Modal\]**  
**\[Reflection UI Modal\] \-\> (Worker Confirms) \-\> (Commit DB & Flush Queue)**  
**\[bkt\_history DB\] \-\> (Linear Regression) \-\> \[Velocity Metric UI\]**

**STEP 5: COMPLETE USER FLOW**  
**Happy Path Flow (Session Execution & Review):**

1. **Trigger:** App launched.  
2. **Action:** AWW logs attendance.  
3. **Backend Action:** RUN\_KMEANS clusters present children.  
4. **State Change:** Duo-Path JSON generated and displayed.  
5. **Action:** AWW conducts activity, taps successes on grid.  
6. **Backend Action:** BKT state updates; 3 children cross threshold and enter pending\_promotions.  
7. **Trigger:** AWW taps "End Session".  
8. **Action:** Reflection Popup renders with 3 checked names.  
9. **Action:** AWW unchecks 1 name (error correction), taps "Confirm".  
10. **State Change:** 2 children advance milestones; 1 reverts. Queue flushed.

**Failure / Edge Case Flow (Sparse Data Forecasting):**

1. **Trigger:** Worker views Child Profile.  
2. **Backend Action:** System attempts linear regression on bkt\_history.  
3. **Validation:** Array length $\< 3$.  
4. **State Change:** Regression aborts.  
5. **UI Feedback:** Displays "Insufficient data to forecast. Please log 2 more sessions."

## **STEP 6: DATABASE DESIGN (IndexedDB / Dexie)**

**Schema Updates (Implementation-Ready):**  
**// Dexie Schema Definition**  
**const db \= new Dexie('AuraDB');**  
**db.version(2).stores({**  
  **// Existing**  
  **children: 'uuid, room\_id',**  
  **bkt\_state: 'child\_uuid, domain, milestone\_id, p\_l',**  
    
  **// New: For Trajectory Forecasting**  
  **bkt\_history: '++id, child\_uuid, domain, milestone\_id, p\_l, timestamp',**  
    
  **// New: For Adaptive Progression**  
  **pending\_promotions: '++id, child\_uuid, domain, from\_milestone\_id, to\_milestone\_id, timestamp',**  
    
  **// New: For Duo-Path Assembly**  
  **remediation\_templates: '++id, domain, age\_band, material\_type, scaffold\_text'**  
**});**  
**Indexes:** child\_uuid and domain are indexed for high-speed local querying during K-Means extraction.

## **STEP 7: AI/ML DESIGN**

### **Component 1: Macro-Cohort Allocator (K-Means)**

* **Purpose:** Identify shared deficits to trigger duo-path assembly.  
* **Inputs:** Normalized $N \\times 4$ matrix where rows are children, columns are domains.  
* **Feature Engineering:** Fill missing BKT scores with age-band baseline priors.  
* **Model:** ml-kmeans (Euclidean distance).  
* **Configuration:** $K=2$ (Alpha and Beta).  
* **Business Logic Constraint:** The cluster with the lower mean vector is Beta. If Beta mean $\> 0.60$, discard Beta (no significant delay present) and default to single-path.

### **Component 2: Trajectory Forecaster (Linear Regression)**

* **Purpose:** Calculate recovery velocity.  
* **Inputs:** bkt\_history time-series data for a specific child \+ domain.  
* **Model:** Ordinary Least Squares (OLS) $y \= mx \+ b$.  
* **Evaluation Metrics:** Slope ($m$).  
* **Business Logic Fallback:** If $N \< 3$, return null (requires more data).

## **STEP 8: BUSINESS LOGIC SPECIFICATION**

**Duo-Path Assembly Logic (Pseudo-code):**  
function assembleDuoPath(baseActivity, targetDomain, betaUuids, roomMaterials) {  
    if (\!betaUuids.length) return baseActivity; // Alpha only

    let scaffoldText \= getTemplateFromDB(targetDomain, roomMaterials);  
      
    let duoPathActivity \= { ...baseActivity };  
    duoPathActivity.macro\_cohort\_split \= {  
        is\_split: true,  
        remediation\_domain: targetDomain,  
        cohort\_beta\_uuids: betaUuids  
    };  
    duoPathActivity.path\_alpha\_core \= baseActivity.instructions;  
    duoPathActivity.path\_beta\_remediation \= scaffoldText;  
      
    return duoPathActivity;  
}

**Forecasting Logic (Pseudo-code):**

## function calculateVelocity(historyArray, targetThreshold \= 0.85) {

##     if (historyArray.length \< 3\) return "Needs Data";

##     

##     // Map to \[x, y\] coordinates where x \= days since start

##     const data \= mapToCoordinates(historyArray); 

##     const { m, b } \= linearRegression(data);

##     

##     if (m \<= 0\) return "Increase Dosage";

##     

##     const daysToMastery \= (targetThreshold \- b) / m;

##     return \`Expected mastery in ${Math.round(daysToMastery / 7)} weeks\`;

## }

## 

## 

## 

## **STEP 9: API DESIGN**

*AURA's critical paths are offline. API design applies only to the background sync of Zero-PII analytics to Supabase.*  
**Endpoint:** POST /rpc/sync\_room\_aggregates  
**Request Schema:**  
{  
  "room\_id": "uuid",  
  "timestamp": "iso-string",  
  "metrics": {  
    "cohort\_splits\_generated": 4,  
    "average\_beta\_cluster\_size": 3.2,  
    "promotions\_confirmed": 7,  
    "promotions\_rejected": 1  
  }  
}  
**Sync Logic:** Triggered via Service Worker background sync API when network is restored. Implements exponential backoff retry.

## **STEP 10: FRONTEND SPECIFICATION**

**Component: Batched Reflection Popup (**\<ReflectionModal /\>**)**

* **State:** Reads from pending\_promotions table.  
* **UI Behavior:** Renders a list of rows: \[Checkbox\] Child Name | Mastered: \[Milestone\].  
* **Interactions:** Check/Uncheck toggles state. "Confirm Actions" button commits to bkt\_state.  
* **Empty State:** Does not render if queue is empty.

**Component: Duo-Path Activity Card (**\<DuoPathCard /\>**)**

* **State:** Takes Duo-Path JSON.  
* **UI Behavior:** If macro\_cohort\_split.is\_split is true, renders two distinct columns or vertical blocks.  
* **Visual Distinctions:** The Beta (Remediation) path must visually highlight the names of the children in cohort\_beta\_uuids so the worker instantly knows who needs the scaffold.

## **STEP 11: BACKEND SPECIFICATION**

**Supabase Configuration:**

* Create new RPC (Remote Procedure Call) functions for inserting the Zero-PII aggregates.  
* Setup PostgreSQL Row Level Security (RLS) policies allowing inserts from authenticated device JWTs but strictly prohibiting reads (devices do not download other centers' data).

## **STEP 12: TESTING STRATEGY**

**Unit Tests (Jest):**

* kmeans.test.ts: Mock $V\_c$ arrays. Verify cluster centroid calculations identify the delayed group accurately.  
* regression.test.ts: Mock upward trending history, verify slope is positive. Mock flat history, verify warning flag.  
* template\_assembly.test.ts: Inject mock domain \+ materials; verify correct string substitution.

**Integration Tests:**

* BKT\_to\_Queue.test.ts: Fire BKT update \> 0.85, verify bkt\_state does NOT update, verify pending\_promotions DOES update.  
* Queue\_to\_State.test.ts: Fire confirmation event, verify queue flushes and state advances.

**Offline Tests:**

* Execute full E2E flow (K-Means \-\> Assembly \-\> UI Render) with Chrome Network tab set to Offline. Fail if any fetch exception is thrown.

## **STEP 13: DEPLOYMENT PLAN**

* **Build Pipeline:** GitHub Actions (Node.js setup, Lint, Jest tests, Vite build).  
* **CI/CD Strategy:** Main branch deploys to Vercel/Netlify as a PWA. Service worker cache bumped on every release.  
* **Migration Strategy:** Dexie.js version bump from v1 to v2. Provide an upgrade() block that creates the new bkt\_history and pending\_promotions tables without wiping existing child states.  
* **Rollback:** Revert commit and force cache-bust via Service Worker unregister if production data corruption is detected.

## **STEP 14: AI AGENT IMPLEMENTATION GUIDE**

**Recommended Repository Structure:**

/src  
  /ai  
    kmeans.ts          \# Wraps ml-kmeans logic  
    regression.ts      \# Wraps simple linear regression  
  /db  
    schema.ts          \# Dexie initialization (v2 migration)  
    templateStore.ts   \# Remediation text blocks  
  /engine  
    bkt.ts             \# Updated with queue interception  
    duoPath.ts         \# Template assembly logic  
  /components  
    DuoPathCard.tsx  
    ReflectionModal.tsx

**Milestone-Based Development Sequence (For AI Agent):**

* **Milestone 1: DB & Logic Foundation**  
  * *Agent Task:* Update src/db/schema.ts to v2. Create bkt\_history and pending\_promotions tables. Update src/engine/bkt.ts to push $p \\ge 0.85$ to the pending queue instead of auto-committing.  
* **Milestone 2: The UI Guardrail**  
  * *Agent Task:* Build ReflectionModal.tsx. Connect it to read the pending\_promotions table and write back to the BKT state upon user confirmation.  
* **Milestone 3: AI Clustering Engine**  
  * *Agent Task:* Implement src/ai/kmeans.ts. Write a hook that extracts all child BKT states, runs $K=2$, and returns targetDomain and betaUuids.  
* **Milestone 4: Rule-Based Assembly**  
  * *Agent Task:* Implement src/engine/duoPath.ts. Write the string interpolator that combines base activity JSON with template blocks based on the clustering output. Build DuoPathCard.tsx to render the split view.  
* **Milestone 5: Forecasting**  
  * *Agent Task:* Implement src/ai/regression.ts. Connect it to the child profile UI to output the velocity metric.

**Done Criteria:** The application correctly intercepts a mastery tap, requires batched UI validation, groups delayed children locally, and generates a two-path activity card entirely offline.  

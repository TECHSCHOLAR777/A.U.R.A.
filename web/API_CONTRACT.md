# A.U.R.A — Frontend ↔ Backend Integration Map

This is the wiring guide for the `web/` frontend. Every user action calls one
`AURA_API.*` function in **`web/aura-api.js`**. That file is the entire
integration surface — edit it and nothing else in the UI changes.

Each function returns **mock data** today so the app runs end-to-end. Replace
each body with the real call below.

## Legend

- **[BROWSER]** — engine is pure JS / onnxruntime-web, import it from `../ml_pipeline` and run client-side. No server needed.
- **[SERVER]** — backend uses `better-sqlite3` (Node only) or an LLM, so it must sit behind a Node endpoint the frontend `fetch`es.
- **[NOT BUILT]** — engine does not exist in the repo yet.

## The map

| `AURA_API` function | Backend (file → export) | Style | Status |
|---|---|---|---|
| `countHeadsByCamera(canvas)` | `ml_pipeline/vision_engine.js` → `analyzeClassroomPhoto(canvas, onnxPath)` | BROWSER | ✅ built |
| `getHealthRisk(childId)` | `ml_pipeline/clinical_engine.js` → `calculateWHOZScore(w,len,gender)` + `getClinicalDiagnosis(z)`, and `ml_pipeline/ml_inference.js` → `predictMalnutritionRisk(childData, modelText)` | BROWSER | ✅ built |
| `getChildren(centreId)` | `db/` → `SELECT … FROM beneficiary_directory` | SERVER | ✅ db built, needs endpoint |
| `submitAttendance(payload)` | `db/` → `INSERT INTO daily_tracking` | SERVER | ✅ db built, needs endpoint |
| `logMeal(payload)` | `db/` → `daily_tracking` + `inventory_ledger` | SERVER | ✅ db built, needs endpoint |
| `commitAudit(payload)` | `db/` commit + `db/universal_pdf_generator.js` | SERVER | ✅ db built, needs endpoint |
| `getECEActivity(payload)` | `ml_pipeline/education_engine.js` → `generateDailyBriefing({ageCohort,rawActivity,localDatabaseNudges,voiceLogObservations})` | SERVER (LLM) | ✅ built, needs endpoint + LLM key |
| `getECERiskProfile(childId)` | `ml_pipeline/ece_engine.js` → `runECERiskProfile(db, id)` | SERVER | ✅ built — `GET /api/ece/risk/:childId` |
| `getECEBatchRiskProfiles()` | `ml_pipeline/ece_engine.js` → `runECEBatchRiskProfiles(db)` | SERVER | ✅ built — `GET /api/ece/risk` |
| `transcribeVoice(audioBlob)` | sherpa-onnx ASR | BROWSER | ❌ not built |
| `detectLanguage(audioBlob)` | language/dialect id model | BROWSER | ❌ not built |
| `authenticateWorker(transcript)` | voice-print / name match (no workers table yet) | SERVER | ❌ not built |
| `runSARR(payload)` | Qwen2.5-0.5B router + Jaro-Winkler/Metaphone name match | BROWSER/SERVER | ❌ not built |
| `ocrAadhaar(imageBlob)` | PaddleOCR | SERVER | ❌ not built |
| `syncNow()` | cr-sqlite CRDT push → Poshan Tracker | SERVER | ❌ not built |

## Data shapes the engines already expect

```
calculateWHOZScore(weight:number, length:number, gender:'boys'|'girls') -> number
getClinicalDiagnosis(zScore:number) -> 'SAM' | 'MAM' | 'NORMAL'

predictMalnutritionRisk(childData, modelText) -> { isHighRisk, riskScore, reason }
  childData = { zwfl, z_velocity, attendance_rate, missed_vaccine_streak, migrant_flag }
  modelText = contents of ml_pipeline/aura_sam_predictor_80kb.txt

analyzeClassroomPhoto(canvas:HTMLCanvasElement, onnxModelPath:string)
  -> { success, headcount, confidenceAvg, message }

generateDailyBriefing({ ageCohort, rawActivity, localDatabaseNudges, voiceLogObservations })
  -> { cohort, daily_20min_session, ... }
```

## DB tables (from `db/setup_database.js`)

`beneficiary_directory`, `daily_tracking`, `growth_monitoring`,
`ration_distribution`, `inventory_ledger`, `home_visits_and_referrals`.

## Recommended integration path (fastest for the hackathon)

1. **Browser-direct** the three engines that already run client-side
   (`vision_engine`, `clinical_engine`, `ml_inference`). Two of them are
   CommonJS — either add `export` lines or bundle with Vite. `vision_engine`
   is already an ES module.
2. **Tiny Node server** (Express) exposing the `db/` and `education_engine`
   calls as `/api/*` routes. The service worker already lets `/api/*` bypass
   the cache, and `aura-api.js` is pre-shaped for `fetch('/api/...')`.
3. Build ASR / SARR / OCR / Poshan-sync last — the UI already has the screens
   and the empty sockets waiting.

## Remove before production

The `MOCK` object at the bottom of `aura-api.js` — delete it once every
function returns real data.

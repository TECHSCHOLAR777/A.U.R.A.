/* ============================================================================
   A.U.R.A — FRONTEND INTEGRATION SURFACE   (aura-api.js)
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
   AURA_API — The main communication layer between frontend & offline/cloud
   ============================================================================ */

const SUPABASE_URL = window.ENV.SUPABASE_URL;
const SUPABASE_KEY = window.ENV.SUPABASE_KEY;

let cachedAWC = null;

const AURA_API = {

  transcribeVoice: async (audioBlob, targetLang = 'hi') => {
    try {
      const { transcribeAudioBlob } = await import('./ml_pipeline/whisper_engine.js');
      const res = await transcribeAudioBlob(audioBlob, targetLang);
      if (res.success) {
        return { text: res.text, confidence: 0.94 };
      }
      throw new Error(res.message);
    } catch (err) {
      console.warn('[transcribeVoice] error:', err.message);
      return { text: '', confidence: 0.0 };
    }
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
      return await _apiFetch(`/api/children?centre=${encodeURIComponent(centreId)}`);
    } catch {
      return MOCK.children;
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

  /* ── [BROWSER] YOLOv8n headcount — runs fully client-side ───────────────
     Uses vision_engine.js + onnxruntime-web from CDN.
     The function is called with an HTMLCanvasElement. */
  countHeadsByCamera: async (imageCanvas) => {
    try {
      // Dynamically import the ES module (CDN ort is loaded via importmap in index.html)
      const { analyzeClassroomPhoto } = await import('./ml_pipeline/vision_engine.js');
      const res = await analyzeClassroomPhoto(imageCanvas, '/ml_pipeline/yolov8n.onnx');
      return {
        success: res.success,
        count: res.headcount !== undefined ? res.headcount : 0,
        confidence: res.confidenceAvg !== undefined ? res.confidenceAvg : 0.0,
        message: res.message
      };
    } catch (err) {
      console.warn('[vision] fallback:', err.message);
      return { success: false, count: 24, confidence: 0.91, message: err.message };
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

  /* ── [BROWSER] WHO Z-score + LightGBM early warning ─────────────────────
     Runs fully client-side: fetches who_standards.json + SAM model once,
     then computes offline. Falls back to /api/health/:childId when heavy
     data (actual DB vitals) is needed. */
  getHealthRisk: async (childId) => {
    // Try server first for real DB vitals
    try {
      const serverData = await _apiFetch(`/api/health/${encodeURIComponent(childId)}`);
      // Re-run browser inference on top of server vitals for explainability
      const [whoStd, modelTxt] = await Promise.all([_loadWHOStandards(), _loadSAMModel()]);
      if (serverData.vitals && whoStd && modelTxt && typeof predictMalnutritionRisk === 'function') {
        const w = parseFloat(serverData.vitals.weight);
        const h = parseFloat(serverData.vitals.height);
        if (!isNaN(w) && !isNaN(h)) {
          const z = _calculateWHOZScore(w, h, serverData.zscore < 0 ? 'girls' : 'girls', whoStd);
          const cat = _getClinicalDiagnosis(z);
          // Use real DB-computed features from server mlFeatures, fallback to safe defaults
          const mf = serverData.mlFeatures || {};
          const cd = {
            zwfl: z ?? serverData.zscore,
            z_velocity: mf.z_velocity !== undefined ? mf.z_velocity : 0.0,
            attendance_rate: mf.attendance_rate !== undefined ? mf.attendance_rate : 1.0,
            missed_vaccine_streak: mf.missed_vaccine_streak !== undefined ? mf.missed_vaccine_streak : 0,
            migrant_flag: mf.migrant_flag !== undefined ? mf.migrant_flag : 0,
            z_acceleration: mf.z_acceleration !== undefined ? mf.z_acceleration : 0.0,
            zwfl_min_3: mf.zwfl_min_3 !== undefined ? mf.zwfl_min_3 : (z ?? serverData.zscore),
            cumulative_low_visits: mf.cumulative_low_visits !== undefined ? mf.cumulative_low_visits : 0
          };
          const risk = predictMalnutritionRisk(cd, modelTxt);
          return { ...serverData, zscore: z ?? serverData.zscore, category: cat, ...risk };
        }
      }
      return serverData;
    } catch {
      // Full offline path
      return MOCK.healthRisk;
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

  /* ── [SERVER] Reflection Audit — human-gate commit ───────────────────────
     POST /api/audit/commit */
  commitAudit: async ({ centreId, approvedItems }) => {
    AURA_DB.set('lastAuditTs', Date.now());
    AURA_DB.queue({ op: 'audit_commit', centreId, approvedItems, ts: Date.now() });
    try {
      return await _apiFetch('/api/audit/commit', {
        method: 'POST',
        body: JSON.stringify({ centreId, approvedItems })
      });
    } catch {
      return { success: true, pdfUrl: null, syncStatus: 'queued' };
    }
  },

  /* ── [SERVER] generate register PDF ──────────────────────────────────────*/
  generatePDF: async ({ registerType, month, year }) => {
    try {
      return await _apiFetch('/api/pdf/generate', {
        method: 'POST',
        body: JSON.stringify({ registerType, month, year })
      });
    } catch {
      return { success: false, error: 'Offline / Server Down' };
    }
  },

  /* ── [SERVER] list generated PDFs ────────────────────────────────────────*/
  listPDFs: async () => {
    try {
      return await _apiFetch('/api/pdf/list');
    } catch {
      return [];
    }
  },

  /* ── [SERVER] file infrastructure grievance ──────────────────────────────*/
  fileGrievance: async ({ centreId, issueType, description, photoData }) => {
    AURA_DB.queue({ op: 'grievance', centreId, issueType, description, photoData, ts: Date.now() });
    try {
      return await _apiFetch('/api/grievance', {
        method: 'POST',
        body: JSON.stringify({ centreId, issueType, description, photoData })
      });
    } catch {
      return { success: true, syncStatus: 'queued' };
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

    // 1. Standard API Sync (Attendance, Meal, etc.)
    const pending = await AURA_DB.getPendingSync();
    let synced = 0, failed = 0;
    for (const op of pending) {
      try {
        const path = op.op === 'attendance' ? '/api/attendance'
          : op.op === 'meal' ? '/api/meal'
            : op.op === 'audit_commit' ? '/api/audit/commit'
              : op.op === 'grievance' ? '/api/grievance'
                : null;
        if (path) {
          await _apiFetch(path, { method: 'POST', body: JSON.stringify(op) });
          await AURA_DB.markSynced(op.id);
          synced++;
        }
      } catch { failed++; }
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
   AURA_DB — local state / offline queue layer (Dexie)
   ============================================================================ */
const db = typeof Dexie !== 'undefined' ? new Dexie('AuraOfflineDB') : null;
if (db) {
  db.version(1).stores({
    kv: 'key',
    syncQueue: 'id, op, status',
    banditWeights: 'key'
  });
}

const AURA_DB = {
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
    if (!db) return;
    const entries = Object.keys(weights).map(k => ({ key: k, value: weights[k] }));
    await db.banditWeights.bulkPut(entries);
  },
  loadBanditWeights: async () => {
    if (!db) return {};
    const records = await db.banditWeights.toArray();
    const weights = {};
    records.forEach(r => { weights[r.key] = r.value; });
    return weights;
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
   MOCK — fallback data used when server is unavailable / feature not built.
   ============================================================================ */
const MOCK = {
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  workerProfile: { id: 'AWW_KH_04', name: 'Meera Devi', centre: 'AWC 04', block: 'Khunti, Jharkhand', childCount: 26, av: 'म' },
  children: [
    { id: 'JH-001', name: 'Rahul Munda', age: '6 yrs', nameHi: 'राहुल मुंडा', status: 'normal' },
    { id: 'JH-002', name: 'Priya Soren', age: '5 yrs', nameHi: 'प्रिया सोरेन', status: 'normal' },
    { id: 'JH-003', name: 'Suresh Oraon', age: '4 yrs', nameHi: 'सुरेश उरांव', status: 'critical' },
    { id: 'JH-004', name: 'Anita Toppo', age: '4 yrs', nameHi: 'अनिता टोप्पो', status: 'pending' },
    { id: 'JH-005', name: 'Kavita Hansda', age: '3 yrs', nameHi: 'कविता हांसदा', status: 'vaccine' }
  ],
  sarrResult: [
    { name: 'Attendance', nameHi: 'हाज़िरी', value: 'Rahul: absent', valueHi: 'राहुल: नहीं आया', confidence: 0.97, tier: 1 },
    { name: 'Ration', nameHi: 'राशन', value: 'Priya: double ration', valueHi: 'प्रिया: दुगना राशन', confidence: 0.91, tier: 2 },
    { name: 'Health', nameHi: 'सेहत', value: 'Meera: weigh pending', valueHi: 'मीरा: वज़न नापना बाकी', confidence: 0.85, tier: 3 }
  ],
  healthRisk: {
    name: 'Suresh Oraon', nameHi: 'सुरेश उरांव',
    age: 'Boy, age 4 years', ageHi: 'लड़का, उम्र 4 साल',
    zscore: -3.5, category: 'SAM', riskLevel: 'critical',
    earlyWarning: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
    earlyWarningHi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।',
    vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '14/20 days' }
  },
  eceActivity: {
    name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
    duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
    desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns by name.',
    descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। फिर नाम लेकर अगली बारी।',
    focusChildren: [
      { name: 'Suresh Oraon', nameHi: 'सुरेश उरांव', flag: 'Low weight alert', flagHi: 'कम वज़न', note: 'Give Suresh a seated role.', noteHi: 'सुरेश को बैठे-बैठे काम दो।' },
      { name: 'Anita Toppo', nameHi: 'अनिता टोप्पो', flag: 'Shy', flagHi: 'शर्मीली है', note: 'Let Anita hold the music card.', noteHi: 'अनिता को गाने का कार्ड थमाओ।' }
    ]
  }
};

/* ============================================================================
   WORKERS — multi-worker dataset for voice/tap login.
   Each worker gets a DIFFERENT dashboard (profile, children, triage, critical).
   `match` = lowercase tokens (name + centre number, Hindi & English) used to
   match what the worker says into the microphone.
   Helper L(obj) in index.html resolves { en, hi } by current language.
   ============================================================================ */
const WORKERS = [
  {
    id: 'AWW_KH_04', av: { en: 'M', hi: 'म' },
    name: { en: 'Meera Devi', hi: 'मीरा देवी' },
    centre: 'AWC 04', block: { en: 'Khunti, Jharkhand', hi: 'खूंटी, झारखंड' },
    childCount: 26,
    match: ['meera', 'मीरा', '04', 'char', 'chaar', 'चार', 'میرا', 'char', 'मीरा देवी', 'मीरादेवी', 'मिर', 'चार'],
    critical: {
      childId: 'JH-003',
      name: { en: 'Suresh Oraon', hi: 'सुरेश उरांव' },
      age: { en: 'Boy, age 4 years', hi: 'बच्चा, उम्र 4 साल' },
      zscore: -3.5, category: 'SAM',
      warning: {
        en: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
        hi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में बिगड़ सकती है।'
      },
      vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '5/20' }
    },
    triage: [
      { childId: 'JH-003', tier: 'critical', name: { en: 'Suresh Oraon', hi: 'सुरेश उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Weight dropping 3 months. Measure today.', hi: 'वज़न 3 महीने से घट रहा। आज नापो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { childId: 'JH-004', tier: 'critical', name: { en: 'Anita Toppo', hi: 'अनीता टोप्पो' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Mild decline detected. Watch closely.', hi: 'हल्की गिरावट। ध्यान दो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { childId: 'JH-001', tier: 'pending', name: { en: 'Rahul Munda', hi: 'राहुल मुंडा' }, age: { en: '6 yrs', hi: '6 साल' }, ds: { en: 'Absent 5 days. Back today.', hi: '5 दिन नहीं आया। आज लौटा।' }, tag: { en: 'Back today', hi: 'आज लौटा' } },
      { childId: 'JH-002', tier: 'remaining', name: { en: 'Priya Soren', hi: 'प्रिया सोरेन' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Vitamin A vaccine due today.', hi: 'विटामिन A का टीका आज बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_MU_12', av: { en: 'S', hi: 'सु' },
    name: { en: 'Sunita Kumari', hi: 'सुनीता कुमारी' },
    centre: 'AWC 12', block: { en: 'Murhu, Jharkhand', hi: 'मुरहू, झारखंड' },
    childCount: 31,
    match: ['sunita', 'सुनीता', '12', 'barah', 'बारह', 'سنیتا', 'सुनिता', 'सनिता', 'सनीता', 'बारह'],
    critical: {
      name: { en: 'Anil Munda', hi: 'अनिल मुंडा' },
      age: { en: 'Boy, age 2 years 8 months', hi: 'बच्चा, उम्र 2 साल 8 महीने' },
      zscore: -3.0, category: 'SAM',
      warning: {
        en: 'Diarrhoea twice this month. Weight stalled. Needs a home visit.',
        hi: 'इस महीने दो बार दस्त। वज़न रुका हुआ। घर जाकर देखो।'
      },
      vitals: { weight: '8.4 kg', height: '84 cm', arm: '11.1 cm', attendance: '15/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Anil Munda', hi: 'अनिल मुंडा' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Diarrhoea twice. Home visit needed.', hi: 'दो बार दस्त। घर जाकर देखो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { tier: 'pending', name: { en: 'Geeta Oraon', hi: 'गीता उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'No info for 4 days.', hi: '4 दिन से कुछ दर्ज नहीं।' }, tag: null },
      { tier: 'pending', name: { en: 'Mahesh Munda', hi: 'महेश मुंडा' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Missed weighing twice.', hi: 'दो बार वज़न नहीं हुआ।' }, tag: null },
      { tier: 'remaining', name: { en: 'Pooja Devi', hi: 'पूजा देवी' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Deworming pill due.', hi: 'पेट के कीड़े की दवा बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_KA_07', av: { en: 'P', hi: 'फू' },
    name: { en: 'Phoolmani Devi', hi: 'फूलमणि देवी' },
    centre: 'AWC 07', block: { en: 'Karra, Jharkhand', hi: 'कर्रा, झारखंड' },
    childCount: 19,
    match: ['phoolmani', 'phulmani', 'फूलमणि', '07', 'saat', 'सात', 'پھولمنی', 'फूलमनी', 'फुलमनी', 'फूलनी', 'सात'],
    critical: {
      name: { en: 'Lakshmi Oraon', hi: 'लक्ष्मी उरांव' },
      age: { en: 'Girl, age 4 years 1 month', hi: 'बच्ची, उम्र 4 साल 1 महीना' },
      zscore: -2.6, category: 'MAM',
      warning: {
        en: 'Slipped from normal to weak this month. Watch closely.',
        hi: 'इस महीने ठीक से कमज़ोर हुई। ध्यान से देखो।'
      },
      vitals: { weight: '12.1 kg', height: '98 cm', arm: '12.4 cm', attendance: '18/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Lakshmi Oraon', hi: 'लक्ष्मी उरांव' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Slipped to weak this month. Watch.', hi: 'इस महीने कमज़ोर हुई। ध्यान दो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { tier: 'pending', name: { en: 'Sanjay Munda', hi: 'संजय मुंडा' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'No info for 3 days.', hi: '3 दिन से कुछ दर्ज नहीं।' }, tag: null },
      { tier: 'remaining', name: { en: 'Kiran Devi', hi: 'किरण देवी' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Vitamin A vaccine due.', hi: 'विटामिन A का टीका बाकी।' }, tag: null }
    ]
  },
  {
    id: 'AWW_TO_21', av: { en: 'R', hi: 'रे' },
    name: { en: 'Rekha Devi', hi: 'रेखा देवी' },
    centre: 'AWC 21', block: { en: 'Torpa, Jharkhand', hi: 'तोरपा, झारखंड' },
    childCount: 24,
    match: ['rekha', 'रेखा', '21', 'ikkis', 'इक्कीस', 'ریکھا', 'रीखा', 'रेका', 'इक्कीस'],
    critical: {
      name: { en: 'Budhan Singh', hi: 'बुधन सिंह' },
      age: { en: 'Boy, age 3 years 5 months', hi: 'बच्चा, उम्र 3 साल 5 महीने' },
      zscore: -3.4, category: 'SAM',
      warning: {
        en: 'Lowest weight in centre. Family migrating soon. Refer now.',
        hi: 'केंद्र में सबसे कम वज़न। परिवार जल्द जाने वाला। अभी रेफर करो।'
      },
      vitals: { weight: '9.0 kg', height: '92 cm', arm: '10.5 cm', attendance: '9/22' }
    },
    triage: [
      { tier: 'critical', name: { en: 'Budhan Singh', hi: 'बुधन सिंह' }, age: { en: '3 yrs', hi: '3 साल' }, ds: { en: 'Lowest weight. Family migrating. Refer.', hi: 'सबसे कम वज़न। परिवार जा रहा। रेफर करो।' }, tag: { en: 'Very weak', hi: 'बहुत कमज़ोर' } },
      { tier: 'critical', name: { en: 'Sita Kumari', hi: 'सीता कुमारी' }, age: { en: '2 yrs', hi: '2 साल' }, ds: { en: 'Arm thin. Weigh today.', hi: 'बाँह पतली। आज वज़न नापो।' }, tag: { en: 'Weak', hi: 'कमज़ोर' } },
      { tier: 'pending', name: { en: 'Vikash Munda', hi: 'विकाश मुंडा' }, age: { en: '4 yrs', hi: '4 साल' }, ds: { en: 'Absent 6 days.', hi: '6 दिन नहीं आया।' }, tag: { en: 'Absent', hi: 'गैरहाज़िर' } },
      { tier: 'remaining', name: { en: 'Anjali Devi', hi: 'अंजली देवी' }, age: { en: '5 yrs', hi: '5 साल' }, ds: { en: 'Deworming pill due.', hi: 'पेट के कीड़े की दवा बाकी।' }, tag: null }
    ]
  }
];

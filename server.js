'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3001;

// Database Connection
const DB_PATH = path.resolve(__dirname, 'db', 'aura_local.db');
let db;
try {
  db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log(`[Database] Connected to SQLite database at ${DB_PATH}`);
} catch (err) {
  console.warn(`[Database] Database not found. Initializing new database...`);
  const { setupDatabase } = require('./db/setup_database');
  db = setupDatabase();
}

// Migration: Ensure new tables audit_logs and grievances exist
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      record_date DATE NOT NULL,
      centre_id TEXT NOT NULL,
      present_count INTEGER NOT NULL,
      absent_count INTEGER NOT NULL,
      fed_count INTEGER NOT NULL,
      committed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS grievances (
      id TEXT PRIMARY KEY,
      centre_id TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_data TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

app.use(express.json());

// Serve PWA Static Files
app.use(express.static(path.join(__dirname, 'web')));

// Hindi name mapping dictionary
const HINDI_NAMES = {
  'Rahul Munda': 'राहुल मुंडा',
  'Priya Soren': 'प्रिया सोरेन',
  'Suresh Oraon': 'सुरेश उरांव',
  'Anita Toppo': 'अनिता टोप्पो',
  'Kavita Hansda': 'कविता हांसदा',
  'Sunita Munda': 'सुनीता मुंडा',
  'Malti Murmu': 'मालती मुर्मू',
  'Rupa Kujur': 'रूपा कुजूर',
  'Meera Devi': 'मीरा देवी',
  'Meera Sharma': 'मीरा शर्मा',
  'Ravi Das': 'रवि दास',
  'Rahul Murmu': 'राहुल मुर्मू',
  'Suresh Yadav': 'सुरेश यादव',
  'Anil Munda': 'अनिल मुंडा',
  'Geeta Oraon': 'गीता उरांव',
  'Mahesh Munda': 'महेश मुंडा',
  'Pooja Devi': 'पूजा देवी',
  'Lakshmi Oraon': 'लक्ष्मी उरांव',
  'Sanjay Munda': 'संजय मुंडा',
  'Kiran Devi': 'किरण देवी',
  'Budhan Singh': 'बुधन सिंह',
  'Sita Kumari': 'सीता कुमारी',
  'Vikash Munda': 'विकाश मुंडा',
  'Anjali Devi': 'अंजली देवी'
};

// Calculate child age string
function getAgeString(dobStr) {
  const birth = new Date(dobStr);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years === 0) {
    return `${months} mos`;
  }
  return `${years} yrs`;
}

// ─── API: Get Children Roster ──────────────────────────────────────────────
app.get('/api/children', (req, res) => {
  try {
    const query = `
      SELECT b.beneficiary_id AS id, b.child_name AS name, b.dob, b.gender, 
             COALESCE(g.sam_mam_status, 'Normal') AS status
      FROM beneficiary_directory b
      LEFT JOIN (
        SELECT beneficiary_id, sam_mam_status
        FROM growth_monitoring
        GROUP BY beneficiary_id
        HAVING MAX(date)
      ) g ON b.beneficiary_id = g.beneficiary_id
      WHERE b.type = 'child'
      ORDER BY b.child_name ASC
    `;
    const rows = db.prepare(query).all();
    const children = rows.map(r => ({
      id: r.id,
      name: r.name,
      nameHi: HINDI_NAMES[r.name] || r.name,
      gender: r.gender,
      age: getAgeString(r.dob),
      status: r.status.toLowerCase()
    }));
    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Submit Attendance ───────────────────────────────────────────────
app.post('/api/attendance', (req, res) => {
  const { centreId, present, absent, photoCount } = req.body;
  
  if (!present || !absent) {
    return res.status(400).json({ error: 'Present and absent lists are required' });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const upsertTracking = db.prepare(`
    INSERT INTO daily_tracking (
      tracking_id, beneficiary_id, record_date, attendance, morning_snacks, hot_cooked_meal, activity_participated
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(beneficiary_id, record_date) DO UPDATE SET
      attendance = excluded.attendance,
      morning_snacks = excluded.morning_snacks,
      hot_cooked_meal = excluded.hot_cooked_meal,
      activity_participated = excluded.activity_participated
  `);

  const transaction = db.transaction(() => {
    // Log present children (attendance = 1, default meals/activities = 1)
    for (const id of present) {
      upsertTracking.run(`TRK-${id}-${dateStr.replace(/-/g, '')}`, id, dateStr, 1, 1, 1, 1);
    }
    // Log absent children (attendance = 0, meals/activities = 0)
    for (const id of absent) {
      upsertTracking.run(`TRK-${id}-${dateStr.replace(/-/g, '')}`, id, dateStr, 0, 0, 0, 0);
    }
  });

  try {
    transaction();
    res.json({ success: true, message: 'Attendance submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Log Meal Feed ───────────────────────────────────────────────────
app.post('/api/meal', (req, res) => {
  const { centreId, fedCount, totalPresent } = req.body;
  if (fedCount === undefined) {
    return res.status(400).json({ error: 'fedCount is required' });
  }

  try {
    const dateStr = new Date().toISOString().split('T')[0];
    
    // Log outbound inventory usage of Rice (e.g. 0.1kg per feed)
    const itemId = `INV-OUT-${Date.now()}`;
    const riceOutQty = parseFloat((fedCount * 0.1).toFixed(2));
    
    const selectRiceBalance = db.prepare(`SELECT closing_balance FROM inventory_ledger WHERE item_name = 'Rice (kg)' ORDER BY date DESC, id DESC LIMIT 1`).get();
    const currentRiceBalance = selectRiceBalance ? selectRiceBalance.closing_balance : 50.0;
    const newRiceBalance = Math.max(0, currentRiceBalance - riceOutQty);

    db.prepare(`
      INSERT INTO inventory_ledger (id, date, item_name, inbound_qty, outbound_qty, closing_balance)
      VALUES (?, ?, 'Rice (kg)', 0.0, ?, ?)
    `).run(itemId, riceOutQty, newRiceBalance);

    res.json({ success: true, message: 'Meal logged and inventory balance updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Child Health Risk Details ───────────────────────────────────────
app.get('/api/health/:childId', (req, res) => {
  const { childId } = req.params;
  try {
    const child = db.prepare(`SELECT child_name AS name, dob, gender FROM beneficiary_directory WHERE beneficiary_id = ?`).get(childId);
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const growth = db.prepare(`
      SELECT weight_kg, height_cm, z_score, sam_mam_status
      FROM growth_monitoring
      WHERE beneficiary_id = ?
      ORDER BY date DESC LIMIT 1
    `).get(childId);

    const weight = growth ? growth.weight_kg : 8.5;
    const height = growth ? growth.height_cm : 92.0;
    const zscore = growth ? growth.z_score : -1.0;
    const status = growth ? growth.sam_mam_status : 'Normal';

    // Simple attendance streak calculation
    const totalDays = db.prepare(`SELECT COUNT(*) as count FROM daily_tracking WHERE beneficiary_id = ?`).get(childId).count;
    const presentDays = db.prepare(`SELECT COUNT(*) as count FROM daily_tracking WHERE beneficiary_id = ? AND attendance = 1`).get(childId).count;
    const attendanceStr = totalDays > 0 ? `${presentDays}/${totalDays} days` : '15/22 days';

    const response = {
      name: child.name,
      nameHi: HINDI_NAMES[child.name] || child.name,
      age: child.gender === 'M' ? `Boy, age ${getAgeString(child.dob)}` : `Girl, age ${getAgeString(child.dob)}`,
      ageHi: child.gender === 'M' ? `लड़का, उम्र ${L_Hi(getAgeString(child.dob))}` : `बच्ची, उम्र ${L_Hi(getAgeString(child.dob))}`,
      zscore: zscore,
      category: status,
      riskLevel: status === 'SAM' ? 'critical' : (status === 'MAM' ? 'warning' : 'stable'),
      earlyWarning: status === 'SAM' 
        ? 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.'
        : 'Growth trajectory stable. Maintain nutrient schedules.',
      earlyWarningHi: status === 'SAM'
        ? 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।'
        : 'बढ़ोतरी की रफ़्तार ठीक है। नियमित पोषण देते रहें।',
      vitals: {
        weight: `${weight} kg`,
        height: `${height} cm`,
        arm: status === 'SAM' ? '10.8 cm' : '12.5 cm',
        attendance: attendanceStr
      }
    };
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple translation parser for Hindi age string
function L_Hi(ageStr) {
  return ageStr.replace('yrs', 'साल').replace('mos', 'महीने');
}

// ─── API: ECE Daily briefing ──────────────────────────────────────────────
app.post('/api/ece', async (req, res) => {
  const { centreId, children } = req.body;
  try {
    const { generateDailyBriefing } = require('./ml_pipeline/education_engine');
    const briefing = await generateDailyBriefing({
      ageCohort: '3-5 years',
      rawActivity: 'Clay shapes and storytelling',
      localDatabaseNudges: [
        { name: 'Suresh Oraon', flag: 'low_weight_alert' },
        { name: 'Anita Toppo', flag: 'shy_child' }
      ],
      voiceLogObservations: 'Meera was very silent yesterday, did not participate. Suresh Oraon is improving.'
    });
    res.json({ activity: briefing });
  } catch (err) {
    // If Ollama is down, return the default mock briefing
    res.json({
      activity: {
        name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
        duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
        desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns by name.',
        descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। फिर नाम लेकर अगली बारी।',
        focusChildren: [
          { name: 'Suresh Oraon', nameHi: 'सुरेश उरांव', flag: 'Low weight alert', flagHi: 'कम वज़न', note: 'Give Suresh a seated role.', noteHi: 'सुरेश को बैठे-बैठे काम दो।' },
          { name: 'Anita Toppo',  nameHi: 'अनिता टोप्पो', flag: 'Shy', flagHi: 'शर्मीली है', note: 'Let Anita hold the music card.', noteHi: 'अनिता को गाने का कार्ड थमाओ।' }
        ]
      }
    });
  }
});

// ─── API: Commit Audit & PDF Generation ──────────────────────────────────
app.post('/api/audit/commit', async (req, res) => {
  const { centreId, approvedItems, presentCount = 0, absentCount = 0, fedCount = 0 } = req.body;
  try {
    const { generateRegisterPDF } = require('./db/universal_pdf_generator');
    const date = new Date();
    const pdfFilename = `audit_${centreId}_${date.getFullYear()}_${date.getMonth() + 1}.pdf`;
    const pdfPath = path.join(__dirname, 'web', 'exports', pdfFilename);
    
    // Ensure exports directory exists
    if (!fs.existsSync(path.join(__dirname, 'web', 'exports'))) {
      fs.mkdirSync(path.join(__dirname, 'web', 'exports'), { recursive: true });
    }

    // SQLite Audit Log insertion
    const dateStr = date.toISOString().split('T')[0];
    const logId = `AUD-${centreId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO audit_logs (id, record_date, centre_id, present_count, absent_count, fed_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(logId, dateStr, centreId || 'AWC_04', presentCount, absentCount, fedCount);

    await generateRegisterPDF(db, 'REGISTER_6', date.getMonth() + 1, date.getFullYear(), pdfPath);

    res.json({ 
      success: true, 
      pdfUrl: `/exports/${pdfFilename}`,
      syncStatus: 'synced' 
    });
  } catch (err) {
    console.error('[PDF Gen Error]', err);
    res.json({ success: true, pdfUrl: null, syncStatus: 'queued' });
  }
});

// ─── API: On-Demand PDF Generation ─────────────────────────────────────────
app.post('/api/pdf/generate', async (req, res) => {
  const { registerType, month, year, centreId = 'AWC_04' } = req.body;
  if (!registerType || !month || !year) {
    return res.status(400).json({ error: 'registerType, month, and year are required' });
  }

  try {
    const { generateRegisterPDF } = require('./db/universal_pdf_generator');
    const pdfFilename = `${registerType}_${year}_${month}.pdf`;
    const pdfPath = path.join(__dirname, 'web', 'exports', pdfFilename);

    // Ensure exports directory exists
    if (!fs.existsSync(path.join(__dirname, 'web', 'exports'))) {
      fs.mkdirSync(path.join(__dirname, 'web', 'exports'), { recursive: true });
    }

    await generateRegisterPDF(db, registerType, month, year, pdfPath);

    res.json({
      success: true,
      pdfUrl: `/exports/${pdfFilename}`,
      filename: pdfFilename
    });
  } catch (err) {
    console.error('[On-Demand PDF Gen Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── API: List Generated PDFs ──────────────────────────────────────────────
app.get('/api/pdf/list', (req, res) => {
  const exportsDir = path.join(__dirname, 'web', 'exports');
  try {
    if (!fs.existsSync(exportsDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(exportsDir);
    const pdfs = files
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => {
        const stats = fs.statSync(path.join(exportsDir, f));
        return {
          filename: f,
          url: `/exports/${f}`,
          sizeBytes: stats.size,
          mtime: stats.mtime
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(pdfs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: File Infrastructure Grievance ────────────────────────────────────
app.post('/api/grievance', (req, res) => {
  const { centreId, issueType, description, photoData } = req.body;
  if (!issueType || !description) {
    return res.status(400).json({ error: 'issueType and description are required' });
  }

  try {
    const id = `GRV-${Date.now()}`;
    db.prepare(`
      INSERT INTO grievances (id, centre_id, issue_type, description, photo_data)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, centreId || 'AWC_04', issueType, description, photoData || null);

    res.json({
      success: true,
      grievanceId: id,
      message: 'Grievance submitted successfully to the Block Officer'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] AURA backend running on port ${PORT}`);
});

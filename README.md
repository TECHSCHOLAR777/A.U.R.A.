# A.U.R.A. — Anganwadi Unified Resource Assistant

A.U.R.A. is a secure, offline-first Progressive Web App (PWA) designed to automate daily administration and clinical monitoring for Anganwadi workers (AWC). It replaces physical paper registers with smart voice-routing checklists, local machine learning predictive engines, and on-demand government-compliant PDF register generations.

---

## 🚀 Teammate Quickstart Guide

Follow these steps to run, test, and evaluate A.U.R.A. on your local machine:

### 1. Prerequisites
- **Node.js** (v18.x or higher recommended)
- **Git**

### 2. Installation & Setup
Clone the repository and install the dependencies:
```bash
# Clone the repository
git clone https://github.com/TECHSCHOLAR777/A.U.R.A..git
cd A.U.R.A.

# Install dependencies (Express, Better-SQLite3, etc.)
npm install
```

### 3. Initialize the Local Database
A.U.R.A. runs a highly normalized 8-table SQLite relational database. Initialize and seed it with realistic historical test data (dated for **October 2026**):
```bash
node db/setup_database.js
```
*Note: This creates the local database file `db/aura_local.db`.*

### 4. Run the Server
Launch the Node.js Express server backend:
```bash
npm start
```
By default, the server runs on: **`http://localhost:3001`** (or port `3000` depending on environment configuration).

---

## 🧪 Testing the Changes & Features

Open your browser and navigate to **`http://localhost:3001`** (or the port shown in your terminal). Follow this testing flow to evaluate all integrated features:

### 1. Dashboard & Profile Setup
- Select the first profile **Meera Devi (AWC 04)**.
- Tap **शुरू करें (Start Day)** to initialize the session and enter the main dashboard.
- Toggle between Hindi/English using the selector in the header chrome.

### 2. On-Demand Government Registers (Feature 16)
The database registers are seeded with 20 days of historical tracking for **October 2026**.
- Scroll to the **📄 Government Datasheets** card widget.
- Select the **Month** as **10 (Oct / अक्टूबर)** and **Year** as **2026**.
- Select a register type (e.g. `Register No. 11: Growth Monitoring`).
- Click **Generate Register PDF**.
- Verify that a file named `REGISTER_11_2026_10.pdf` appears in your list. Click **Open** to download/print. 
- *Note: Look at the size difference! October PDFs are fully populated (~12 KB), whereas June PDFs are empty (~5 KB).*

### 3. Last-Mile Infrastructure Grievance Portal (Feature 15)
- Scroll down to the red **Infrastructure Grievance Portal** card.
- Click **File Grievance** (शिकायत दर्ज करें).
- Select **Broken Toilet / Sanitation** as the issue type.
- Enter a description (e.g. `"The toilet door lock is broken and toilet bowl needs repair."`) and select **Send Report to Block Officer**.
- To verify it saved, check the database records:
  ```bash
  node -e "const db = new (require('better-sqlite3'))('./db/aura_local.db'); console.log(db.prepare('SELECT * FROM grievances').all());"
  ```

### 4. Spoken Input Confidence Routing (Feature 11)
- Tap the slot for **Spoken Registers** (or equivalent voice checklist trigger).
- Verify the three-tier confirmation logic built to validate voice inputs:
  - **Tier 1 (>=92% confidence):** Displays a green checkmark and auto-saves.
  - **Tier 2 (90%-91% confidence):** Displays a warning and requires the worker to toggle a confirmation checkbox.
  - **Tier 3 (<90% confidence):** Displays in red and forces the worker to select the child's name from a manual dropdown before saving.

### 5. Reflection Audit Logs (Feature 12)
- Mark some children present or absent on the attendance checklist.
- Navigate to the **Reflection Audit** screen at the end of the day.
- Verify that the summary details (Attendance present/absent count, meal count) update dynamically based on the current session's activities.
- Click **Approve**.
- To verify the audit committed successfully, inspect the audit logs:
  ```bash
  node -e "const db = new (require('better-sqlite3'))('./db/aura_local.db'); console.log(db.prepare('SELECT * FROM audit_logs').all());"
  ```

### 6. Clinical Calculations & Explainable SAM Risk Alerts (Features 8, 9 & 10)
- View the children triage lists. Children flagged with severe acute malnutrition (SAM) are identified mathematically using deterministic WHO Z-score calculations.
- Tap a child flagged as high risk (e.g., **Suresh Oraon**). 
- Verify the **LightGBM Early Warning System** running client-side. The Express server computes 8 dynamic ML features (Z-score velocity, acceleration, rolling min, attendance rate, missed vaccine streak, migrant flag) over the last 10 days of database logs and returns them.
- The browser runs the LightGBM tree-inference engine using `aura_sam_predictor_80kb.txt` to calculate risk probabilities.
- Verify the **Explainable AI (XAI)** plain-language reason generated dynamically in Hindi or English (e.g., listing critical wasting, declining weight velocity, low attendance, and migrant status).

### 7. Headcount Verification (Feature 14)
- Click the camera verification box (📷) on the **Today's Attendance (आज की हाज़िरी)** screen.
- Upload a classroom photo to trigger the client-side **YOLOv8 ONNX model** and **Zero-DCE light-enhancement WebGL canvas pipeline**.
- The app detects children, compares the headcount against registered attendance, and displays a mismatch warning in amber/orange if they differ, or a green success box if they match.
- **E2E Test Hook:** Navigate to `http://localhost:3000/?test_yolo=1` to auto-load a mock classroom photo (`/test_classroom.png`) containing 8 children, run YOLOv8, and view the visual result.

### 8. Whisper Tiny Voice Engine (ASR & SARR)
- Speak instructions into any microphone button (e.g. SARR voice screen, Grievance voice description, or Meal voice logging).
- The app displays an animated pulsing recording modal, records mic audio, and runs **Whisper Tiny** fully client-side using `transformers.js` to transcribe speech.
- The transcription is sent to the server `/api/sarr` endpoint, which matches name tokens phonetically against real SQLite records and routes commands to appropriate registers.
- **E2E Test Hook:** Navigate to `http://localhost:3000/?test_whisper=1` to test loading, compiling, and initializing the Whisper Tiny model on your device.

---

## 📁 Repository Structure

```
├── db/
│   ├── setup_database.js         # SQLite schema configuration & seeding logic
│   ├── universal_pdf_generator.js# Border grid and tables PDF generation logic
│   └── aura_local.db             # Generated SQLite database file
├── ml_pipeline/
│   ├── whisper_engine.js         # Core Whisper ASR transcription logic
│   └── vision_engine.js          # Core YOLOv8 headcount logic
├── web/
│   ├── index.html                # Frontend PWA dashboard, router, and screen layouts
│   ├── aura-api.js               # Client API sockets, queuing, and sync methods
│   ├── exports/                  # Saved generated register PDFs
│   ├── ml_pipeline/              # On-device ML models & vision files
│   │   ├── yolov8n.onnx          # YOLOv8 target weight file
│   │   ├── who_standards.json    # Deterministic Z-score WHO database
│   │   ├── vision_engine.js      # Zero-DCE + YOLO visual headcount module
│   │   ├── ml_inference.js       # LightGBM malnutrition predictor & XAI engine
│   │   └── whisper_engine.js     # Transformers.js client-side Whisper ASR engine
│   └── sw.js                     # Offline asset caching & sync service worker
├── server.js                     # Node/Express backend routing and SQLite APIs
├── plan.md                       # A.U.R.A implementation roadmap
└── implementation_plan.md        # Technical specification plan
```

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

# Install dependencies (Express, Better-SQLite3, jsPDF, etc. at root)
npm install
```

### 3. Whisper Tiny Offline Model Setup (ASR)
The Whisper Tiny ONNX model files are **automatically downloaded** to your local workspace during the `npm install` post-installation step (stored in `web/ml_pipeline/models/Xenova/whisper-tiny/`). No manual action is required.
The app's transformers.js pipeline is locked to look up these files locally, blocking external HF Hub network calls so that ASR operates 100% offline.

### 4. Initialize the Local Database
A.U.R.A. runs a highly normalized 8-table SQLite relational database. Initialize and seed it with realistic historical test data (dated for **October 2026**):
```bash
node db/setup_database.js
```
*Note: This creates the local database file `db/aura_local.db`.*

### 5. Run the Server
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
- **Dynamic Bindings:** Notice that the triage alerts count on the dashboard card is dynamically calculated based on the actual SAM/MAM children currently in the database.

### 2. Dynamic Triage Screen (Feature 11)
- Click on the dashboard triage alert card.
- Children are dynamically fetched from the SQLite database and sorted into tiers in real time:
  - **Critical (See Now):** Children flagged with `'SAM'` or `'MAM'`.
  - **Pending:** Children who have not yet been marked present/absent today.
  - **Remaining:** All other children.
- Clicking any child loads their clinical details dynamically from the database.

### 3. Interactive Morning Attendance Checklist
- Navigate to **Today's Attendance (आज की हाज़िरी)**.
- The screen dynamically lists **all** children from the database.
- By default, all children start as present (`✓` green).
- Tap on any child to toggle them to absent (`✕` red). All headers, progress counts, absent tags, and attendance percentages update in real time.
- Clicking **Review & send** submits these dynamic present/absent lists to the backend SQLite store.

### 4. Headcount Verification (Feature 14)
- Click the camera verification box (📷) on the **Today's Attendance** screen.
- Upload a classroom photo to trigger the client-side **YOLOv8 ONNX model** and **Zero-DCE light-enhancement WebGL canvas pipeline**.
- The app detects children, compares the headcount against the active attendance count, and displays a mismatch warning if they differ, or a green success box if they match.
- **E2E Test Hook:** Navigate to `http://localhost:3001/?test_yolo=1` to auto-load a mock classroom photo (`/test_classroom.png`) containing 8 children, run YOLOv8, and view the visual result.

### 5. Hot Meals (meal) & Audit Review (Feature 12)
- Feed counts and progress bars on the **Hot Meal (गरम खाना)** screen render dynamically relative to today's active attendance session.
- The **Day Review (Audit)** screen dynamically lists and submits the final attendance totals and photo verification headcounts before finalizing the day.

### 6. Last-Mile Infrastructure Grievance Portal (Feature 15)
- Scroll down to the red **Infrastructure Grievance Portal** card.
- Click **File Grievance** (शिकायत दर्ज करें).
- Select **Broken Toilet / Sanitation** as the issue type.
- Tap **Capture Photo evidence (तस्वीर प्रमाण)**. This triggers the native camera/file-picker, reads the image as a Base64 string, and shows a thumbnail preview in the card.
- Enter a description (e.g. `"The toilet door lock is broken and needs repair."`) and select **Send Report to Block Officer**.
- To verify it saved, check the database records:
  ```bash
  node -e "const db = new (require('better-sqlite3'))('./db/aura_local.db'); console.log(db.prepare('SELECT * FROM grievances').all());"
  ```

### 7. On-Demand Government Registers (Feature 16)
- Scroll to the **📄 Government Datasheets** card widget.
- Select the **Month** as **10 (Oct / अक्टूबर)** and **Year** as **2026**.
- Select a register type (e.g. `Register No. 11: Growth Monitoring`).
- Click **Generate Register PDF**.
- Click **Open** to download/print the generated PDF. 
- *Note: Root dependency imports of `jspdf` and `jspdf-autotable` are configured to prevent server-side crashes during PDF rendering.*

### 8. Whisper Tiny Voice Engine (ASR & SARR)
- Speak instructions into any microphone button (e.g. SARR voice screen, Grievance voice description, or Meal voice logging).
- The app displays an animated pulsing recording modal, records mic audio, and runs **Whisper Tiny** fully client-side using `transformers.js` to transcribe speech.
- The transcription is sent to the server `/api/sarr` endpoint, which matches name tokens phonetically against real SQLite records and routes commands to appropriate registers.
- **E2E Test Hook:** Navigate to `http://localhost:3001/?test_whisper=1` to test loading, compiling, and initializing the Whisper Tiny model on your device.

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
│   │   ├── whisper_engine.js     # Transformers.js client-side Whisper ASR engine
│   │   └── models/               # Local Whisper Tiny model weights cache
│   └── sw.js                     # Offline asset caching & sync service worker
├── server.js                     # Node/Express backend routing and SQLite APIs
├── plan.md                       # A.U.R.A implementation roadmap
└── implementation_plan.md        # Technical specification plan
```

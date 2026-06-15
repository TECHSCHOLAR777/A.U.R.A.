# AURA: Offline-Native EdTech Platform

AURA is an offline-first, performance-optimized EdTech application designed specifically for low-end Android devices. The platform facilitates adaptive learning, activity tracking, and infrastructure grievance reporting without requiring a persistent internet connection.

## 🚀 Core Features

*   **Offline-First Sync Engine:** The application is fully functional offline. User actions and updates are queued locally and automatically pushed to the cloud once network connectivity is restored.
*   **Contextual Bandit Engine:** Features a local machine learning implementation utilizing an epsilon-greedy algorithm (eps=0.1) and Stochastic Gradient Descent (SGD) to adjust and optimize activity recommendations based on a dynamic context vector (`[age-mix, materials, domain]`).
*   **Zero-PII Cloud Sync:** Security and privacy are paramount. Absolutely no Personally Identifiable Information (no child names, UUIDs, or sensitive health data) leaves the device. The application exclusively pushes aggregated, anonymous weight vectors to the cloud.

## 🏗 Architecture & Tech Stack

AURA operates under strict memory constraints (sub-300MB tab budget). To achieve this, we have deliberately bypassed modern bundlers.

*   **Frontend:** Pure Vanilla JavaScript, HTML, and CSS. No Vite, Webpack, or heavy UI frameworks. Dependencies are imported directly via CDNs.
*   **Local Storage Layer (`aura-api.js`):** Built on **Dexie.js** (IndexedDB). It manages a reliable offline queue (`syncQueue`) and locally persists the machine learning weights (`banditWeights`), gracefully degrading to `localStorage` if necessary.
*   **Math Engine (`bandit_engine.js`):** A lightweight, self-contained Javascript class that processes rewards, updates contextual weights via SGD, and enforces the Zero-PII rule locally.
*   **Cloud Layer:** Powered by **Supabase**. Sync requests pull from the Dexie queue, push strictly anonymous data, and selectively purge successful local operations.

## 🛠 Setup & Installation

Because AURA is a Vanilla JS application, there is no `npm install` or build step required to run the client. 

1. Clone the repository:
   ```bash
   git clone https://github.com/TECHSCHOLAR777/A.U.R.A..git
   cd AURA
   ```
2. Serve the `web` directory using any static file server. For example, using VS Code's "Live Server" extension, or via Python:
   ```bash
   cd web
   python -m http.server 3000
   ```
3. Open `http://localhost:3000` in your browser.

## ⚙️ Environment Configuration

To enable the Cloud Sync feature, you must configure your Supabase backend.

1. Copy `web/config.example.js` to `web/config.js`.
2. Open `web/config.js` and replace the dummy values with your actual Supabase project keys:
   ```javascript
   window.ENV = {
     SUPABASE_URL: "YOUR_SUPABASE_URL_HERE",
     SUPABASE_KEY: "YOUR_SUPABASE_KEY_HERE"
   };
   ```

### Supabase RLS Policies
Ensure you have created a `bandit_weights` table in your Supabase project. You must apply strict Row Level Security (RLS) policies to secure the data:
*   **Enable RLS:** `ALTER TABLE bandit_weights ENABLE ROW LEVEL SECURITY;`
*   **Insert/Upsert Policy:** Allow anonymous inserts only for payloads that match the required schema (e.g., ensuring no PII fields exist).

## QA & Testing Guide

We have built a custom on-screen debug panel to make E2E testing of the offline architecture seamless. Please follow these step-by-step instructions to validate the "Anonymous Bandit Weight Vector & Supabase Sync" feature.

### 1. Offline Queuing & State Management
1. Launch the app and look at the bottom right corner for the floating **🔧 Debug Panel**.
2. Click the **Offline Sim: OFF** button. It will turn red and read **Offline Sim: ON**. This intercepts network calls and prevents the app from reaching Supabase.
3. Tap on children in the UI grid to toggle their attendance (this generates contextual rewards for the Bandit Engine).
4. Verify that the **Sync Queue** length indicator in the debug panel increments as the Bandit Engine queues up local IndexedDB (Dexie) operations.

### 2. Live Synchronization
1. Toggle the Offline Sim back to **OFF** (online state).
2. Click the **Trigger Sync** button in the debug panel.
3. Verify that the on-screen **Sync Queue** immediately flushes back to `0`.

### 3. Zero-PII Verification (Crucial)
We must explicitly verify our security constraints. During the sync process, you must inspect the network payload to ensure no sensitive data is leaked.
1. Open the Chrome DevTools and navigate to the **Network** tab.
2. Perform a sync (as described in step 2) and locate the request to Supabase.
3. Inspect the Request Payload. It should look like an anonymous aggregate weight vector (e.g., `{ timestamp: "...", aggregate_weights: {...}, device_uuid: "anonymous-device" }`).
4. **CRITICAL:** Fail the test immediately if you see ANY child names, UUIDs, or individual health data in the payload. Absolutely no Personally Identifiable Information (PII) should be present.

### 4. Database Verification
1. Open your Supabase web dashboard.
2. Navigate to **Table Editor** -> `bandit_weights`.
3. Verify that the new anonymous weight vector data successfully landed in the cloud database.
# AURA Production Deployment Guide

A.U.R.A. (Anganwadi Unified Resource Assistant) is built as a cloud-compatible Node.js + Express backend serving a Progressive Web App (PWA) frontend. This guide explains how to deploy the application to cloud platforms and connect it to production databases.

---

## Architecture Overview

1. **PWA Frontend (`web/index.html`, modules)**: Serves the client-side Bayesian Knowledge Tracing (BKT) engine, Dexie/IndexedDB storage, and offline-first queue logic. Runs fully on-device.
2. **REST API Backend (`web/server.js`)**: Serves the retrieved stimulation activities, DSS screener structure, and aggregates stats. Runs in Node.js.
3. **Cloud Database (Supabase)**: Dynamically synced client-side using Zero-PII compliance to store bandit weight updates and aggregated anonymous stats.

---

## 🔒 Security & Environment Variables
We use a secure **zero-PII configuration pattern** where your database credentials are never committed to Git. Instead, the backend injects environment variables into the client session at runtime via a dynamic `/config.js` script.

The server respects the following environment variables:
* `PORT`: The port the Express server listens on (default: `3000`, set automatically by cloud hosts).
* `SUPABASE_URL`: The URL of your Supabase project (used by client-side sync).
* `SUPABASE_KEY`: The public anonymized `anon` key of your Supabase project.

---

## Deployment Option A: Railway (Recommended)
[Railway.app](https://railway.app/) is the fastest and easiest way to deploy AURA. It auto-detects Node.js, respects root-level scripts, and handles automatic deployments.

### Step-by-Step
1. Create a free account at [Railway.app](https://railway.app/).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Choose your AURA repository.
4. Go to the **Variables** tab of the service and add your credentials:
   * `SUPABASE_URL` = `https://your-project.supabase.co`
   * `SUPABASE_KEY` = `your-anon-public-key`
5. Railway will automatically run `npm install` and start the server using the root `npm start` command.
6. Under **Settings**, click **Generate Domain** to get a secure `https://...` URL.
   > [!IMPORTANT]
   > PWA service workers require a secure HTTPS context to register and run offline functionality on the Anganwadi workers' mobile devices.

---

## Deployment Option B: Render
[Render.com](https://render.com/) offers a robust and developer-friendly free tier for hosting Node.js services.

### Step-by-Step
1. Sign up on [Render.com](https://render.com/).
2. Click **New +** → **Web Service**.
3. Link your GitHub account and select your AURA repository.
4. Configure the service settings:
   * **Language**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start`
5. Click **Advanced** and add your environment variables:
   * `SUPABASE_URL` = `https://your-project.supabase.co`
   * `SUPABASE_KEY` = `your-anon-public-key`
6. Click **Create Web Service**. Render will build and deploy AURA, issuing an HTTPS domain automatically.

---

## Deployment Option C: Docker (Self-Hosted / VPS)
For regional deployments close to rural centers (e.g., AWS Mumbai / DigitalOcean India), you can containerize the server.

### 1. Create a `Dockerfile`
Create a file named `Dockerfile` in the root directory:
```dockerfile
FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "web/server.js"]
```

### 2. Build and Run
```bash
docker build -t aura-app .
docker run -p 3000:3000 \
  -e SUPABASE_URL="https://your-project.supabase.co" \
  -e SUPABASE_KEY="your-anon-public-key" \
  aura-app
```

---

## 🛠️ Post-Deployment Verification
Once your service is live and running over HTTPS:
1. Open your secure URL (e.g. `https://aura-production.up.railway.app`).
2. Go to the **More** screen in the PWA.
3. Check the **Data Sync** widget.
4. If `SUPABASE_URL` and `SUPABASE_KEY` are provided, the PWA will sync cached offline actions and bandit parameters when the device goes online.

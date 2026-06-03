# A.U.R.A — Web Frontend (PWA)

Offline-first, voice-first Progressive Web App for Anganwadi frontline workers.
No password, works in tribal dialects, updates 17 ICDS registers from one sentence.

## Files

| File | Purpose |
|---|---|
| `index.html` | Full UI — 13 screens, Hindi/English toggle, voice login, per-worker dashboards |
| `aura-api.js` | Backend integration surface — all API sockets + 4-worker dataset + mock fallback |
| `sw.js` | Service worker — network-first HTML, offline cache, background sync stubs |
| `manifest.json` | PWA manifest — installable, standalone, app shortcuts |
| `icon.svg` | App icon |
| `API_CONTRACT.md` | Maps every frontend socket to the real backend function + integration guide |

## Run locally

Must be served over http (service workers won't load from file://):

    cd web && npx serve .

Or serve via the root server.js:

    node ../server.js   # serves this folder + /api/* on :3001

## Deploy standalone

Drag this folder onto https://app.netlify.com/drop — instant public HTTPS link.

## Wire the backend

Open `aura-api.js`. Every function is annotated with the exact backend function,
file path, and integration style. See `API_CONTRACT.md` for the full table.

## Voice login

Uses the browser's built-in Web Speech API for the demo. The socket for
on-device sherpa-onnx ASR (offline, tribal dialects) is in `aura-api.js` under
`transcribeVoice` — marked `[NOT BUILT]`, ready to connect.

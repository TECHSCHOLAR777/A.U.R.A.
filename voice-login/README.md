# AURA Voice-First Login (standalone module)

Owner: Parv Bansal. This folder is a self-contained voice login feature for
A.U.R.A. It does not import, modify, or depend on anything in `web/` or
`ml_pipeline/`. The main app keeps working exactly as it does today; this
module can be adopted later through a 10-line adapter (see INTEGRATION.md).

## What it does

The worker taps a mic button and says her name and centre in Hindi, English,
or mixed speech. The module transcribes, matches the words against a worker
directory (Latin, Devanagari, and Urdu-script tokens), and emits a `match`
event with the worker profile. If nothing matches, it emits `nomatch` so the
UI can fall back to typing or tapping a name. It can never dead-end: every
path settles in matched, nomatch, or a clearly reported error.

## Engine decision (zero cost requirement)

| Option | Cost | Offline | Setup | Verdict |
|---|---|---|---|---|
| Web Speech API (browser built-in) | Rs 0, no keys | No (Chrome routes audio to Google) | None | Default engine, ships working today |
| Whisper Tiny in-browser (already in ml_pipeline/) | Rs 0 | Yes, after ~40 MB first download | Already in repo, currently unstable (WASM/COOP issues per commit log) | Plugs into this module via the `transcriber` socket, one function |
| Vosk (vosk-browser, Apache-2.0) | Rs 0 | Yes, ~42 MB Hindi model | Moderate | Alternative offline engine if Whisper keeps fighting WASM |
| sherpa-onnx | Rs 0 | Yes | Heavy build | Production north star (matches the pitch), not a tonight job |
| Bhashini (Govt of India ULCA API) | Free tier | No | Registration + API key | Politically ideal for the govt pitch, add when keys exist |
| Google STT / Sarvam / Deepgram | Paid | No | Keys + billing | Excluded by requirement |

Decision: ship Web Speech API as the default (free, no keys, works now on
Chrome for Android, which is the realistic AWW device), and expose a
`transcriber` socket so the team's Whisper engine, Vosk, or Bhashini can be
slotted in later without changing the UI or this module's API.

Honesty note: Chrome implements Web Speech by sending audio to Google's
servers, so the voice path needs connectivity and is not on-device. The
offline-first claim in the pitch is fulfilled by the Whisper or sherpa-onnx
engine through the `transcriber` socket, not by Web Speech.

## Files

| File | Purpose |
|---|---|
| `aura-voice.js` | The engine. Dependency-free, UMD, ~280 lines. Web Speech engine built in plus the `transcriber` socket. |
| `workers.js` | Default worker directory: 4 workers with enriched match tokens (Latin, Devanagari, Urdu-script, ASR misspellings, centre numbers in digits and words). Same shape as `web/aura-api.js` WORKERS, so the app's dataset can be passed in directly. |
| `demo.html` | Self-contained demo page in the AURA design language: mic, live transcript, match profile, type and pick fallbacks, Hindi/English toggle. |
| `INTEGRATION.md` | How to plug in the Whisper engine and how the main app adopts this module later. |

## Quick start

Web Speech needs a secure context, so serve over https or localhost:

    cd voice-login
    npx serve .

Open the URL in Chrome, tap the mic, say for example
"mera naam Sunita, kendra barah". Typing and pick-list fallbacks are on the
same screen.

## API

    const login = AuraVoiceLogin.create({
      workers: AURA_WORKERS,   // or the app's own WORKERS array
      lang: 'hi-IN',           // Web Speech recognition language
      timeoutMs: 8000,         // Web Speech safety timeout
      recordMs: 5000,          // transcriber engine max recording length
      engine: 'auto',          // 'auto' | 'webspeech' | 'transcriber'
      transcriber: null        // async (audioBlob) => ({ text })
    });

    login.on('state', s => {});       // idle | listening | recording |
                                      // processing | matched | nomatch |
                                      // error | unsupported
    login.on('transcript', t => {});  // { text, isFinal } live transcript
    login.on('match', m => {});       // { worker, score, transcript }
    login.on('nomatch', n => {});     // { transcript }
    login.on('error', e => {});       // { code, fatal, message }

    login.start();    // begin listening or recording
    login.stop();     // finish early with what was heard
    login.cancel();   // silent abort back to idle

    AuraVoiceLogin.isSupported('webspeech' | 'transcriber');
    AuraVoiceLogin.matchWorker(text, workers);   // pure function

## Matching

Transcripts are normalized (lowercase, NFC, punctuation and Devanagari danda
stripped) and scored against each worker's `match` tokens: whole-word hits
score highest, substring hits count for tokens of 3+ characters or pure
digits, best total score wins. Saying a name that is not in the directory
correctly returns no match, which the demo routes to the typing fallback.

## Test coverage

26 automated tests pass in Node (no browser needed for logic):
10 matching tests (Hindi, Latin, Urdu-script tokens, centre numbers, ASR
misspellings, danda stripping, partial-token rejection, best-of-multiple),
9 Web Speech flow tests with a fake recognizer (interim match fires once,
final-no-match routes to nomatch, timeout paths, mic-denied is a fatal error
not a silent hang, cancel is silent, unsupported reports cleanly), and
7 transcriber-engine tests with a fake mic stack (record, early stop,
processing, transcriber failure degrades to nomatch, auto-stop at recordMs,
and a simulated Whisper Urdu-script output still matching the right worker).

Run them yourself: the test harness lives in the PR description; matching can
also be exercised directly with
`node -e "const a=require('./aura-voice.js'),w=require('./workers.js');console.log(a.matchWorker('mera naam rekha',w))"`.

## Browser support

Chrome desktop and Android: full. Edge: full. Safari iOS: partial and
unreliable, which is why the type and pick fallbacks are first-class.
Firefox: no Web Speech, falls back automatically. The `transcriber` engine
(Whisper) works anywhere MediaRecorder works, including Firefox.

## Roadmap

1. Now: Web Speech engine live in demo and ready for the app.
2. Next: plug `ml_pipeline/whisper_engine.js` into the `transcriber` socket
   once it is stable (one function, see INTEGRATION.md).
3. Later: Bhashini API engine for the government pilot, sherpa-onnx for
   production on-device.

# Integration Guide

This module is additive. Nothing in `web/` or `ml_pipeline/` changes when it
merges. Three integration levels, in order of effort:

## Level 0: today (no changes anywhere)

The module ships with its own demo (`demo.html`) and worker directory
(`workers.js`). Merge the folder, serve it, demo it. The main app is
untouched.

## Level 1: plug the team's Whisper engine into the socket

The repo already has `ml_pipeline/whisper_engine.js` exporting
`transcribeAudioBlob(audioBlob, targetLang)`. It plugs into this module as
the offline engine with one function and zero changes to the Whisper code:

    <script src="workers.js"></script>
    <script src="aura-voice.js"></script>
    <script type="module">
      import { transcribeAudioBlob } from '../ml_pipeline/whisper_engine.js';

      const login = AuraVoiceLogin.create({
        workers: AURA_WORKERS,
        engine: 'transcriber',
        recordMs: 5000,
        transcriber: async (blob) => {
          const res = await transcribeAudioBlob(blob, 'hi');
          if (!res || !res.success) throw new Error(res && res.message || 'ASR failed');
          return { text: res.text };
        }
      });

      login.on('match',   m => console.log('worker:', m.worker.id));
      login.on('nomatch', n => console.log('no match:', n.transcript));
      login.on('error',   e => console.warn(e.code, e.message));
      // login.start() on mic tap; login.stop() on tap again
    </script>

If Whisper crashes (the WASM issues in the commit log), the module emits
`error { code: 'transcriber-failed' }` and settles in `nomatch`, so the UI
falls back to typing instead of hanging. That failure path is covered by an
automated test.

## Level 2: adopt inside web/index.html (when the team chooses)

The app currently has its own inline `startRecognition()`. To switch it to
this module without touching any screen templates, load the two files and
replace the body of `startRecognition` with an adapter:

    <script src="/voice-login/aura-voice.js"></script>

    function startRecognition(){
      const login = AuraVoiceLogin.create({
        workers: WORKERS,                       // the app's own dataset works as-is
        lang: (lang === 'hi') ? 'hi-IN' : 'en-IN',
        timeoutMs: 8000
      });
      login.on('transcript', t => { liveText = t.text; updateLiveTranscript(); });
      login.on('match',   m => { pendingWorker = m.worker; go('vl4'); });
      login.on('nomatch', () => go('vlpick'));
      login.on('error',   e => { if (e.fatal) go('vlpick'); });
      login.start();
      recog = login;                            // so stopRecognition() keeps working
    }
    function stopRecognition(){ try { recog && recog.cancel(); } catch(e){} }

The app's `WORKERS` array in `web/aura-api.js` already has the exact `match`
token shape this module expects, so it passes straight through.

## Serving

Web Speech and microphone capture require a secure context: https or
localhost. `npx serve voice-login` for the standalone demo, or the existing
`node server.js` for the app (add one line
`app.use('/voice-login', express.static(path.join(__dirname,'voice-login')))`
only if and when the team wants the demo served from the main server; not
required for the merge).

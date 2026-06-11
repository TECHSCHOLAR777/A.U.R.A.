/* ============================================================================
   AURA Voice Login Module  —  voice-login/aura-voice.js
   ----------------------------------------------------------------------------
   Standalone, dependency-free voice login engine for A.U.R.A.
   Owner: Parv Bansal (voice-first login feature)

   This module is a SEPARATE ENTITY. It does not import, modify, or depend on
   anything in web/ or ml_pipeline/. It can be adopted by the main app later
   through a 10-line adapter (see INTEGRATION.md).

   Two engines behind one API:

     1. "webspeech"    Browser Web Speech API. Free, no keys, no model
                       download, live interim transcripts. Online only.
                       This is the default and is fully tested.

     2. "transcriber"  Bring-your-own async function (audioBlob) -> { text }.
                       The module handles mic capture (MediaRecorder) and
                       calls your function. This is the socket where the
                       team's Whisper Tiny engine (ml_pipeline/
                       whisper_engine.js -> transcribeAudioBlob) plugs in,
                       without this module ever importing it.

   Public API:
     const login = AuraVoiceLogin.create({
       workers,            // array with `match` token arrays (see workers.js)
       lang: 'hi-IN',      // webspeech recognition language
       timeoutMs: 8000,    // webspeech safety timeout
       recordMs: 5000,     // transcriber engine max recording length
       engine: 'auto',     // 'auto' | 'webspeech' | 'transcriber'
       transcriber: null   // async (blob) => ({ text }) for engine 2
     });
     login.on('state',      s => {});  // idle|listening|recording|processing|
                                       // matched|nomatch|error|unsupported
     login.on('transcript', t => {});  // { text, isFinal }
     login.on('match',      m => {});  // { worker, score, transcript }
     login.on('nomatch',    n => {});  // { transcript }
     login.on('error',      e => {});  // { code, fatal, message }
     login.start();                    // begin listening / recording
     login.stop();                     // transcriber: stop early and process
                                       // webspeech: finish with what was heard
     login.cancel();                   // silent abort, back to idle
     AuraVoiceLogin.isSupported(engine);
     AuraVoiceLogin.matchWorker(text, workers);   // pure, Node-testable
   ============================================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.AuraVoiceLogin = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = (typeof window !== 'undefined') ? window : globalThis;

  /* ── text normalisation ──────────────────────────────────────────────── */
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFC')
      .replace(/[.,!?;:'"()\[\]{}|/\\_\u0964\u0965-]+/g, ' ') // incl. Devanagari danda
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ── worker matching (pure function) ─────────────────────────────────── */
  function matchWorker(text, workers) {
    if (!text || !workers || !workers.length) return null;
    var t = ' ' + normalize(text) + ' ';
    var best = null, bestScore = 0;
    for (var i = 0; i < workers.length; i++) {
      var w = workers[i];
      var tokens = w.match || [];
      var score = 0;
      for (var j = 0; j < tokens.length; j++) {
        var k = normalize(tokens[j]);
        if (!k) continue;
        if (t.indexOf(' ' + k + ' ') !== -1) {
          score += k.length + 2;                       // whole-word hit
        } else if ((k.length >= 3 || /^\d+$/.test(k)) && t.indexOf(k) !== -1) {
          score += k.length;                           // substring hit
        }
      }
      if (score > bestScore) { bestScore = score; best = w; }
    }
    return best ? { worker: best, score: bestScore } : null;
  }

  /* ── feature detection ───────────────────────────────────────────────── */
  function getSR() { return G.SpeechRecognition || G.webkitSpeechRecognition || null; }
  function hasMic() {
    return !!(G.navigator && G.navigator.mediaDevices &&
              G.navigator.mediaDevices.getUserMedia && G.MediaRecorder);
  }
  function isSupported(engine) {
    if (engine === 'transcriber') return hasMic();
    if (engine === 'webspeech')   return !!getSR();
    return !!getSR() || hasMic();
  }

  /* ── instance factory ────────────────────────────────────────────────── */
  function create(config) {
    config = config || {};
    var workers     = config.workers || [];
    var lang        = config.lang || 'hi-IN';
    var timeoutMs   = (typeof config.timeoutMs === 'number') ? config.timeoutMs : 8000;
    var recordMs    = (typeof config.recordMs  === 'number') ? config.recordMs  : 5000;
    var transcriber = (typeof config.transcriber === 'function') ? config.transcriber : null;
    var engineName  = config.engine || 'auto';

    var listeners = {};
    var state = 'idle';
    var settled = true;
    var recog = null;        // webspeech instance
    var recorder = null;     // MediaRecorder instance
    var stream = null;       // mic stream
    var safety = null;       // timer
    var chunks = [];
    var liveText = '';
    var heardFinal = '';

    function on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return api; }
    function emit(ev, payload) {
      var arr = listeners[ev] || [];
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](payload); } catch (e) { /* listener errors must not break the engine */ }
      }
    }
    function setState(s) { state = s; emit('state', s); }

    function clearSafety() { if (safety) { clearTimeout(safety); safety = null; } }
    function releaseMic() {
      try { if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
      stream = null;
    }

    function finish(result, errInfo) {
      if (settled) return;
      settled = true;
      clearSafety();
      try { recog && recog.stop(); } catch (e) {}
      releaseMic();
      if (errInfo) emit('error', errInfo);
      if (result && result.worker) {
        setState('matched');
        emit('match', { worker: result.worker, score: result.score, transcript: liveText });
      } else if (errInfo && errInfo.fatal) {
        setState('error');
      } else {
        setState('nomatch');
        emit('nomatch', { transcript: liveText });
      }
    }

    /* ── engine 1: Web Speech API ───────────────────────────────────────── */
    function startWebSpeech() {
      var SR = getSR();
      if (!SR) {
        setState('unsupported');
        emit('error', { code: 'unsupported', fatal: true,
                        message: 'Web Speech API not available in this browser.' });
        return false;
      }
      recog = new SR();
      recog.lang = lang;
      recog.interimResults = true;
      recog.maxAlternatives = 3;
      recog.continuous = false;
      setState('listening');
      safety = setTimeout(function () { finish(matchWorker(liveText, workers)); }, timeoutMs);

      recog.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var tr = e.results[i][0].transcript;
          if (e.results[i].isFinal) heardFinal += tr + ' ';
          else interim += tr;
        }
        liveText = (heardFinal + interim).trim();
        emit('transcript', { text: liveText, isFinal: !!heardFinal.trim() });
        var m = matchWorker(liveText, workers);
        if (m) finish(m);
        else if (heardFinal.trim()) finish(null);  // final phrase heard, no match
      };
      recog.onerror = function (e) {
        var code = (e && e.error) || 'error';
        var fatal = (code === 'not-allowed' || code === 'service-not-allowed' ||
                     code === 'audio-capture');
        var m = matchWorker(liveText, workers);
        if (m) finish(m);
        else finish(null, { code: code, fatal: fatal,
                            message: 'Speech recognition error: ' + code });
      };
      recog.onend = function () {
        if (!settled) finish(matchWorker(liveText, workers));
      };
      try { recog.start(); }
      catch (err) {
        settled = true; clearSafety();
        setState('error');
        emit('error', { code: 'start-failed', fatal: true,
                        message: String((err && err.message) || err) });
        return false;
      }
      return true;
    }

    /* ── engine 2: record + custom transcriber (Whisper socket) ────────── */
    function startTranscriber() {
      if (!hasMic()) {
        setState('unsupported');
        emit('error', { code: 'unsupported', fatal: true,
                        message: 'Microphone capture (MediaRecorder) not available.' });
        return false;
      }
      chunks = [];
      setState('recording');
      G.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        if (settled) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
        stream = s;
        recorder = new G.MediaRecorder(s);
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          releaseMic();
          if (settled) return;
          setState('processing');
          var BlobCtor = G.Blob;
          var blob = new BlobCtor(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
          Promise.resolve()
            .then(function () { return transcriber(blob); })
            .then(function (res) {
              liveText = normalize(res && res.text);
              emit('transcript', { text: (res && res.text) || '', isFinal: true });
              finish(matchWorker(liveText, workers));
            })
            .catch(function (err) {
              finish(null, { code: 'transcriber-failed', fatal: false,
                             message: String((err && err.message) || err) });
            });
        };
        recorder.start();
        safety = setTimeout(function () {
          try { recorder && recorder.state !== 'inactive' && recorder.stop(); } catch (e) {}
        }, recordMs);
      }).catch(function (err) {
        finish(null, { code: 'mic-denied', fatal: true,
                       message: String((err && err.message) || err) });
      });
      return true;
    }

    /* ── public controls ────────────────────────────────────────────────── */
    function resolveEngine() {
      if (engineName === 'webspeech')   return 'webspeech';
      if (engineName === 'transcriber') return 'transcriber';
      return transcriber ? 'transcriber' : 'webspeech';
    }

    function start() {
      if (!settled) cancel();
      settled = false;
      liveText = ''; heardFinal = '';
      var eng = resolveEngine();
      if (eng === 'transcriber') {
        if (!transcriber) {
          settled = true;
          setState('error');
          emit('error', { code: 'no-transcriber', fatal: true,
                          message: 'engine "transcriber" selected but no transcriber function given.' });
          return false;
        }
        return startTranscriber();
      }
      return startWebSpeech();
    }

    // stop(): finish with what we have.
    //   webspeech  -> stop recogniser; onend path matches what was heard.
    //   transcriber-> stop recording early; processing continues.
    function stop() {
      if (settled) return;
      clearSafety();
      if (recorder && recorder.state && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) {}
        return;                       // onstop -> processing -> finish
      }
      try { recog && recog.stop(); } catch (e) {}  // onend -> finish
    }

    // cancel(): silent abort, no match/nomatch events.
    function cancel() {
      settled = true;
      clearSafety();
      try { recog && recog.stop(); } catch (e) {}
      try { recorder && recorder.state !== 'inactive' && recorder.stop(); } catch (e) {}
      releaseMic();
      setState('idle');
    }

    var api = {
      start: start,
      stop: stop,
      cancel: cancel,
      on: on,
      getState: function () { return state; },
      getTranscript: function () { return liveText; }
    };
    return api;
  }

  return {
    create: create,
    matchWorker: matchWorker,
    normalize: normalize,
    isSupported: isSupported,
    version: '1.0.0'
  };
}));

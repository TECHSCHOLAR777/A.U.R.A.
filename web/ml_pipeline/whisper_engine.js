/**
 * ==============================================================================
 *  A.U.R.A — Client-Side Whisper Tiny Speech Recognition Engine (ASR)
 * ==============================================================================
 * 
 * Exposes an offline speech-to-text pipeline using Hugging Face Transformers.js
 * and ONNX Runtime Web. Resamples mic audio to 16kHz mono and transcribes client-side.
 * 
 * Uses @xenova/transformers v2.17.2 (not v3) because v3 bundles a JSEP-only ONNX
 * Runtime that requires WebGPU functions and SharedArrayBuffer/cross-origin isolation.
 * v2 uses standard WASM without JSEP — works everywhere, no special headers needed.
 * 
 * ==============================================================================
 */

// Import pipeline from transformers.js v2 CDN (Xenova namespace)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// ─── Configuration ───────────────────────────────────────────────────────────
// Try local model files first (served by Express from /ml_pipeline/models/).
// If local files fail, fall back to Hugging Face Hub CDN.
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = '/ml_pipeline/models/';

// Force single-threaded WASM to avoid SharedArrayBuffer/COOP/COEP requirements
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
env.backends.onnx.wasm.numThreads = 1;

let transcriberInstance = null;
let isLoading = false;

/**
 * Initializes the Whisper Tiny ASR model.
 * Loads from local disk on subsequent runs; first run may fetch from CDN.
 */
export async function initWhisper(onProgress = null) {
    if (transcriberInstance) return transcriberInstance;
    if (isLoading) {
        while (isLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return transcriberInstance;
    }

    isLoading = true;
    try {
        console.log('[whisper] Initializing Whisper Tiny model (transformers.js v2)...');
        transcriberInstance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
            progress_callback: (data) => {
                if (data.status === 'progress' && typeof onProgress === 'function') {
                    onProgress(data.progress);
                }
            }
        });
        console.log('[whisper] Whisper Tiny initialized successfully ✓');
    } catch (err) {
        console.error('[whisper] Failed to initialize Whisper model:', err);
        throw err;
    } finally {
        isLoading = false;
    }
    return transcriberInstance;
}

/**
 * Resamples an Audio Blob to 16000Hz mono Float32 PCM array.
 */
async function resampleAudioTo16k(audioBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    return channelData;
}

/**
 * Transcribes a microphone audio blob using client-side Whisper.
 */
export async function transcribeAudioBlob(audioBlob, targetLang = 'hi', onProgress = null) {
    try {
        const transcriber = await initWhisper(onProgress);
        
        console.log('[whisper] Resampling audio to 16kHz mono...');
        const pcmData = await resampleAudioTo16k(audioBlob);
        
        const options = {
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5
        };
        if (targetLang === 'hi') {
            options.language = 'hindi';
        } else if (targetLang === 'en') {
            options.language = 'english';
        }
        
        const result = await transcriber(pcmData, options);
        
        console.log('[whisper] Inference complete:', result);
        return {
            success: true,
            text: result.text.trim(),
            message: 'Transcription complete'
        };
    } catch (err) {
        console.error('[whisper] Error transcribing audio:', err);
        return {
            success: false,
            text: '',
            message: `ASR Failed: ${err.message}`
        };
    }
}

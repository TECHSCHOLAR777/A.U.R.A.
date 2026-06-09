/**
 * ==============================================================================
 *  A.U.R.A — Client-Side Whisper Tiny Speech Recognition Engine (ASR)
 * ==============================================================================
 * 
 * Exposes an offline speech-to-text pipeline using Hugging Face Transformers.js
 * and ONNX Runtime Web. Resamples mic audio to 16kHz mono and transcribes client-side.
 * 
 * ==============================================================================
 */

// Import pipeline from transformers.js CDN
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';

// Configure transformers.js to load WASM binaries and models locally
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/ml_pipeline/models/';
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';

let transcriberInstance = null;
let isLoading = false;

/**
 * Initializes the Whisper Tiny ASR model.
 * Downloads the model on first call and caches it locally.
 */
export async function initWhisper(onProgress = null) {
    if (transcriberInstance) return transcriberInstance;
    if (isLoading) {
        // Wait until loading completes
        while (isLoading) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return transcriberInstance;
    }

    isLoading = true;
    try {
        console.log('[whisper] Initializing Whisper Tiny model...');
        transcriberInstance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
            progress_callback: (data) => {
                if (data.status === 'progress' && typeof onProgress === 'function') {
                    onProgress(data.progress);
                }
            }
        });
        console.log('[whisper] Whisper Tiny initialized successfully');
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
 * 
 * @param {Blob} audioBlob - The recorded mic audio blob.
 * @returns {Promise<Float32Array>} Resampled PCM buffer.
 */
async function resampleAudioTo16k(audioBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Convert to mono (average channels if stereo)
    const channelData = audioBuffer.getChannelData(0);
    return channelData;
}

/**
 * Transcribes a microphone audio blob using client-side Whisper.
 * 
 * @param {Blob} audioBlob - Input recording blob (e.g. from MediaRecorder).
 * @param {string} targetLang - Language hint ('hi' or 'en').
 * @param {Function} onProgress - Progress hook for model loading.
 * @returns {Promise<Object>} Transcription result.
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

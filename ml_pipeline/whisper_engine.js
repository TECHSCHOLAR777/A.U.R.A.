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
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = '/ml_pipeline/models/';

env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
env.backends.onnx.wasm.numThreads = 1;

let transcriberInstance = null;
let isLoading = false;

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

async function resampleAudioTo16k(audioBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    return channelData;
}

/**
 * Translitterates Urdu/Arabic script text to Devanagari Hindi.
 * Designed for PWA workers in Jharkhand to convert auto-detected Urdu script to Hindi.
 */
function transliterateUrduToDevanagari(text) {
    if (!text) return '';
    
    // If there is no Arabic/Urdu character, return text as is
    if (!/[\u0600-\u06FF]/.test(text)) {
        return text;
    }
    
    // Normalize spaces
    text = text.replace(/\s+/g, ' ');
    const words = text.split(' ');
    
    const mappedWords = words.map(word => {
        if (!/[\u0600-\u06FF]/.test(word)) {
            return word;
        }
        
        let result = '';
        let i = 0;
        
        while (i < word.length) {
            // Check 2-character sequences (aspirated consonants)
            if (i + 1 < word.length) {
                const doubleChar = word.substr(i, 2);
                const aspMap = {
                    'پھ': 'फ', 'تھ': 'थ', 'ٹھ': 'ठ', 'جھ': 'झ', 'چھ': 'छ',
                    'دھ': 'ध', 'ڈھ': 'ढ', 'کھ': 'ख', 'گھ': 'घ', 'بھ': 'भ', 'ڑھ': 'ढ़'
                };
                if (aspMap[doubleChar]) {
                    result += aspMap[doubleChar];
                    i += 2;
                    continue;
                }
            }
            
            const char = word[i];
            const isInitial = (i === 0);
            
            if (char === 'ا') {
                if (isInitial) {
                    if (i + 1 < word.length && word[i+1] === 'ی') {
                        result += 'ई';
                        i += 2;
                        continue;
                    }
                    if (i + 1 < word.length && word[i+1] === 'ے') {
                        result += 'ए';
                        i += 2;
                        continue;
                    }
                    if (i + 1 < word.length && word[i+1] === 'و') {
                        result += 'ओ';
                        i += 2;
                        continue;
                    }
                    result += 'अ';
                } else {
                    result += 'ा';
                }
            } else if (char === 'ب') {
                result += 'ब';
            } else if (char === 'پ') {
                result += 'प';
            } else if (char === 'ت') {
                result += 'त';
            } else if (char === 'ٹ') {
                result += 'ट';
            } else if (char === 'ث') {
                result += 'स';
            } else if (char === 'ج') {
                result += 'ज';
            } else if (char === 'چ') {
                result += 'च';
            } else if (char === 'ح') {
                result += 'ह';
            } else if (char === 'خ') {
                result += 'ख';
            } else if (char === 'د') {
                result += 'द';
            } else if (char === 'ڈ') {
                result += 'ड';
            } else if (char === 'ذ') {
                result += 'ज़';
            } else if (char === 'ر') {
                result += 'र';
            } else if (char === 'ڑ') {
                result += 'ड़';
            } else if (char === 'ز') {
                result += 'ज़';
            } else if (char === 'ژ') {
                result += 'ज़';
            } else if (char === 'س') {
                result += 'स';
            } else if (char === 'ش') {
                result += 'श';
            } else if (char === 'ص') {
                result += 'स';
            } else if (char === 'ض') {
                result += 'ज़';
            } else if (char === 'ط') {
                result += 'त';
            } else if (char === 'ظ') {
                result += 'ज़';
            } else if (char === 'ع') {
                result += isInitial ? 'अ' : '';
            } else if (char === 'غ') {
                result += 'ग';
            } else if (char === 'ف') {
                result += 'फ़';
            } else if (char === 'ق') {
                result += 'क़';
            } else if (char === 'ک') {
                result += 'क';
            } else if (char === 'گ') {
                result += 'ग';
            } else if (char === 'ل') {
                result += 'ल';
            } else if (char === 'م') {
                result += 'म';
            } else if (char === 'ن') {
                result += 'न';
            } else if (char === 'ں') {
                result += 'ं';
            } else if (char === 'و') {
                if (isInitial) {
                    result += 'व';
                } else {
                    result += 'ू';
                }
            } else if (char === 'ہ' || char === 'ھ') {
                result += 'ह';
            } else if (char === 'ی') {
                if (isInitial) {
                    result += 'य';
                } else {
                    result += 'ी';
                }
            } else if (char === 'ے') {
                result += 'े';
            } else {
                result += char;
            }
            i++;
        }
        
        result = result
            .replace(/अा/g, 'आ')
            .replace(/अी/g, 'ई')
            .replace(/अू/g, 'ऊ')
            .replace(/अे/g, 'ए')
            .replace(/अै/g, 'ऐ')
            .replace(/अो/g, 'ओ');
            
        return result;
    });
    
    return mappedWords.join(' ');
}

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
        const rawText = result.text.trim();
        const cleanText = transliterateUrduToDevanagari(rawText);
        
        console.log('[whisper] Inference complete. Raw:', rawText, '-> Transliterated:', cleanText);
        return {
            success: true,
            text: cleanText,
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

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://huggingface.co/Xenova/whisper-tiny/resolve/main/';
const TARGET_DIR = path.resolve(__dirname, '..', 'web', 'ml_pipeline', 'models', 'Xenova', 'whisper-tiny');

const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'normalizer.json',
  'added_tokens.json',
  'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx'
];

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDirectoryExistence(dest);
    const file = fs.createWriteStream(dest);
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    https.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        const redirectUrl = new URL(response.headers.location, url).toString();
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (Status Code: ${response.statusCode})`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`[Downloaded] ${path.basename(dest)}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {}); // delete temporary file
      reject(err);
    });
  });
}

async function start() {
  console.log(`[Whisper Download] Starting download of whisper-tiny files...`);
  console.log(`[Whisper Download] Destination: ${TARGET_DIR}`);
  
  for (const file of FILES) {
    const url = BASE_URL + file;
    const dest = path.join(TARGET_DIR, ...file.split('/'));
    
    if (fs.existsSync(dest)) {
      console.log(`[Exists] Skipping ${file} (already downloaded)`);
      continue;
    }
    
    let success = false;
    let retries = 5;
    while (retries > 0 && !success) {
      console.log(`[Downloading] ${file} from ${url}... (Retries left: ${retries})`);
      try {
        await downloadFile(url, dest);
        success = true;
      } catch (err) {
        retries--;
        console.error(`[Error] Failed to download ${file}: ${err.message}. ${retries > 0 ? 'Retrying in 2 seconds...' : 'No retries left.'}`);
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 2000));
        } else {
          process.exit(1);
        }
      }
    }
  }
  
  console.log(`[Whisper Download] All files downloaded successfully!`);
}

start();

$baseUrl = "https://huggingface.co/Xenova/whisper-tiny/resolve/main/"
$targetDir = Join-Path $PSScriptRoot "..\web\ml_pipeline\models\Xenova\whisper-tiny"

$files = @(
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "normalizer.json",
  "added_tokens.json",
  "special_tokens_map.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx"
)

foreach ($file in $files) {
  $dest = Join-Path $targetDir $file.Replace("/", "\")
  $parent = Split-Path $dest
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  
  if (Test-Path $dest) {
    Write-Host "[Exists] Skipping $file"
    continue
  }
  
  $url = $baseUrl + $file
  Write-Host "[Downloading] $file from $url..."
  
  # Run curl.exe with retries and redirects
  curl.exe -L --retry 10 --retry-delay 3 --connect-timeout 30 -o $dest $url
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to download $file"
    exit 1
  }
}

Write-Host "All Whisper Tiny files downloaded successfully!"

/**
 * ==============================================================================
 *  A.U.R.A — Offline Visual Headcount & Verification Engine (ONNX Web)
 * ==============================================================================
 * 
 * Provides an offline, client-side vision pipeline for classroom headcount
 * validation, running inside Progressive Web Apps (PWAs). Connects to YOLOv8 ONNX
 * models via onnxruntime-web.
 * 
 * Flow:
 *   Canvas Input -> Low-Light CLAHE-sim (Canvas 2D) -> YOLO Preprocess (320x320 NCHW)
 *   -> ONNX Session Run -> Tensor Postprocess -> NMS Filtering -> Headcount Output
 * 
 * ==============================================================================
 */

import * as ort from 'onnxruntime-web';

/**
 * Applies a lightweight brightness, contrast, and saturation boost to simulate
 * a CLAHE low-light enhancement filter directly on a canvas context.
 * 
 * @param {HTMLCanvasElement} imageCanvas - Original input canvas.
 * @returns {HTMLCanvasElement} A new temporary canvas containing the enhanced image.
 */
function enhanceLowLightCanvas(imageCanvas) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageCanvas.width;
    tempCanvas.height = imageCanvas.height;
    
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not get 2D context for low-light enhancement.');
    }

    // Apply hardware-accelerated CSS filters to simulate CLAHE adjustment:
    // Brightness is increased by 20%, contrast by 15%, and saturation by 10%
    ctx.filter = 'brightness(1.20) contrast(1.15) saturate(1.10)';
    ctx.drawImage(imageCanvas, 0, 0);
    
    return tempCanvas;
}

/**
 * Resizes the enhanced canvas, extracts pixels, normalizes, and structures
 * them into an NCHW (Batch, Channel, Height, Width) float tensor.
 * 
 * @param {HTMLCanvasElement} enhancedCanvas - Enhanced canvas.
 * @returns {Float32Array} NCHW tensor data of size 3 * 320 * 320.
 */
function preprocessYOLOv8(enhancedCanvas) {
    const targetSize = 320;
    
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetSize;
    resizedCanvas.height = targetSize;
    
    const ctx = resizedCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not get 2D context for YOLO preprocessing.');
    }
    
    // Draw and stretch image to the target 320x320 dimensions
    ctx.drawImage(enhancedCanvas, 0, 0, targetSize, targetSize);
    
    const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
    const pixels = imgData.data; // Flattened RGBA array
    
    const channelSize = targetSize * targetSize;
    const nchwData = new Float32Array(3 * channelSize);
    
    // Convert packed RGBA (0-255) to planar NCHW (0-1) format
    for (let i = 0; i < channelSize; i++) {
        const r = pixels[i * 4] / 255.0;
        const g = pixels[i * 4 + 1] / 255.0;
        const b = pixels[i * 4 + 2] / 255.0;
        
        // Structure planar mapping
        nchwData[i] = r;                  // Red plane
        nchwData[channelSize + i] = g;     // Green plane
        nchwData[2 * channelSize + i] = b; // Blue plane
    }
    
    return nchwData;
}

/**
 * Calculates the Intersection over Union (IoU) of two bounding boxes.
 */
function calculateIoU(boxA, boxB) {
    const xA = Math.max(boxA.x1, boxB.x1);
    const yA = Math.max(boxA.y1, boxB.y1);
    const xB = Math.min(boxA.x2, boxB.x2);
    const yB = Math.min(boxA.y2, boxB.y2);
    
    const interWidth = Math.max(0, xB - xA);
    const interHeight = Math.max(0, yB - yA);
    const interArea = interWidth * interHeight;
    
    if (interArea === 0) return 0;
    
    const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
    const areaB = (boxB.x2 - boxB.x1) * (boxB.y2 - boxB.y1);
    
    const unionArea = areaA + areaB - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Performs greedy client-side Non-Maximum Suppression (NMS) to eliminate overlaps.
 * 
 * @param {Array} boxes - Bounding boxes candidates.
 * @param {number} iouThreshold - Standard overlap limit.
 * @returns {Array} List of filtered bounding boxes.
 */
function applyGreedyNMS(boxes, iouThreshold = 0.50) {
    // Sort descending by confidence score
    boxes.sort((a, b) => b.confidence - a.confidence);
    
    const keep = [];
    const discarded = new Array(boxes.length).fill(false);
    
    for (let i = 0; i < boxes.length; i++) {
        if (discarded[i]) continue;
        
        const current = boxes[i];
        keep.push(current);
        
        for (let j = i + 1; j < boxes.length; j++) {
            if (discarded[j]) continue;
            
            const iou = calculateIoU(current, boxes[j]);
            if (iou > iouThreshold) {
                discarded[j] = true;
            }
        }
    }
    
    return keep;
}

/**
 * Main module API. Takes a canvas, enhances, preprocesses, executes the YOLOv8 model
 * using onnxruntime-web, suppresses duplicates, and returns a verified headcount.
 * 
 * @param {HTMLCanvasElement} imageCanvas - Original HTML classroom photo canvas.
 * @param {string} onnxModelPath - Path to the compiled YOLOv8 .onnx model asset.
 * @returns {Promise<Object>} Verification results containing headcount and confidence levels.
 */
export async function analyzeClassroomPhoto(imageCanvas, onnxModelPath) {
    if (!imageCanvas) {
        throw new Error('A valid HTMLCanvasElement must be provided.');
    }
    
    try {
        // 1. Initialize ONNX runtime session
        const session = await ort.InferenceSession.create(onnxModelPath);
        
        // 2. Enhance image canvas to counter dark classroom lighting (brightness/contrast boost)
        const enhancedCanvas = enhanceLowLightCanvas(imageCanvas);
        
        // 3. Preprocess canvas into standardized YOLO format [1, 3, 320, 320]
        const preprocessedData = preprocessYOLOv8(enhancedCanvas);
        
        // 4. Wrap into ONNX Runtime Tensor
        const inputTensor = new ort.Tensor('float32', preprocessedData, [1, 3, 320, 320]);
        
        // 5. Execute model inference session
        const inputName = session.inputNames[0] || 'images';
        const feeds = { [inputName]: inputTensor };
        const outputMap = await session.run(feeds);
        
        const outputName = session.outputNames[0];
        const outputTensor = outputMap[outputName];
        
        // 6. Postprocess YOLOv8 output tensor [1, 84, 2100]
        // Flat shape has size 84 * 2100 = 176,400 floats. Row-major format.
        const outputData = outputTensor.data;
        const totalAnchors = 2100;
        const candidateBoxes = [];
        const confidenceThreshold = 0.40;
        
        // COCO dataset: Class 0 is 'Person'
        const targetClassIdx = 4; // Bounding boxes coords occupy indices 0, 1, 2, 3
        
        for (let col = 0; col < totalAnchors; col++) {
            const conf = outputData[targetClassIdx * totalAnchors + col];
            
            if (conf >= confidenceThreshold) {
                const cx = outputData[0 * totalAnchors + col];
                const cy = outputData[1 * totalAnchors + col];
                const w  = outputData[2 * totalAnchors + col];
                const h  = outputData[3 * totalAnchors + col];
                
                // Convert center coordinates to absolute bounding box corners (x1, y1, x2, y2)
                const x1 = cx - w / 2;
                const y1 = cy - h / 2;
                const x2 = cx + w / 2;
                const y2 = cy + h / 2;
                
                candidateBoxes.push({ x1, y1, x2, y2, confidence: conf });
            }
        }
        
        // 7. Suppress overlapping bounding boxes via Greedy NMS
        const finalBoxes = applyGreedyNMS(candidateBoxes, 0.50);
        
        // 8. Compute results
        const headcount = finalBoxes.length;
        let confidenceSum = 0;
        for (let k = 0; k < headcount; k++) {
            confidenceSum += finalBoxes[k].confidence;
        }
        const confidenceAvg = headcount > 0 ? (confidenceSum / headcount) : 0.0;
        
        return {
            success: true,
            headcount: headcount,
            confidenceAvg: Math.round(confidenceAvg * 1000) / 1000,
            message: 'Visual verification complete'
        };
        
    } catch (error) {
        console.error('Error during client-side classroom photo analysis:', error);
        return {
            success: false,
            headcount: 0,
            confidenceAvg: 0.0,
            message: `Visual verification failed: ${error.message}`
        };
    }
}

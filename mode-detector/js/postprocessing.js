/**
 * Postprocessing for YOLO Model Outputs
 * Handles different YOLO model formats (v7, v10, v11, v12)
 */

// Note: DEFAULT_FOCAL_LENGTH is defined in distance.js (loaded before this file)
// Using the global constant from distance.js

/**
 * Calculate Intersection over Union (IoU)
 * @param {Object} boxA - Bounding box A {x0, y0, x1, y1}
 * @param {Object} boxB - Bounding box B {x0, y0, x1, y1}
 * @returns {number} IoU value (0-1)
 */
function calculateIoU(boxA, boxB) {
  const x0 = Math.max(boxA.x0, boxB.x0);
  const y0 = Math.max(boxA.y0, boxB.y0);
  const x1 = Math.min(boxA.x1, boxB.x1);
  const y1 = Math.min(boxA.y1, boxB.y1);

  const intersectionArea = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const boxAArea = (boxA.x1 - boxA.x0) * (boxA.y1 - boxA.y0);
  const boxBArea = (boxB.x1 - boxB.x0) * (boxB.y1 - boxB.y0);
  const unionArea = boxAArea + boxBArea - intersectionArea;

  return intersectionArea / unionArea;
}

/**
 * Apply Non-Maximum Suppression (NMS)
 * Removes overlapping detections of the same class
 * @param {Array} detections - Array of detection objects
 * @param {number} iouThreshold - IoU threshold for NMS
 * @returns {Array} Filtered detections
 */
function applyNMS(detections, iouThreshold) {
  // Sort by confidence (highest first)
  detections.sort((a, b) => b.confidence - a.confidence);

  const keep = new Array(detections.length).fill(true);

  for (let i = 0; i < detections.length; i++) {
    if (!keep[i]) continue;

    const boxA = detections[i];
    for (let j = i + 1; j < detections.length; j++) {
      if (!keep[j]) continue;

      const boxB = detections[j];

      // Only apply NMS within the same class
      if (boxA.classId !== boxB.classId) continue;

      const iou = calculateIoU(boxA, boxB);
      if (iou > iouThreshold) {
        keep[j] = false;
      }
    }
  }

  return detections.filter((_, index) => keep[index]);
}

/**
 * Postprocess YOLOv7 output
 * Format: [det_num, 7] - [batch_id, x0, y0, x1, y1, class_id, confidence]      
 */
function postprocessYolov7(ctx, modelResolution, tensor, conf2color, focalLength) {                                                                             
  if (focalLength === undefined) {
    focalLength = typeof DEFAULT_FOCAL_LENGTH !== 'undefined' ? DEFAULT_FOCAL_LENGTH : 800;                                                                     
  }
  const dx = ctx.canvas.width / modelResolution[0];
  const dy = ctx.canvas.height / modelResolution[1];

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const numDetections = tensor.dims[0];
  const data = tensor.data;
  
  console.log(' [YOLOv7] Starting postprocessing:', { numDetections });
  
  // Array to collect detections for voice navigation
  const detectionsForVoice = [];

  for (let i = 0; i < numDetections; i++) {
    const offset = i * 7;
    const batchId = data[offset];
    const x0 = data[offset + 1];
    const y0 = data[offset + 2];
    const x1 = data[offset + 3];
    const y1 = data[offset + 4];
    const classId = Math.round(data[offset + 5]);
    const confidence = data[offset + 6];

    // Filter by confidence threshold - lowered to detect more objects including walls
    // Lower threshold helps detect objects that might be partially visible or walls
    if (confidence < 0.15) continue;
    
    console.log(` [YOLOv7] Detection ${i} passed threshold:`, {
      classId,
      className: yoloClasses[classId] || `Class ${classId}`,
      confidence: (confidence * 100).toFixed(1) + '%'
    });

    // Scale to canvas size
    const scaledX0 = x0 * dx;
    const scaledY0 = y0 * dy;
    const scaledX1 = x1 * dx;
    const scaledY1 = y1 * dy;

    const bboxWidth = scaledX1 - scaledX0;
    const bboxHeight = scaledY1 - scaledY0;

    // Calculate distance
    const distance = getObjectDistance(
      focalLength,
      classId,
      bboxWidth,
      bboxHeight,
      ctx.canvas.width
    );
    const distanceText = formatDistance(distance);

    // Create label
    const score = round(confidence * 100, 1);
    let className = yoloClasses[classId] || `Class ${classId}`;
    
    // Check if this might be a wall or large obstacle
    const isWall = typeof isLikelyWallOrLargeObstacle === 'function' && 
                   isLikelyWallOrLargeObstacle(bboxWidth, bboxHeight, ctx.canvas.width, ctx.canvas.height);
    
    // If likely wall or unknown object with large bbox, label it appropriately
    if (isWall && !yoloClasses[classId]) {
      className = 'tembok'; // Wall in Indonesian
    } else if (isWall && yoloClasses[classId]) {
      className = `${className} / halangan`; // Add "obstacle" label
    } else if (!yoloClasses[classId]) {
      className = 'halangan'; // Unknown object = obstacle
    }
    
    const label = `${capitalize(className)} ${score}%`;
    const color = conf2color(confidence);

    // Collect detection info for voice navigation - include ALL detections
    detectionsForVoice.push({
      classId: classId,
      distance: distance,
      className: className,
      confidence: confidence,
      isWall: isWall,
      isUnknown: !yoloClasses[classId]
    });
    
    console.log(` [YOLOv7] Added detection ${i} to voice array:`, {
      className,
      distance: distance.toFixed(1) + 'cm',
      confidence: (confidence * 100).toFixed(1) + '%',
      isWall: isWall,
      isUnknown: !yoloClasses[classId],
      currentArrayLength: detectionsForVoice.length
    });
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(scaledX0, scaledY0, bboxWidth, bboxHeight);

    // Draw label with distance
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, scaledX0 + 5, scaledY0 - 30);
    ctx.fillText(label, scaledX0 + 5, scaledY0 - 30);

    // Draw distance
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(distanceText, scaledX0 + 5, scaledY0 - 10);
    ctx.fillText(distanceText, scaledX0 + 5, scaledY0 - 10);

    // Fill with transparent color
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');        
    ctx.fillRect(scaledX0, scaledY0, bboxWidth, bboxHeight);
  }
  
  // Process detections for voice navigation (if function exists)
  console.log(' [Postprocess] Checking voice navigation...', {
    functionExists: typeof processDetectionsForVoice === 'function',
    detectionsCount: detectionsForVoice.length,
    detections: detectionsForVoice.map(d => ({ class: d.className, distance: d.distance.toFixed(1) + 'cm' }))
  });

  if (typeof processDetectionsForVoice === 'function') {
    if (detectionsForVoice.length > 0) {
      console.log(' [Postprocess] Calling processDetectionsForVoice with', detectionsForVoice.length, 'detections');
      processDetectionsForVoice(detectionsForVoice);
    } else {
      console.log(' [Postprocess] No detections to announce (detectionsForVoice is empty)');
    }
  } else {
    console.warn(' [Postprocess] processDetectionsForVoice function not found! Make sure voiceNavigation.js is loaded.');
  }
}

/**
 * Postprocess YOLOv10 output
 * Format: [1, all_boxes, 6] - [x0, y0, x1, y1, confidence, class_id]
 */
function postprocessYolov10(ctx, modelResolution, tensor, conf2color, focalLength) {                                                                            
  if (focalLength === undefined) {
    focalLength = typeof DEFAULT_FOCAL_LENGTH !== 'undefined' ? DEFAULT_FOCAL_LENGTH : 800;                                                                     
  }
  const dx = ctx.canvas.width / modelResolution[0];
  const dy = ctx.canvas.height / modelResolution[1];

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const data = tensor.data;
  const numBoxes = tensor.dims[1];
  
  // Array to collect detections for voice navigation
  const detectionsForVoice = [];

  for (let i = 0; i < numBoxes; i += 6) {
    const x0 = data[i];
    const y0 = data[i + 1];
    const x1 = data[i + 2];
    const y1 = data[i + 3];
    const confidence = data[i + 4];
    const classId = Math.round(data[i + 5]);

    // Filter by confidence threshold - lowered to detect more objects
    if (confidence < 0.15) break;

    // Scale to canvas size
    const scaledX0 = x0 * dx;
    const scaledY0 = y0 * dy;
    const scaledX1 = x1 * dx;
    const scaledY1 = y1 * dy;

    const bboxWidth = scaledX1 - scaledX0;
    const bboxHeight = scaledY1 - scaledY0;

    // Calculate distance
    const distance = getObjectDistance(
      focalLength,
      classId,
      bboxWidth,
      bboxHeight,
      ctx.canvas.width
    );
    const distanceText = formatDistance(distance);

    // Create label
    const score = round(confidence * 100, 1);
    let className = yoloClasses[classId] || `Class ${classId}`;
    
    // Check if this might be a wall or large obstacle
    const isWall = typeof isLikelyWallOrLargeObstacle === 'function' && 
                   isLikelyWallOrLargeObstacle(bboxWidth, bboxHeight, ctx.canvas.width, ctx.canvas.height);
    
    // If likely wall or unknown object with large bbox, label it appropriately
    if (isWall && !yoloClasses[classId]) {
      className = 'tembok'; // Wall in Indonesian
    } else if (isWall && yoloClasses[classId]) {
      className = `${className} / halangan`; // Add "obstacle" label
    } else if (!yoloClasses[classId]) {
      className = 'halangan'; // Unknown object = obstacle
    }
    
    const label = `${capitalize(className)} ${score}%`;
    const color = conf2color(confidence);

    // Collect detection info for voice navigation - include ALL detections
    detectionsForVoice.push({
      classId: classId,
      distance: distance,
      className: className,
      confidence: confidence,
      isWall: isWall,
      isUnknown: !yoloClasses[classId]
    });
    
    console.log(` [YOLOv10] Added detection to voice array:`, {
      className,
      distance: distance.toFixed(1) + 'cm',
      confidence: (confidence * 100).toFixed(1) + '%',
      isWall: isWall,
      isUnknown: !yoloClasses[classId],
      currentArrayLength: detectionsForVoice.length
    });
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(scaledX0, scaledY0, bboxWidth, bboxHeight);

    // Draw label with distance
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, scaledX0 + 5, scaledY0 - 30);
    ctx.fillText(label, scaledX0 + 5, scaledY0 - 30);

    // Draw distance
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(distanceText, scaledX0 + 5, scaledY0 - 10);
    ctx.fillText(distanceText, scaledX0 + 5, scaledY0 - 10);

    // Fill with transparent color
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');        
    ctx.fillRect(scaledX0, scaledY0, bboxWidth, bboxHeight);
  }
  
  // Process detections for voice navigation (if function exists)
  console.log(' [Postprocess] Checking voice navigation...', {
    functionExists: typeof processDetectionsForVoice === 'function',
    detectionsCount: detectionsForVoice.length,
    detections: detectionsForVoice.map(d => ({ class: d.className, distance: d.distance.toFixed(1) + 'cm' }))
  });

  if (typeof processDetectionsForVoice === 'function') {
    if (detectionsForVoice.length > 0) {
      console.log(' [Postprocess] Calling processDetectionsForVoice with', detectionsForVoice.length, 'detections');
      processDetectionsForVoice(detectionsForVoice);
    } else {
      console.log(' [Postprocess] No detections to announce (detectionsForVoice is empty)');
    }
  } else {
    console.warn(' [Postprocess] processDetectionsForVoice function not found! Make sure voiceNavigation.js is loaded.');
  }
}

/**
 * Postprocess YOLOv11/YOLOv12 output
 * Format: [1, 84, numAnchors] where 84 = 4 (bbox) + 80 (classes)
 */
function postprocessYolov11(ctx, modelResolution, tensor, conf2color, focalLength) {
  if (focalLength === undefined) {
    focalLength = typeof DEFAULT_FOCAL_LENGTH !== 'undefined' ? DEFAULT_FOCAL_LENGTH : 800;
  }
  const dx = ctx.canvas.width / modelResolution[0];
  const dy = ctx.canvas.height / modelResolution[1];

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const numClasses = 80;
  const numAnchors = tensor.dims[2];
  const confidenceThreshold = 0.15; // Lowered to detect more objects including walls
  const data = tensor.data;

  const detections = [];

  // Process each anchor
  for (let i = 0; i < numAnchors; i++) {
    // Extract box coordinates
    const x_center = data[i];
    const y_center = data[numAnchors + i];
    const width = data[2 * numAnchors + i];
    const height = data[3 * numAnchors + i];

    // Extract class probabilities
    let maxClassScore = 0;
    let maxClassId = 0;

    for (let j = 0; j < numClasses; j++) {
      const classScore = data[(4 + j) * numAnchors + i];
      if (classScore > maxClassScore) {
        maxClassScore = classScore;
        maxClassId = j;
      }
    }

    // Filter by confidence threshold
    if (maxClassScore > confidenceThreshold) {
      const x0 = x_center - width / 2;
      const y0 = y_center - height / 2;
      const x1 = x_center + width / 2;
      const y1 = y_center + height / 2;

      detections.push({
        x0: x0,
        y0: y0,
        x1: x1,
        y1: y1,
        confidence: maxClassScore,
        classId: maxClassId,
      });
    }
  }

    // Apply NMS
  const nmsDetections = applyNMS(detections, 0.4);
  
  // Array to collect detections for voice navigation
  const detectionsForVoice = [];

  // Draw detections
  for (const detection of nmsDetections) {
    const x0 = detection.x0 * dx;
    const y0 = detection.y0 * dy;
    const x1 = detection.x1 * dx;
    const y1 = detection.y1 * dy;

    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;

    // Calculate distance
    const distance = getObjectDistance(
      focalLength,
      detection.classId,
      bboxWidth,
      bboxHeight,
      ctx.canvas.width
    );
    const distanceText = formatDistance(distance);

    // Create label
    const score = round(detection.confidence * 100, 1);
    let className = yoloClasses[detection.classId] || `Class ${detection.classId}`;
    
    // Check if this might be a wall or large obstacle
    const isWall = typeof isLikelyWallOrLargeObstacle === 'function' && 
                   isLikelyWallOrLargeObstacle(bboxWidth, bboxHeight, ctx.canvas.width, ctx.canvas.height);
    
    // If likely wall or unknown object with large bbox, label it appropriately
    if (isWall && !yoloClasses[detection.classId]) {
      className = 'tembok'; // Wall in Indonesian
    } else if (isWall && yoloClasses[detection.classId]) {
      className = `${className} / halangan`; // Add "obstacle" label
    } else if (!yoloClasses[detection.classId]) {
      className = 'halangan'; // Unknown object = obstacle
    }
    
    const label = `${capitalize(className)} ${score}%`;
    const color = conf2color(detection.confidence);

    // Collect detection info for voice navigation - include ALL detections
    detectionsForVoice.push({
      classId: detection.classId,
      distance: distance,
      className: className,
      confidence: detection.confidence,
      isWall: isWall,
      isUnknown: !yoloClasses[detection.classId]
    });
    
    console.log(` [YOLOv11] Added detection to voice array:`, {
      className,
      distance: distance.toFixed(1) + 'cm',
      confidence: (detection.confidence * 100).toFixed(1) + '%',
      isWall: isWall,
      isUnknown: !yoloClasses[detection.classId],
      currentArrayLength: detectionsForVoice.length
    });
    
    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, bboxWidth, bboxHeight);

    // Draw label with distance
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, x0 + 5, y0 - 30);
    ctx.fillText(label, x0 + 5, y0 - 30);

    // Draw distance
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(distanceText, x0 + 5, y0 - 10);
    ctx.fillText(distanceText, x0 + 5, y0 - 10);

    // Fill with transparent color
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');        
    ctx.fillRect(x0, y0, bboxWidth, bboxHeight);
  }
  
  // Process detections for voice navigation (if function exists)
  console.log(' [Postprocess] Checking voice navigation...', {
    functionExists: typeof processDetectionsForVoice === 'function',
    detectionsCount: detectionsForVoice.length,
    detections: detectionsForVoice.map(d => ({ class: d.className, distance: d.distance.toFixed(1) + 'cm' }))
  });

  if (typeof processDetectionsForVoice === 'function') {
    if (detectionsForVoice.length > 0) {
      console.log(' [Postprocess] Calling processDetectionsForVoice with', detectionsForVoice.length, 'detections');
      processDetectionsForVoice(detectionsForVoice);
    } else {
      console.log(' [Postprocess] No detections to announce (detectionsForVoice is empty)');
    }
  } else {
    console.warn(' [Postprocess] processDetectionsForVoice function not found! Make sure voiceNavigation.js is loaded.');
  }
}

/**
 * Postprocess function selector
 * @param {string} modelName - Model name
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number[]} modelResolution - Model resolution
 * @param {ort.Tensor} tensor - Output tensor
 * @param {number} inferenceTime - Inference time in ms
 * @param {number} focalLength - Focal length for distance estimation
 */
function postprocess(modelName, ctx, modelResolution, tensor, inferenceTime, focalLength) {
  if (focalLength === undefined) {
    focalLength = typeof DEFAULT_FOCAL_LENGTH !== 'undefined' ? DEFAULT_FOCAL_LENGTH : 800;
  }
  const conf2colorFn = conf2color;

  if (modelName.includes('yolov7')) {
    postprocessYolov7(ctx, modelResolution, tensor, conf2colorFn, focalLength);
  } else if (modelName.includes('yolov10')) {
    postprocessYolov10(ctx, modelResolution, tensor, conf2colorFn, focalLength);
  } else if (modelName.includes('yolo11') || modelName.includes('yolo12')) {
    postprocessYolov11(ctx, modelResolution, tensor, conf2colorFn, focalLength);
  } else {
    console.warn(`Unknown model format: ${modelName}, trying YOLOv7 format`);
    postprocessYolov7(ctx, modelResolution, tensor, conf2colorFn, focalLength);
  }
}


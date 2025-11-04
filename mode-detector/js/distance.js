/**
 * Triangle Similarity Distance Estimation
 * Calculates distance to objects using known object sizes and focal length
 * 
 * Formula: Distance = (Real Object Size × Focal Length) / Pixel Size
 */

// Default focal length (needs calibration based on camera)
// For webcam: typically 600-1200 pixels depending on resolution
// For ESP32-CAM: typically 400-800 pixels depending on resolution
const DEFAULT_FOCAL_LENGTH = 600;

/**
 * Database of average object sizes in centimeters
 * These are typical sizes for common objects - may need adjustment for specific objects
 */
const objectSizes = {
  // People and animals - using more realistic full-body dimensions
  0: { width: 40, height: 170 },         // person (average shoulder width: 40cm, height: 170cm)
  14: { width: 15, height: 12 },        // bird (small bird)
  15: { width: 25, height: 30 },         // cat (average cat size)
  16: { width: 40, height: 60 },          // dog (medium dog)
  17: { width: 80, height: 160 },         // horse
  18: { width: 50, height: 80 },          // sheep
  19: { width: 80, height: 150 },          // cow
  20: { width: 200, height: 300 },        // elephant
  21: { width: 120, height: 180 },        // bear
  22: { width: 60, height: 150 },         // zebra
  23: { width: 80, height: 550 },         // giraffe

  // Vehicles
  1: { width: 60, height: 100 },         // bicycle (handlebar width)
  2: { width: 180, height: 150 },        // car (typical car width)
  3: { width: 70, height: 130 },           // motorbike
  5: { width: 250, height: 300 },         // bus
  6: { width: 300, height: 400 },         // train
  7: { width: 250, height: 350 },         // truck
  4: { width: 1500, height: 2000 },       // aeroplane
  8: { width: 300, height: 500 },         // boat

  // Furniture
  59: { width: 50, height: 100 },         // chair (seat width)
  60: { width: 200, height: 90 },          // sofa
  62: { width: 190, height: 50 },         // bed (width)
  63: { width: 120, height: 75 },         // diningtable
  65: { width: 100, height: 60 },         // tvmonitor (diagonal ~43")

  // Electronics
  66: { width: 35, height: 25 },          // laptop (typical 15" laptop)
  70: { width: 7, height: 15 },          // cell phone (smartphone)

  // Kitchen items
  71: { width: 50, height: 30 },          // microwave
  72: { width: 60, height: 60 },           // oven
  75: { width: 80, height: 180 },          // refrigerator
};

/**
 * Get object size by class ID
 * @param {number} classId - YOLO class ID
 * @returns {{width: number, height: number}} Object dimensions in cm
 */
function getObjectSize(classId) {
  return objectSizes[classId] || { width: 20, height: 20 };
}

/**
 * Calculate distance using width
 * @param {number} focalLength - Focal length in pixels
 * @param {number} realObjectWidth - Actual object width in cm
 * @param {number} pixelWidth - Object width in pixels
 * @returns {number} Distance in centimeters
 */
function calculateDistance(focalLength, realObjectWidth, pixelWidth) {
  if (pixelWidth <= 0 || realObjectWidth <= 0) return 0;
  const distance = (realObjectWidth * focalLength) / pixelWidth;
  return Math.round(distance * 100) / 100;
}

/**
 * Calculate distance using height
 * @param {number} focalLength - Focal length in pixels
 * @param {number} realObjectHeight - Actual object height in cm
 * @param {number} pixelHeight - Object height in pixels
 * @returns {number} Distance in centimeters
 */
function calculateDistanceByHeight(focalLength, realObjectHeight, pixelHeight) {
  if (pixelHeight <= 0 || realObjectHeight <= 0) return 0;
  const distance = (realObjectHeight * focalLength) / pixelHeight;
  return Math.round(distance * 100) / 100;
}

/**
 * Get actual video/image resolution (not canvas display size)
 * @returns {{width: number, height: number}} Actual video/image dimensions
 */
function getActualVideoResolution() {
  // Try webcam first
  const video = document.getElementById('video-element');
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  
  // Try ESP32 image
  const img = document.getElementById('esp32-img');
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  
  // Fallback to canvas size (not ideal but better than nothing)
  const canvas = document.getElementById('canvas-overlay');
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    return { width: canvas.width, height: canvas.height };
  }
  
  // Default fallback
  return { width: 640, height: 480 };
}

/**
 * Get object distance for YOLO detection
 * @param {number} focalLength - Calibrated focal length (in pixels at reference resolution)
 * @param {number} classId - YOLO class ID
 * @param {number} boundingBoxWidth - Bounding box width in pixels (on canvas)
 * @param {number} boundingBoxHeight - Bounding box height in pixels (on canvas)
 * @param {number} canvasWidth - Canvas display width (for scaling)
 * @returns {number} Distance in centimeters
 */
function getObjectDistance(focalLength, classId, boundingBoxWidth, boundingBoxHeight, canvasWidth = 640) {
  const objectSize = getObjectSize(classId);
  
  // Get actual video/image resolution (not canvas display size)
  const actualRes = getActualVideoResolution();
  const actualWidth = actualRes.width;
  const actualHeight = actualRes.height;
  
  // Calculate scale factor: canvas display size vs actual video size
  // This accounts for how the video is scaled to fit the canvas
  const canvas = document.getElementById('canvas-overlay');
  const canvasDisplayWidth = canvas ? canvas.offsetWidth || canvasWidth : canvasWidth;
  const canvasDisplayHeight = canvas ? canvas.offsetHeight : (canvasDisplayWidth * actualHeight / actualWidth);
  
  // Scale factor: how much the actual video is scaled to fit canvas
  const scaleX = actualWidth / canvasDisplayWidth;
  const scaleY = actualHeight / canvasDisplayHeight;
  
  // Convert bounding box from canvas pixels to actual video pixels
  const actualBboxWidth = boundingBoxWidth * scaleX;
  const actualBboxHeight = boundingBoxHeight * scaleY;
  
  // Adjust focal length based on actual video resolution
  // Focal length is typically calibrated at 640px width, so scale accordingly
  const referenceWidth = 640;
  const focalLengthScale = actualWidth / referenceWidth;
  const adjustedFocalLength = focalLength * focalLengthScale;
  
  // Determine which dimension to use for distance calculation
  // Use width for wide objects, height for tall objects
  const aspectRatio = actualBboxHeight / actualBboxWidth;
  const objectAspectRatio = objectSize.height / objectSize.width;
  
  // Use the dimension that gives better accuracy
  // For tall objects (person, etc), use height. For wide objects, use width.
  const isTallObject = aspectRatio > 1.2 && objectAspectRatio > 1.5;
  
  let distance;
  if (isTallObject) {
    // Use height for tall objects (person, etc.)
    distance = calculateDistanceByHeight(
      adjustedFocalLength,
      objectSize.height,
      actualBboxHeight
    );
  } else {
    // Use width for most objects
    distance = calculateDistance(
      adjustedFocalLength,
      objectSize.width,
      actualBboxWidth
    );
  }
  
  // Log for debugging (only occasionally to avoid spam)
  if (Math.random() < 0.01) { // Log 1% of the time
    console.log('[Distance] Calculation:', {
      classId,
      className: typeof yoloClasses !== 'undefined' ? yoloClasses[classId] : 'unknown',
      objectSize: `${objectSize.width}x${objectSize.height}cm`,
      bboxCanvas: `${boundingBoxWidth.toFixed(1)}x${boundingBoxHeight.toFixed(1)}px`,
      bboxActual: `${actualBboxWidth.toFixed(1)}x${actualBboxHeight.toFixed(1)}px`,
      videoRes: `${actualWidth}x${actualHeight}`,
      focalLength: adjustedFocalLength.toFixed(1),
      distance: distance.toFixed(1) + 'cm',
      usingHeight: isTallObject
    });
  }
  
  return distance;
}

/**
 * Format distance for display
 * @param {number} distance - Distance in centimeters
 * @returns {string} Formatted distance string
 */
function formatDistance(distance) {
  if (distance < 50) {
    return `${Math.round(distance)}cm`;
  } else if (distance < 100) {
    return `${distance.toFixed(1)}cm`;
  } else if (distance < 1000) {
    return `${(distance / 100).toFixed(2)}m`;
  } else {
    return `${(distance / 100).toFixed(1)}m`;
  }
}

/**
 * Calibrate focal length using known distance and object size
 * Use this function to improve distance accuracy
 * 
 * @param {number} knownDistance - Actual distance to object in cm
 * @param {number} classId - YOLO class ID of the object
 * @param {number} boundingBoxWidth - Bounding box width in pixels (on canvas)
 * @param {number} boundingBoxHeight - Bounding box height in pixels (on canvas)
 * @param {number} canvasWidth - Canvas display width
 * @returns {number} Calibrated focal length
 */
function calibrateFocalLength(knownDistance, classId, boundingBoxWidth, boundingBoxHeight, canvasWidth = 640) {
  const objectSize = getObjectSize(classId);
  const actualRes = getActualVideoResolution();
  const actualWidth = actualRes.width;
  
  // Calculate scale factors (same logic as getObjectDistance)
  const canvas = document.getElementById('canvas-overlay');
  const canvasDisplayWidth = canvas ? canvas.offsetWidth || canvasWidth : canvasWidth;
  const scaleX = actualWidth / canvasDisplayWidth;
  const actualBboxWidth = boundingBoxWidth * scaleX;
  const actualBboxHeight = boundingBoxHeight * scaleX;
  
  // Determine which dimension to use
  const aspectRatio = actualBboxHeight / actualBboxWidth;
  const objectAspectRatio = objectSize.height / objectSize.width;
  const isTallObject = aspectRatio > 1.2 && objectAspectRatio > 1.5;
  
  // Calculate focal length using known distance
  // Formula: Focal Length = (Pixel Size × Distance) / Real Object Size
  let calculatedFocalLength;
  if (isTallObject) {
    calculatedFocalLength = (actualBboxHeight * knownDistance) / objectSize.height;
  } else {
    calculatedFocalLength = (actualBboxWidth * knownDistance) / objectSize.width;
  }
  
  // Adjust to reference resolution (640px)
  const referenceWidth = 640;
  const focalLengthScale = referenceWidth / actualWidth;
  const calibratedFocalLength = calculatedFocalLength * focalLengthScale;
  
  console.log('[Distance] Calibration result:', {
    knownDistance: knownDistance + 'cm',
    classId: classId,
    className: typeof yoloClasses !== 'undefined' ? yoloClasses[classId] : 'unknown',
    boundingBox: `${boundingBoxWidth.toFixed(1)}x${boundingBoxHeight.toFixed(1)}px`,
    actualBbox: `${actualBboxWidth.toFixed(1)}x${actualBboxHeight.toFixed(1)}px`,
    videoRes: `${actualWidth}x${actualRes.height}`,
    calculatedFocalLength: calibratedFocalLength.toFixed(1),
    recommendation: `Set DEFAULT_FOCAL_LENGTH = ${Math.round(calibratedFocalLength)}`
  });
  
  return calibratedFocalLength;
}

/**
 * Helper function to calibrate focal length from browser console
 * Usage: calibrateFromKnownDistance(100, 0, 200, 300)
 * This means: object is 100cm away, class ID 0 (person), bounding box 200x300px
 * 
 * @param {number} knownDistanceCm - Actual distance in cm
 * @param {number} classId - YOLO class ID
 * @param {number} bboxWidthPx - Bounding box width in canvas pixels
 * @param {number} bboxHeightPx - Bounding box height in canvas pixels
 */
function calibrateFromKnownDistance(knownDistanceCm, classId, bboxWidthPx, bboxHeightPx) {
  const canvas = document.getElementById('canvas-overlay');
  const canvasWidth = canvas ? canvas.width : 640;
  const focalLength = calibrateFocalLength(knownDistanceCm, classId, bboxWidthPx, bboxHeightPx, canvasWidth);
  console.log(`\n✅ Calibration complete!`);
  console.log(`📝 Recommended focal length: ${Math.round(focalLength)}`);
  console.log(`💡 Update DEFAULT_FOCAL_LENGTH in distance.js to ${Math.round(focalLength)}`);
  console.log(`💡 Or update appState.focalLength in main.js to ${Math.round(focalLength)}`);
  return focalLength;
}

// Make calibration function available globally for console access
if (typeof window !== 'undefined') {
  window.calibrateFromKnownDistance = calibrateFromKnownDistance;
  console.log('[Distance] Calibration helper available: calibrateFromKnownDistance(knownDistanceCm, classId, bboxWidthPx, bboxHeightPx)');
}


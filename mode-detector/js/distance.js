/**
 * Triangle Similarity Distance Estimation
 * Calculates distance to objects using known object sizes and focal length
 */

// Default focal length (can be calibrated)
const DEFAULT_FOCAL_LENGTH = 800;

/**
 * Database of average object sizes in centimeters
 */
const objectSizes = {
  // People and animals
  0: { width: 14.3, height: 170 },      // person (average face width: 14.3cm)
  14: { width: 15, height: 12 },        // bird
  15: { width: 8, height: 30 },         // cat
  16: { width: 15, height: 60 },        // dog
  17: { width: 25, height: 160 },        // horse
  18: { width: 15, height: 80 },        // sheep
  19: { width: 30, height: 150 },        // cow
  20: { width: 60, height: 300 },        // elephant
  21: { width: 40, height: 180 },        // bear
  22: { width: 20, height: 150 },        // zebra
  23: { width: 20, height: 550 },        // giraffe

  // Vehicles
  1: { width: 60, height: 100 },         // bicycle
  2: { width: 180, height: 150 },        // car
  3: { width: 70, height: 130 },         // motorbike
  5: { width: 250, height: 300 },        // bus
  6: { width: 300, height: 400 },        // train
  7: { width: 250, height: 350 },        // truck
  4: { width: 1500, height: 2000 },      // aeroplane
  8: { width: 300, height: 500 },        // boat

  // Furniture
  59: { width: 50, height: 100 },       // chair
  60: { width: 200, height: 90 },         // sofa
  62: { width: 190, height: 50 },        // bed
  63: { width: 120, height: 75 },        // diningtable
  65: { width: 100, height: 60 },         // tvmonitor

  // Electronics
  66: { width: 30, height: 40 },         // laptop
  70: { width: 8, height: 15 },          // cell phone

  // Kitchen items
  71: { width: 50, height: 30 },         // microwave
  72: { width: 60, height: 60 },          // oven
  75: { width: 80, height: 180 },         // refrigerator
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
 * Get object distance for YOLO detection
 * @param {number} focalLength - Calibrated focal length
 * @param {number} classId - YOLO class ID
 * @param {number} boundingBoxWidth - Bounding box width in pixels
 * @param {number} boundingBoxHeight - Bounding box height in pixels
 * @param {number} canvasWidth - Canvas width for resolution adjustment
 * @returns {number} Distance in centimeters
 */
function getObjectDistance(focalLength, classId, boundingBoxWidth, boundingBoxHeight, canvasWidth = 640) {
  const objectSize = getObjectSize(classId);
  
  // Adjust focal length based on canvas resolution
  const resolutionScale = canvasWidth / 640;
  const adjustedFocalLength = focalLength * resolutionScale;
  
  // Use width for most objects, height for tall objects
  const isTallObject = boundingBoxHeight > boundingBoxWidth * 1.5;
  
  if (isTallObject) {
    return calculateDistanceByHeight(
      adjustedFocalLength,
      objectSize.height,
      boundingBoxHeight
    );
  } else {
    return calculateDistance(
      adjustedFocalLength,
      objectSize.width,
      boundingBoxWidth
    );
  }
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


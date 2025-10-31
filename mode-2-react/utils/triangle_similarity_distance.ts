/**
 * Triangle Similarity Distance Estimation
 * Adapted from: https://github.com/Asadullah-Dal17/Distance_measurement_using_single_camera
 * 
 * This implementation calculates distance using Triangle Similarity algorithm
 * based on known object size and focal length calibration
 */

// ============================================================================
// STEP 1: CALIBRATION - Run this once to get focal length
// ============================================================================

/**
 * Known reference measurements (in centimeters)
 * Place an object at a known distance and measure its width in pixels
 */
interface CalibrationReference {
  knownDistance: number;     // Distance from camera in cm
  realObjectWidth: number;   // Actual object width in cm
  pixelWidth: number;        // Object width in pixels in the captured image
}

/**
 * Calculate focal length from reference measurements
 * Formula: focal_length = (pixel_width × known_distance) / real_width
 * 
 * @param calibration - Calibration reference data
 * @returns Focal length in pixels
 * 
 * Example usage:
 * const focalLength = calculateFocalLength({
 *   knownDistance: 100,      // Object is 100cm from camera
 *   realObjectWidth: 14.3,   // Face width is 14.3cm in real life
 *   pixelWidth: 150          // Face is 150 pixels wide in image
 * });
 */
export function calculateFocalLength(calibration: CalibrationReference): number {
  const { knownDistance, realObjectWidth, pixelWidth } = calibration;
  
  if (realObjectWidth <= 0 || pixelWidth <= 0) {
    throw new Error('Real width and pixel width must be greater than 0');
  }
  
  const focalLength = (pixelWidth * knownDistance) / realObjectWidth;
  
  console.log('Focal Length Calculated:', focalLength, 'pixels');
  console.log('Calibration Details:', {
    knownDistance: `${knownDistance}cm`,
    realWidth: `${realObjectWidth}cm`,
    pixelWidth: `${pixelWidth}px`,
    focalLength: `${focalLength.toFixed(2)}px`
  });
  
  return focalLength;
}

// ============================================================================
// STEP 2: RUNTIME - Calculate distance for detected objects
// ============================================================================

/**
 * Calculate distance to an object using Triangle Similarity
 * Formula: distance = (real_width × focal_length) / pixel_width
 * 
 * @param focalLength - Calibrated focal length in pixels
 * @param realObjectWidth - Actual object width in cm (from database)
 * @param pixelWidth - Object width in pixels in current frame
 * @returns Distance in centimeters
 * 
 * Example usage:
 * const distance = calculateDistance(600, 14.3, 120);
 * // Object at 71.5cm from camera
 */
export function calculateDistance(
  focalLength: number,
  realObjectWidth: number,
  pixelWidth: number
): number {
  if (pixelWidth <= 0 || realObjectWidth <= 0) {
    return 0;
  }
  
  // Triangle similarity formula
  const distance = (realObjectWidth * focalLength) / pixelWidth;
  
  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Alternative: Calculate distance using height instead of width
 * Useful for tall objects like people standing
 */
export function calculateDistanceByHeight(
  focalLength: number,
  realObjectHeight: number,
  pixelHeight: number
): number {
  if (pixelHeight <= 0 || realObjectHeight <= 0) {
    return 0;
  }
  
  const distance = (realObjectHeight * focalLength) / pixelHeight;
  
  return Math.round(distance * 100) / 100;
}

// ============================================================================
// OBJECT SIZE DATABASE
// ============================================================================

/**
 * Database of average object sizes in centimeters
 * These values are used as reference for distance calculation
 */
export const objectSizes: Record<number, { width: number; height: number }> = {
  // People and animals
  0: { width: 14.3, height: 170 },      // person (average face width: 14.3cm)
  14: { width: 15, height: 12 },        // bird
  15: { width: 8, height: 30 },         // cat (small-medium cat)
  16: { width: 15, height: 60 },        // dog (medium dog)
  17: { width: 25, height: 160 },       // horse
  18: { width: 15, height: 80 },        // sheep
  19: { width: 30, height: 150 },       // cow
  20: { width: 60, height: 300 },       // elephant
  21: { width: 40, height: 180 },       // bear
  22: { width: 20, height: 150 },       // zebra
  23: { width: 20, height: 550 },       // giraffe

  // Vehicles
  1: { width: 60, height: 100 },        // bicycle
  2: { width: 180, height: 150 },       // car (compact car)
  3: { width: 70, height: 130 },        // motorbike
  5: { width: 250, height: 300 },       // bus
  6: { width: 300, height: 400 },       // train
  7: { width: 250, height: 350 },       // truck
  4: { width: 1500, height: 2000 },     // aeroplane
  8: { width: 300, height: 500 },       // boat

  // Furniture
  59: { width: 50, height: 100 },       // chair
  60: { width: 200, height: 90 },       // sofa
  62: { width: 190, height: 50 },       // bed
  63: { width: 120, height: 75 },       // diningtable
  65: { width: 100, height: 60 },       // tvmonitor

  // Electronics
  66: { width: 30, height: 40 },        // laptop
  70: { width: 8, height: 15 },         // cell phone

  // Kitchen items
  71: { width: 50, height: 30 },        // microwave
  72: { width: 60, height: 60 },        // oven
  75: { width: 80, height: 180 },       // refrigerator

};

/**
 * Get object size by class ID
 */
export function getObjectSize(classId: number): { width: number; height: number } {
  return objectSizes[classId] || { width: 20, height: 20 };
}

// ============================================================================
// CONVENIENCE FUNCTION
// ============================================================================

/**
 * Calculate distance for YOLO detected object
 * 
 * @param focalLength - Calibrated focal length
 * @param classId - YOLO class ID
 * @param boundingBoxWidth - Bounding box width in pixels
 * @param boundingBoxHeight - Bounding box height in pixels
 * @param canvasWidth - Canvas width for resolution adjustment
 * @returns Distance in centimeters
 */
export function getObjectDistance(
  focalLength: number,
  classId: number,
  boundingBoxWidth: number,
  boundingBoxHeight: number,
  canvasWidth: number = 640
): number {
  const objectSize = getObjectSize(classId);
  
  // Adjust focal length based on actual canvas resolution
  const resolutionScale = canvasWidth / 640;
  const adjustedFocalLength = focalLength * resolutionScale;
  
  // Use width for most objects, height for tall objects
  const isTallObject = boundingBoxHeight > boundingBoxWidth * 1.5;
  
  if (isTallObject) {
    // Use height for tall objects (person standing, bottles, etc)
    return calculateDistanceByHeight(
      adjustedFocalLength,
      objectSize.height,
      boundingBoxHeight
    );
  } else {
    // Use width for wider objects (cars, animals, etc)
    return calculateDistance(
      adjustedFocalLength,
      objectSize.width,
      boundingBoxWidth
    );
  }
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format distance for display with smart unit conversion
 * - Less than 50cm: show integer (45cm)
 * - 50cm-100cm: show 1 decimal (75.5cm)
 * - 1-10 meters: show 2 decimals (2.43m)
 * - Over 10 meters: show 1 decimal (15.2m)
 */
export function formatDistance(distance: number): string {
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

// ============================================================================
// DEFAULT FOCAL LENGTH (pre-calibrated value)
// ============================================================================

/**
 * Default focal length for webcam
 * This should be calibrated using calculateFocalLength() function
 * 
 * Typical values:
 * - Webcam 640x480: 600-800 pixels
 * - Webcam 1280x720: 1200-1600 pixels
 * - Smartphone camera: 1000-1500 pixels
 */
export const DEFAULT_FOCAL_LENGTH = 800; // Will be calibrated by user


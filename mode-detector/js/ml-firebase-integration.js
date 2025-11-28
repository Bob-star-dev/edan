/**
 * ML Firebase Integration
 * Mengintegrasikan hasil ML detection dengan Firebase Realtime Database
 * untuk mengirim direction ke ESP32 vibration motor
 */

/**
 * Tentukan direction berdasarkan detections
 * @param {Array} detections - Array detections dari postprocessing
 * @returns {Object} {direction: string, confidence: number, objectDetected: string}
 */
function determineDirectionFromDetections(detections) {
  if (!detections || detections.length === 0) {
    return {
      direction: 'none',
      confidence: 0,
      objectDetected: 'none'
    };
  }

  // Filter detections yang dekat (distance <= 150cm)
  const closeDetections = detections.filter(d => d.distance <= 150);
  
  if (closeDetections.length === 0) {
    return {
      direction: 'none',
      confidence: 0,
      objectDetected: 'none'
    };
  }

  // Pilih detection terdekat sebagai primary
  const primaryDetection = closeDetections.reduce((closest, current) => 
    current.distance < closest.distance ? current : closest
  );

  // Hitung average position dari semua detections dekat
  const avgRelativeX = closeDetections.reduce((sum, d) => {
    // Gunakan centerX jika ada, atau hitung dari relativeX
    const relativeX = d.relativeX !== undefined ? d.relativeX : 
                     (d.centerX !== undefined ? (d.centerX / (d.canvasWidth || 320)) : 0.5);
    return sum + relativeX;
  }, 0) / closeDetections.length;

  // Tentukan direction berdasarkan posisi
  let direction = 'none';
  const thresholdLeft = 0.35;   // < 35% = kiri
  const thresholdRight = 0.65;  // > 65% = kanan
  // 35% - 65% = tengah = both

  if (avgRelativeX < thresholdLeft) {
    direction = 'left';
  } else if (avgRelativeX > thresholdRight) {
    direction = 'right';
  } else {
    // Tengah atau multiple objects
    direction = 'both';
  }

  // Hitung confidence rata-rata
  const avgConfidence = closeDetections.reduce((sum, d) => sum + (d.confidence || 0), 0) / closeDetections.length;

  // Ambil object name dari primary detection
  const objectDetected = primaryDetection.className || 'object';

  console.log(`[ML Firebase] 📍 Direction determined: ${direction}`, {
    avgRelativeX: avgRelativeX.toFixed(2),
    primaryDistance: primaryDetection.distance.toFixed(1),
    primaryObject: objectDetected,
    confidence: avgConfidence.toFixed(2),
    numDetections: closeDetections.length
  });

  return {
    direction: direction,
    confidence: avgConfidence,
    objectDetected: objectDetected
  };
}

/**
 * Update Firebase dengan hasil ML detection
 * @param {Array} detections - Array detections dari postprocessing
 */
async function updateFirebaseFromDetections(detections) {
  // Check jika Firebase Realtime sudah initialized
  if (typeof window.initFirebaseRealtime !== 'function') {
    console.warn('[ML Firebase] Firebase Realtime not initialized yet');
    return;
  }

  // Initialize jika belum
  if (!window.firebaseRealtimeState || !window.firebaseRealtimeState.initialized) {
    await window.initFirebaseRealtime();
    
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Tentukan direction dari detections
  const directionInfo = determineDirectionFromDetections(detections);

  // Hitung distance terdekat dari semua detections
  let minDistance = 999;
  if (detections && detections.length > 0) {
    minDistance = Math.min(...detections.map(d => d.distance || 999));
  }

  // Update ke Firebase dengan distance dan detections
  if (typeof window.updateMLDirection === 'function') {
    try {
      await window.updateMLDirection(
        directionInfo.direction,
        directionInfo.confidence,
        directionInfo.objectDetected,
        minDistance < 999 ? minDistance : null,
        detections
      );
      console.log(`[ML Firebase] ✅ Updated Firebase: ${directionInfo.direction}, distance: ${minDistance < 999 ? minDistance.toFixed(1) + 'cm' : 'N/A'}`);
    } catch (error) {
      console.error('[ML Firebase] ❌ Failed to update Firebase:', error);
    }
  } else {
    console.warn('[ML Firebase] updateMLDirection function not available');
  }

  return directionInfo;
}

/**
 * Integrate dengan postprocessing function
 * Panggil fungsi ini setelah postprocessing selesai
 * @param {Array} detectionsForVoice - Array detections dari postprocessing
 */
function integrateMLDetectionWithFirebase(detectionsForVoice) {
  if (!detectionsForVoice || detectionsForVoice.length === 0) {
    // Tidak ada detection, set direction ke 'none' dan distance ke null
    if (typeof window.updateMLDirection === 'function' && 
        window.firebaseRealtimeState && 
        window.firebaseRealtimeState.initialized) {
      window.updateMLDirection('none', 0, 'none', null, []).catch(err => {
        console.error('[ML Firebase] Failed to update none direction:', err);
      });
    }
    return;
  }

  // Update Firebase dengan detections
  updateFirebaseFromDetections(detectionsForVoice).catch(err => {
    console.error('[ML Firebase] Error updating Firebase:', err);
  });
}

/**
 * Throttle function untuk membatasi update Firebase
 * Update maksimal setiap 200ms
 */
let lastFirebaseUpdate = 0;
const FIREBASE_UPDATE_INTERVAL = 200; // ms

function throttleUpdateFirebase(detections) {
  const now = Date.now();
  if (now - lastFirebaseUpdate >= FIREBASE_UPDATE_INTERVAL) {
    lastFirebaseUpdate = now;
    integrateMLDetectionWithFirebase(detections);
  }
}

// Expose functions globally
if (typeof window !== 'undefined') {
  window.determineDirectionFromDetections = determineDirectionFromDetections;
  window.updateFirebaseFromDetections = updateFirebaseFromDetections;
  window.integrateMLDetectionWithFirebase = integrateMLDetectionWithFirebase;
  window.throttleUpdateFirebase = throttleUpdateFirebase;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    determineDirectionFromDetections,
    updateFirebaseFromDetections,
    integrateMLDetectionWithFirebase,
    throttleUpdateFirebase
  };
}


/**
 * Voice Navigation System
 * - Mengumumkan nama objek yang terdeteksi dalam jarak 100cm sampai 150cm
 * - Memberikan peringatan tabrakan untuk objek yang terlalu dekat (< 50cm)
 * - Deteksi pergerakan objek (mendekat/menjauh) untuk peringatan yang lebih akurat
 */

// Voice navigation state
const voiceNavigationState = {
  enabled: true,
  announcedObjects: new Set(),
  lastAnnounceTime: {},
  minAnnounceInterval: 3000, // 3 detik untuk menghindari spam
  isSpeaking: false,
  distanceMin: 100, // Minimum distance dalam cm
  distanceMax: 150, // Maximum distance dalam cm
  lastDetectionTime: 0
};

// Collision warning state (untuk deteksi tabrakan)
const collisionWarningState = {
  enabled: true,
  warningThreshold: 50, // Jarak dalam cm untuk trigger warning
  criticalThreshold: 30, // Jarak dalam cm untuk critical warning
  lastWarningTime: {},
  minWarningInterval: 1000, // 1 detik antara warnings
  isWarning: false,
  // Track previous distances untuk detect movement
  previousDistances: new Map(), // Map<classId, distance>
  movementCheckInterval: 500 // Check movement setiap 500ms
};

// Mapping class names ke Bahasa Indonesia (tanpa double quotes di dalam string)
const classNamesIndonesian = {
  'person': 'manusia',
  'bicycle': 'sepeda',
  'car': 'mobil',
  'motorbike': 'sepeda motor',
  'aeroplane': 'pesawat',
  'bus': 'bis',
  'train': 'kereta api',
  'truck': 'truk',
  'boat': 'kapal',
  'traffic light': 'lampu lalu lintas',
  'fire hydrant': 'hidran',
  'stop sign': 'rambu berhenti',
  'parking meter': 'parkir meter',
  'bench': 'bangku',
  'bird': 'burung',
  'cat': 'kucing',
  'dog': 'anjing',
  'horse': 'kuda',
  'sheep': 'domba',
  'cow': 'sapi',
  'elephant': 'gajah',
  'bear': 'beruang',
  'zebra': 'zebra',
  'giraffe': 'jerapah',
  'chair': 'kursi',
  'sofa': 'sofa',
  'bed': 'tempat tidur',
  'diningtable': 'meja makan',
  'tvmonitor': 'televisi',
  'laptop': 'laptop',
  'cell phone': 'telepon',
  'bottle': 'botol',
  'cup': 'cangkir',
  'fork': 'garpu',
  'knife': 'pisau',
  'spoon': 'sendok',
  'bowl': 'mangkuk',
  'book': 'buku',
  'clock': 'jam',
  'vase': 'vas',
  'scissors': 'gunting',
  'teddy bear': 'boneka',
  'toothbrush': 'sikat gigi',
  'tembok': 'tembok', // Wall
  'halangan': 'halangan', // Obstacle
  'obstacle': 'halangan' // Obstacle (English)
};

/**
 * Get Indonesian class name from English class name
 * @param {string} className - English class name
 * @returns {string} Indonesian class name
 */
function getIndonesianClassName(className) {
  if (!className) return className;
  const lowerClassName = className.toLowerCase().trim();
  const indonesianName = classNamesIndonesian[lowerClassName];
  // Log untuk debugging
  if (!indonesianName) {
    console.warn(`[Voice] No Indonesian translation for: "${className}"`);
  }
  return indonesianName || className;
}

/**
 * Speak text using Web Speech API
 * @param {string} text - Text to speak
 * @param {string} lang - Language code (default: id-ID)
 */
function speakText(text, lang = 'id-ID') {
  // Check browser support
  if (!('speechSynthesis' in window)) {
    console.warn('[Voice] Speech synthesis not supported by browser');
    return;
  }

  // Check if already speaking
  if (voiceNavigationState.isSpeaking) {
    console.log('[Voice] Speech already in progress, skipping:', text);
    return;
  }

  // Cancel any pending speech
  window.speechSynthesis.cancel();

  // Create utterance
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85; // Slightly slower for clarity
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Event handlers
  utterance.onstart = () => {
    voiceNavigationState.isSpeaking = true;
    console.log('[Voice] 🔊 Speaking:', text);
  };

  utterance.onend = () => {
    voiceNavigationState.isSpeaking = false;
    console.log('[Voice] ✅ Speech ended:', text);
  };

  utterance.onerror = (error) => {
    voiceNavigationState.isSpeaking = false;
    console.error('[Voice] ❌ Speech error:', error);
  };

  // Speak
  try {
    window.speechSynthesis.speak(utterance);
    console.log('[Voice] 📢 Started speaking:', text);
  } catch (error) {
    console.error('[Voice] ❌ Failed to speak:', error);
    voiceNavigationState.isSpeaking = false;
  }
}

/**
 * Announce object if it's nearby and conditions are met
 * @param {number} classId - YOLO class ID
 * @param {number} distance - Distance in cm
 * @param {string} className - Class name in English
 */
function announceObjectIfNearby(classId, distance, className) {
  // Check if voice navigation is enabled
  if (!voiceNavigationState.enabled) {
    console.log('[Voice] Voice navigation is disabled');
    return;
  }

  // Check distance range (100cm - 150cm)
  if (distance < voiceNavigationState.distanceMin || distance > voiceNavigationState.distanceMax) {
    console.log(`[Voice] Object ${className} out of range (${distance.toFixed(1)}cm, required: ${voiceNavigationState.distanceMin}-${voiceNavigationState.distanceMax}cm)`);
    return;
  }

  const now = Date.now();
  
  // Check rate limiting per class
  const lastTime = voiceNavigationState.lastAnnounceTime[classId] || 0;
  const timeSinceLastAnnounce = now - lastTime;
  
  if (timeSinceLastAnnounce < voiceNavigationState.minAnnounceInterval) {
    console.log(`[Voice] Object ${className} (class ${classId}) announced too recently (${Math.round(timeSinceLastAnnounce)}ms ago), skipping`);
    return;
  }

  // If currently speaking, queue this announcement
  if (voiceNavigationState.isSpeaking) {
    console.log('[Voice] Currently speaking, will retry in 500ms...');
    setTimeout(() => {
      if (!voiceNavigationState.isSpeaking) {
        announceObjectIfNearby(classId, distance, className);
      }
    }, 500);
    return;
  }

  // Get Indonesian name and speak
  const indonesianName = getIndonesianClassName(className);
  console.log(`[Voice] 🎯 Announcing: ${indonesianName} (distance: ${distance.toFixed(1)}cm, class: ${classId})`);
  
  speakText(indonesianName);
  
  // Update state
  voiceNavigationState.announcedObjects.add(classId);
  voiceNavigationState.lastAnnounceTime[classId] = now;
  voiceNavigationState.lastDetectionTime = now;
}

/**
 * Check for collision warnings (objek terlalu dekat)
 * @param {Array} detections - Array of detection objects
 */
function checkCollisionWarnings(detections) {
  if (!collisionWarningState.enabled) return;
  if (!detections || !Array.isArray(detections) || detections.length === 0) return;

  const now = Date.now();
  
  // Filter detections yang terlalu dekat (collision risk)
  const closeObjects = detections.filter(det => {
    return det && typeof det.distance === 'number' && det.distance <= collisionWarningState.warningThreshold;
  });

  if (closeObjects.length === 0) return;

  // Sort by distance (closest first)
  closeObjects.sort((a, b) => a.distance - b.distance);
  
  const closestObject = closeObjects[0];
  const classId = closestObject.classId;
  const distance = closestObject.distance;
  const className = closestObject.className;

  // Check rate limiting
  const lastWarningTime = collisionWarningState.lastWarningTime[classId] || 0;
  const timeSinceLastWarning = now - lastWarningTime;

  if (timeSinceLastWarning < collisionWarningState.minWarningInterval) {
    return; // Skip jika terlalu sering
  }

  // Check if object is getting closer (movement detection)
  const previousDistance = collisionWarningState.previousDistances.get(classId);
  const isGettingCloser = previousDistance && distance < previousDistance - 5; // 5cm closer
  const isMovingAway = previousDistance && distance > previousDistance + 10; // 10cm further

  // Update previous distance
  collisionWarningState.previousDistances.set(classId, distance);

  // Determine warning level
  let warningLevel = 'warning'; // normal warning
  let warningMessage = '';
  
  if (distance <= collisionWarningState.criticalThreshold) {
    warningLevel = 'critical'; // sangat dekat!
    warningMessage = `Awas! ${getIndonesianClassName(className)} sangat dekat! ${Math.round(distance)} sentimeter!`;
  } else if (isGettingCloser) {
    warningLevel = 'approaching'; // sedang mendekat
    warningMessage = `Hati-hati! ${getIndonesianClassName(className)} mendekat! ${Math.round(distance)} sentimeter!`;
  } else {
    warningLevel = 'warning'; // normal warning
    warningMessage = `Peringatan! ${getIndonesianClassName(className)} di depan! ${Math.round(distance)} sentimeter!`;
  }

  // Skip jika sedang menjauh
  if (isMovingAway && distance > collisionWarningState.criticalThreshold) {
    return;
  }

  // Check if already warning
  if (collisionWarningState.isWarning && !isGettingCloser) {
    return; // Skip jika sudah warning dan tidak semakin dekat
  }

  // Speak warning
  console.log(`[Collision] ${warningLevel.toUpperCase()}: ${warningMessage} (distance: ${distance.toFixed(1)}cm)`);
  
  // Cancel any ongoing speech for immediate warning
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    voiceNavigationState.isSpeaking = false;
  }

  // Speak with appropriate urgency
  const utterance = new SpeechSynthesisUtterance(warningMessage);
  utterance.lang = 'id-ID';
  
  if (warningLevel === 'critical') {
    utterance.rate = 1.2; // Faster for critical
    utterance.pitch = 1.3; // Higher pitch for urgency
    utterance.volume = 1.0;
  } else if (warningLevel === 'approaching') {
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;
  } else {
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 0.9;
  }

  utterance.onstart = () => {
    collisionWarningState.isWarning = true;
    voiceNavigationState.isSpeaking = true;
    console.log(`[Collision] 🔊 Warning spoken: ${warningMessage}`);
  };

  utterance.onend = () => {
    collisionWarningState.isWarning = false;
    voiceNavigationState.isSpeaking = false;
    console.log(`[Collision] ✅ Warning ended`);
  };

  utterance.onerror = (error) => {
    collisionWarningState.isWarning = false;
    voiceNavigationState.isSpeaking = false;
    console.error(`[Collision] ❌ Warning error:`, error);
  };

  try {
    window.speechSynthesis.speak(utterance);
    collisionWarningState.lastWarningTime[classId] = now;
  } catch (error) {
    console.error('[Collision] Failed to speak warning:', error);
    collisionWarningState.isWarning = false;
  }
}

/**
 * Process detections and announce nearby objects
 * @param {Array} detections - Array of detection objects {classId, distance, className, confidence}
 */
function processDetectionsForVoice(detections) {
  // Validate input first
  if (!detections || !Array.isArray(detections) || detections.length === 0) {
    return; // No detections to process
  }

  // First, check for collision warnings (prioritas tinggi - always check)
  // Collision warning works independently of voice navigation
  checkCollisionWarnings(detections);

  // Then check if voice navigation is enabled
  if (!voiceNavigationState.enabled) {
    return; // Skip voice navigation but collision warning already processed
  }

  // Filter detections within range (100cm - 150cm)
  const nearbyDetections = detections.filter(det => {
    const isValid = det && 
                    typeof det.distance === 'number' && 
                    det.distance >= voiceNavigationState.distanceMin && 
                    det.distance <= voiceNavigationState.distanceMax;
    if (!isValid && det) {
      console.log(`[Voice] Detection filtered out: ${det.className} (distance: ${det.distance.toFixed(1)}cm, required: ${voiceNavigationState.distanceMin}-${voiceNavigationState.distanceMax}cm)`);
    }
    return isValid;
  });

  if (nearbyDetections.length === 0) {
    console.log(`[Voice] No detections in range (${voiceNavigationState.distanceMin}-${voiceNavigationState.distanceMax}cm)`);
    return;
  }

  console.log(`[Voice] Processing ${nearbyDetections.length} nearby detection(s) out of ${detections.length} total`);

  // Sort by distance (closest first), then by confidence if distance is similar
  nearbyDetections.sort((a, b) => {
    // If distances are very close (< 5cm difference), prefer higher confidence
    if (Math.abs(a.distance - b.distance) < 5) {
      return (b.confidence || 0) - (a.confidence || 0);
    }
    // Otherwise, prefer closer objects
    return a.distance - b.distance;
  });

  // Announce the closest detection
  const closestDetection = nearbyDetections[0];
  console.log(`[Voice] Closest detection: ${closestDetection.className} at ${closestDetection.distance.toFixed(1)}cm`);
  
  announceObjectIfNearby(
    closestDetection.classId, 
    closestDetection.distance, 
    closestDetection.className
  );

  // Queue additional detections if not currently speaking
  if (nearbyDetections.length > 1 && !voiceNavigationState.isSpeaking) {
    console.log(`[Voice] Queueing ${nearbyDetections.length - 1} additional detection(s)`);
    for (let i = 1; i < nearbyDetections.length; i++) {
      setTimeout(() => {
        const detection = nearbyDetections[i];
        if (!voiceNavigationState.isSpeaking) {
          announceObjectIfNearby(detection.classId, detection.distance, detection.className);
        }
      }, i * 1500); // Stagger announcements by 1.5 seconds
    }
  }
}

/**
 * Clear announced objects tracking (reset state)
 */
function clearAnnouncedObjects() {
  voiceNavigationState.announcedObjects.clear();
  voiceNavigationState.lastAnnounceTime = {};
  voiceNavigationState.lastDetectionTime = 0;
  console.log('[Voice] ✅ Cleared announced objects tracking');
}

/**
 * Enable or disable voice navigation
 * @param {boolean} enabled - Whether to enable voice navigation
 */
function setVoiceNavigationEnabled(enabled) {
  voiceNavigationState.enabled = enabled;
  if (!enabled) {
    // Cancel any ongoing speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    voiceNavigationState.isSpeaking = false;
  }
  console.log(`[Voice] ${enabled ? '✅ Enabled' : '❌ Disabled'} voice navigation`);
}

/**
 * Enable or disable collision warnings
 * @param {boolean} enabled - Whether to enable collision warnings
 */
function setCollisionWarningEnabled(enabled) {
  collisionWarningState.enabled = enabled;
  if (!enabled) {
    // Clear previous distances
    collisionWarningState.previousDistances.clear();
    collisionWarningState.isWarning = false;
  }
  console.log(`[Collision] ${enabled ? '✅ Enabled' : '❌ Disabled'} collision warnings`);
}

/**
 * Set collision warning threshold
 * @param {number} threshold - Distance threshold in cm (default: 50)
 * @param {number} criticalThreshold - Critical distance threshold in cm (default: 30)
 */
function setCollisionWarningThreshold(threshold, criticalThreshold = 30) {
  collisionWarningState.warningThreshold = threshold;
  collisionWarningState.criticalThreshold = criticalThreshold || (threshold * 0.6);
  console.log(`[Collision] Threshold updated: warning=${threshold}cm, critical=${collisionWarningState.criticalThreshold}cm`);
}

/**
 * Initialize voice navigation system
 * Check browser support and log status
 */
function initVoiceNavigation() {
  if (!('speechSynthesis' in window)) {
    console.warn('[Voice] ⚠️ Speech synthesis not supported by browser');
    voiceNavigationState.enabled = false;
    return false;
  }

  console.log('[Voice] ✅ Voice navigation initialized');
  console.log('[Voice] Settings:', {
    enabled: voiceNavigationState.enabled,
    distanceRange: `${voiceNavigationState.distanceMin}-${voiceNavigationState.distanceMax}cm`,
    minAnnounceInterval: voiceNavigationState.minAnnounceInterval + 'ms'
  });

  // Initialize collision warning
  console.log('[Collision] ✅ Collision warning system initialized');
  console.log('[Collision] Settings:', {
    enabled: collisionWarningState.enabled,
    warningThreshold: collisionWarningState.warningThreshold + 'cm',
    criticalThreshold: collisionWarningState.criticalThreshold + 'cm',
    minWarningInterval: collisionWarningState.minWarningInterval + 'ms'
  });

  return true;
}

// Make collision warning functions available globally
if (typeof window !== 'undefined') {
  window.setCollisionWarningEnabled = setCollisionWarningEnabled;
  window.setCollisionWarningThreshold = setCollisionWarningThreshold;
  console.log('[Collision] Helper functions available:');
  console.log('  - setCollisionWarningEnabled(true/false)');
  console.log('  - setCollisionWarningThreshold(warningCm, criticalCm)');
}

// Initialize on load
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVoiceNavigation);
  } else {
    initVoiceNavigation();
  }
}

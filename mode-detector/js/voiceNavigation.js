/**
 * Voice Navigation System
 * Mengumumkan nama objek yang terdeteksi dalam jarak 50cm atau kurang
 */

// Voice navigation state
const voiceNavigationState = {
  enabled: true,
  announcedObjects: new Set(),
  lastAnnounceTime: {},
  minAnnounceInterval: 3000, // 3 detik untuk menghindari spam
  isSpeaking: false,
  distanceThreshold: 100, // Naikkan ke 100cm untuk testing lebih mudah
  lastDetectionTime: 0
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
  'toothbrush': 'sikat gigi'
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

  // Check distance threshold
  if (distance > voiceNavigationState.distanceThreshold) {
    console.log(`[Voice] Object ${className} too far (${distance.toFixed(1)}cm > ${voiceNavigationState.distanceThreshold}cm)`);
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
 * Process detections and announce nearby objects
 * @param {Array} detections - Array of detection objects {classId, distance, className, confidence}
 */
function processDetectionsForVoice(detections) {
  // Check if voice navigation is enabled
  if (!voiceNavigationState.enabled) {
    console.log('[Voice] Voice navigation is disabled');
    return;
  }

  // Validate input
  if (!detections || !Array.isArray(detections) || detections.length === 0) {
    console.log('[Voice] No detections provided');
    return;
  }

  // Filter nearby detections
  const nearbyDetections = detections.filter(det => {
    const isValid = det && typeof det.distance === 'number' && det.distance <= voiceNavigationState.distanceThreshold;
    if (!isValid && det) {
      console.log(`[Voice] Detection filtered out: ${det.className} (distance: ${det.distance}cm)`);
    }
    return isValid;
  });

  if (nearbyDetections.length === 0) {
    console.log('[Voice] No nearby detections (all objects beyond threshold)');
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
    distanceThreshold: voiceNavigationState.distanceThreshold + 'cm',
    minAnnounceInterval: voiceNavigationState.minAnnounceInterval + 'ms'
  });

  return true;
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

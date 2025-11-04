/**
 * Voice Navigation System
 * Mengumumkan nama objek yang terdeteksi dalam jarak 50cm atau kurang (≤ 50cm)
 * Hanya objek dengan jarak 50cm kebawah yang akan diumumkan
 */

// Voice navigation state
const voiceNavigationState = {
  enabled: true,              // Enable/disable voice navigation
  announcedObjects: new Set(), // Track objects yang sudah di-announce untuk mencegah duplicate
  lastAnnounceTime: {},       // Track waktu terakhir announce per class ID
  minAnnounceInterval: 2000,  // Minimum interval antar announce (2 detik) untuk objek yang sama
  isSpeaking: false,          // Flag untuk mencegah overlapping speech
  distanceThreshold: 50       // Threshold jarak dalam cm (≤ 50cm = 50cm kebawah)
};

// Mapping class names ke Bahasa Indonesia untuk pengucapan yang lebih natural
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
  'backpack': 'tas',
  'umbrella': 'payung',
  'handbag': 'tas tangan',
  'tie': 'dasi',
  'suitcase': 'koper',
  'frisbee': 'frisbee',
  'skis': 'ski',
  'snowboard': 'papan salju',
  'sports ball': 'bola',
  'kite': 'layang layang',
  'baseball bat': 'tongkat baseball',
  'baseball glove': 'sarung tangan baseball',
  'skateboard': 'papan luncur',
  'surfboard': 'papan selancar',
  'tennis racket': 'raket tenis',
  'bottle': 'botol',
  'wine glass': 'gelas wine',
  'cup': 'gelas',
  'fork': 'garpu',
  'knife': 'pisau',
  'spoon': 'sendok',
  'bowl': 'mangkuk',
  'banana': 'pisang',
  'apple': 'apel',
  'sandwich': 'sandwich',
  'orange': 'jeruk',
  'broccoli': 'brokoli',
  'carrot': 'wortel',
  'hot dog': 'hot dog',
  'pizza': 'pizza',
  'donut': 'donat',
  'cake': 'kue',
  'chair': 'kursi',
  'sofa': 'sofa',
  'pottedplant': 'tanaman pot',
  'bed': 'tempat tidur',
  'diningtable': 'meja makan',
  'toilet': 'toilet',
  'tvmonitor': 'televisi',
  'laptop': 'laptop',
  'mouse': 'mouse komputer',
  'remote': 'remote',
  'keyboard': 'keyboard',
  'cell phone': 'telepon',
  'microwave': 'microwave',
  'oven': 'oven',
  'toaster': 'pemanggang roti',
  'sink': 'wastafel',
  'refrigerator': 'kulkas',
  'book': 'buku',
  'clock': 'jam',
  'vase': 'vas',
  'scissors': 'gunting',
  'teddy bear': 'boneka beruang',
  'hair drier': 'pengering rambut',
  'toothbrush': 'sikat gigi'
};

/**
 * Get Indonesian name for object class
 * @param {string} className - English class name
 * @returns {string} Indonesian name or original name if not found
 */
function getIndonesianClassName(className) {
  const lowerClassName = className.toLowerCase();
  return classNamesIndonesian[lowerClassName] || className;
}

/**
 * Speak text using Web Speech Synthesis API
 * @param {string} text - Text to speak
 * @param {string} lang - Language code (default: 'id-ID')
 */
function speakText(text, lang = 'id-ID') {
  console.log('🗣️ speakText called:', text, 'lang:', lang);
  
  // Check if speech synthesis is supported
  if (!('speechSynthesis' in window)) {
    console.error('❌ Speech synthesis not supported in this browser');
    return;
  }
  
  console.log('✅ Speech synthesis API is available');

  // Don't speak if already speaking
  if (voiceNavigationState.isSpeaking) {
    console.log('⏭️ Speech already in progress, skipping:', text);
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Create speech utterance
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;  // Sedikit lebih lambat untuk kejelasan
  utterance.pitch = 1;
  utterance.volume = 1;
  
  console.log('📢 Created utterance:', {
    text: text,
    lang: lang,
    rate: utterance.rate,
    pitch: utterance.pitch,
    volume: utterance.volume
  });

  // Event handlers
  utterance.onstart = () => {
    voiceNavigationState.isSpeaking = true;
    console.log('🔊 Speaking:', text);
  };

  utterance.onend = () => {
    voiceNavigationState.isSpeaking = false;
    console.log('✅ Speech ended');
  };

  utterance.onerror = (error) => {
    voiceNavigationState.isSpeaking = false;
    console.error('❌ Speech error:', error);
  };

  // Speak
  try {
    console.log('🎤 Attempting to speak:', text);
    window.speechSynthesis.speak(utterance);
    console.log('✅ speak() called successfully');
  } catch (error) {
    console.error('❌ Failed to speak:', error);
    voiceNavigationState.isSpeaking = false;
  }
}

/**
 * Announce object if within distance threshold
 * @param {number} classId - YOLO class ID
 * @param {number} distance - Distance in centimeters
 * @param {string} className - Object class name (English)
 */
function announceObjectIfNearby(classId, distance, className) {
  console.log(`🔍 announceObjectIfNearby called: ${className} at ${distance.toFixed(1)}cm (classId: ${classId})`);
  
  // Skip if voice navigation is disabled
  if (!voiceNavigationState.enabled) {
    console.log('⚠️ Voice navigation is disabled');
    return;
  }

  // Skip if distance exceeds threshold (hanya announce objek ≤ 50cm = 50cm kebawah)
  if (distance > voiceNavigationState.distanceThreshold) {
    console.log(`⏭️ Distance ${distance.toFixed(1)}cm exceeds threshold ${voiceNavigationState.distanceThreshold}cm, skipping`);
    return;
  }

  // Get current time
  const now = Date.now();

  // Check if we should announce this object
  // Don't announce if:
  // 1. Same class ID was announced recently (within minAnnounceInterval)
  // 2. We're already speaking
  const lastTime = voiceNavigationState.lastAnnounceTime[classId] || 0;
  const timeSinceLastAnnounce = now - lastTime;

  if (timeSinceLastAnnounce < voiceNavigationState.minAnnounceInterval) {
    console.log(`⏭️ Object ${className} (class ${classId}) announced too recently, skipping`);
    return;
  }

  if (voiceNavigationState.isSpeaking) {
    console.log(`⏭️ Already speaking, queuing ${className}`);
    // Queue untuk di-announce setelah speech selesai
    setTimeout(() => {
      if (!voiceNavigationState.isSpeaking) {
        announceObjectIfNearby(classId, distance, className);
      }
    }, 500);
    return;
  }

  // Get Indonesian name
  const indonesianName = getIndonesianClassName(className);

  // Announce object
  speakText(indonesianName);

  // Update tracking
  voiceNavigationState.announcedObjects.add(classId);
  voiceNavigationState.lastAnnounceTime[classId] = now;

  console.log(`🔊 Announced: ${indonesianName} (distance: ${distance.toFixed(1)}cm)`);
}

/**
 * Process detections and announce nearby objects
 * This function is called from postprocessing after drawing
 * @param {Array} detections - Array of detection objects with {classId, distance, className, confidence}
 */
function processDetectionsForVoice(detections) {
  console.log('🔍 processDetectionsForVoice called with', detections.length, 'detections');
  
  if (!voiceNavigationState.enabled) {
    console.log('⚠️ Voice navigation is disabled');
    return;
  }

  // Filter detections within threshold (hanya objek ≤ 50cm = 50cm kebawah yang akan diumumkan)
  const nearbyDetections = detections.filter(det => det.distance <= voiceNavigationState.distanceThreshold);
  
  console.log('📏 Filtered detections:', {
    total: detections.length,
    nearby: nearbyDetections.length,
    threshold: voiceNavigationState.distanceThreshold
  });

  if (nearbyDetections.length === 0) {
    console.log('⏭️ No nearby detections (≤ 50cm), skipping voice announcement');
    return;
  }
  
  // Log all nearby detections for debugging
  console.log('🎯 Nearby detections:', nearbyDetections.map(d => ({
    class: d.className,
    distance: d.distance.toFixed(1) + 'cm',
    confidence: (d.confidence * 100).toFixed(1) + '%'
  })));

  // Sort by distance (closest first) and confidence (highest first)
  nearbyDetections.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 5) {
      // If distance is similar (within 5cm), sort by confidence
      return (b.confidence || 0) - (a.confidence || 0);
    }
    return a.distance - b.distance;
  });

  // Announce closest object first
  const closestDetection = nearbyDetections[0];
  announceObjectIfNearby(
    closestDetection.classId,
    closestDetection.distance,
    closestDetection.className
  );

  // If there are multiple nearby objects, announce them with a delay
  if (nearbyDetections.length > 1 && !voiceNavigationState.isSpeaking) {
    for (let i = 1; i < nearbyDetections.length; i++) {
      setTimeout(() => {
        const detection = nearbyDetections[i];
        announceObjectIfNearby(
          detection.classId,
          detection.distance,
          detection.className
        );
      }, i * 1500); // Delay 1.5 detik antar announce
    }
  }
}

/**
 * Clear announced objects tracking (call when needed to reset)
 */
function clearAnnouncedObjects() {
  voiceNavigationState.announcedObjects.clear();
  voiceNavigationState.lastAnnounceTime = {};
  console.log('🔄 Cleared announced objects tracking');
}

/**
 * Enable or disable voice navigation
 * @param {boolean} enabled - Enable or disable
 */
function setVoiceNavigationEnabled(enabled) {
  voiceNavigationState.enabled = enabled;
  if (!enabled) {
    window.speechSynthesis.cancel();
    voiceNavigationState.isSpeaking = false;
  }
  console.log(`🔊 Voice navigation ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Test function untuk memverifikasi voice navigation bekerja
 * Panggil ini dari browser console untuk test: testVoiceNavigation()
 */
function testVoiceNavigation() {
  console.log('🧪 Testing voice navigation...');
  console.log('Voice navigation enabled:', voiceNavigationState.enabled);
  console.log('Speech synthesis available:', 'speechSynthesis' in window);
  
  // Test speak text
  speakText('test suara', 'id-ID');
  
  // Test dengan detections dummy
  const testDetections = [
    { classId: 0, distance: 30, className: 'person', confidence: 0.9 },
    { classId: 59, distance: 45, className: 'chair', confidence: 0.85 }
  ];
  
  console.log('Testing with dummy detections:', testDetections);
  processDetectionsForVoice(testDetections);
}

/**
 * Voice Navigation System
 * - Mengumumkan nama objek yang terdeteksi dalam jarak 100cm sampai 150cm
 * - Memberikan peringatan tabrakan untuk objek yang terlalu dekat (< 50cm)
 * - Deteksi pergerakan objek (mendekat/menjauh) untuk peringatan yang lebih akurat
 */

// Voice navigation state
// BARU: Suara mode detector disembunyikan secara default - hanya suara navigator yang aktif
const voiceNavigationState = {
  enabled: false, // Disabled by default - only navigator voice is active
  announcedObjects: new Set(),
  lastAnnounceTime: {},
  minAnnounceInterval: 3000, // 3 detik untuk menghindari spam
  isSpeaking: false,
  distanceMin: 100, // Minimum distance dalam cm
  distanceMax: 150, // Maximum distance dalam cm
  lastDetectionTime: 0,
  suspendedByCoordinator: false,
  suspensionDepth: 0,
  suspensionReason: '',
  navigatorPriorityActive: false,
  navigatorPriorityDepth: 0,
  navigatorPriorityMonitor: null
};

// Collision warning state (untuk deteksi tabrakan)
// BARU: Collision warning juga dimatikan - hanya suara navigator yang aktif
const collisionWarningState = {
  enabled: false, // Disabled by default - only navigator voice is active
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
  'person': 'orang',
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
 * Handles various formats including "person / halangan", "person halangan", etc.
 * @param {string} className - English class name (can be mixed format)
 * @returns {string} Indonesian class name
 */
function getIndonesianClassName(className) {
  if (!className) return className;
  
  const lowerClassName = className.toLowerCase().trim();
  
  // Handle format like "person / halangan" or "person halangan"
  // Split by "/" or "halangan" to get the main object name
  let mainObjectName = lowerClassName;
  let hasHalangan = false;
  
  // Check if it contains "/" separator first (e.g., "person / halangan")
  if (lowerClassName.includes('/')) {
    const parts = lowerClassName.split('/');
    mainObjectName = parts[0].trim();
    // Check if second part contains "halangan"
    if (parts.length > 1 && parts[1].trim().includes('halangan')) {
      hasHalangan = true;
    }
  }
  // Check if it contains "halangan" (e.g., "person halangan")
  else if (lowerClassName.includes('halangan')) {
    hasHalangan = true;
    // Extract main object name before "halangan"
    // Split by "halangan" and take first part
    const parts = lowerClassName.split(/\s+halangan|halangan/);
    mainObjectName = parts[0].trim();
  }
  
  // Get Indonesian translation for main object
  const indonesianName = classNamesIndonesian[mainObjectName];
  
  // If translation found, use it; otherwise use original main object name
  const translatedMainObject = indonesianName || mainObjectName;
  
  // Combine with "halangan" if it was present
  let result;
  if (hasHalangan && translatedMainObject !== 'halangan') {
    // Only add "halangan" if main object is not already "halangan"
    result = `${translatedMainObject} halangan`;
  } else {
    result = translatedMainObject;
  }
  
  // Log untuk debugging
  if (mainObjectName !== lowerClassName || hasHalangan) {
    console.log(`[Voice] 🔄 Translating: "${className}" -> mainObject: "${mainObjectName}" -> "${result}"`);
  }
  
  // Log warning jika tidak ada translation
  if (!indonesianName && mainObjectName !== 'halangan' && mainObjectName !== 'tembok' && mainObjectName !== 'obstacle') {
    console.warn(`[Voice] ⚠️ No Indonesian translation for: "${mainObjectName}" (from: "${className}")`);
  }
  
  return result;
}

/**
 * Get Indonesian voice from available voices
 * @returns {SpeechSynthesisVoice|null} Indonesian voice or null
 */
function getIndonesianVoice() {
  if (!('speechSynthesis' in window)) return null;
  
  const voices = window.speechSynthesis.getVoices();
  
  // Prioritize Indonesian voices
  const indonesianVoices = voices.filter(voice => 
    voice.lang.toLowerCase().includes('id') || 
    voice.lang.toLowerCase().includes('indonesia') ||
    voice.name.toLowerCase().includes('indonesia') ||
    voice.name.toLowerCase().includes('indonesian')
  );
  
  if (indonesianVoices.length > 0) {
    console.log(`[Voice] ✅ Found ${indonesianVoices.length} Indonesian voice(s):`, 
      indonesianVoices.map(v => v.name));
    // Prefer female voice, or first available
    const preferred = indonesianVoices.find(v => 
      v.name.toLowerCase().includes('female') || 
      v.name.toLowerCase().includes('zira') ||
      v.name.toLowerCase().includes('perempuan')
    ) || indonesianVoices[0];
    return preferred;
  }
  
  // Fallback: try to find any voice that might support Indonesian
  // Some browsers list Indonesian support under different names
  const fallbackVoices = voices.filter(voice => 
    voice.lang.toLowerCase().includes('ms') || // Malay (similar to Indonesian)
    voice.lang.toLowerCase().includes('id')
  );
  
  if (fallbackVoices.length > 0) {
    console.log(`[Voice] ⚠️ Using fallback voice for Indonesian:`, fallbackVoices[0].name);
    return fallbackVoices[0];
  }
  
  console.warn('[Voice] ⚠️ No Indonesian voice found, using default voice');
  return null;
}

/**
 * Speak text using Web Speech API with Indonesian language
 * @param {string} text - Text to speak (in Indonesian)
 * @param {string} lang - Language code (default: id-ID)
 * @param {string} priority - Priority: 'critical' (collision warning), 'normal' (object announcement)
 */
function speakText(text, lang = 'id-ID', priority = 'normal') {
  // BARU: Suara mode detector disembunyikan - hanya suara navigator yang aktif
  // Deteksi object tetap berjalan, tapi tidak ada suara yang dikeluarkan
  if (!voiceNavigationState.enabled && priority !== 'critical') {
    console.log('[ModeDetector] 🔇 Voice disabled - only navigator voice is active');
    return;
  }
  
  // Critical warnings juga dimatikan jika collision warning disabled
  if (priority === 'critical' && !collisionWarningState.enabled) {
    console.log('[ModeDetector] 🔇 Collision warning disabled - only navigator voice is active');
    return;
  }
  
  // Check browser support
  if (!('speechSynthesis' in window)) {
    console.warn('[Voice] Speech synthesis not supported by browser');
    return;
  }

  // Jangan ganggu navigator: jika navigator sedang berbicara, hentikan suara object detector (kecuali warning kritis)
  // TAPI: Jangan block jika navigator belum benar-benar mulai berbicara (hanya check jika sudah speaking)
  if (priority !== 'critical') {
    const coordinator = (typeof window !== 'undefined') ? window.SpeechCoordinator : null;
    if (coordinator) {
      // Check apakah navigator BENAR-BENAR sedang berbicara (bukan hanya flag)
      const navigatorActuallySpeaking = coordinator.isNavigationSpeaking && 
                                       (typeof window.speechSynthesis !== 'undefined') && 
                                       window.speechSynthesis.speaking;
      
      if (navigatorActuallySpeaking) {
        if (!voiceNavigationState.navigatorPriorityActive) {
          pauseVoiceNavigation('navigation-priority');
        }
        console.log('[ModeDetector] ⏸️ Navigation actually speaking - suppressing object detector voice');
        return;
      }
      
      // Jika suspended by coordinator tapi navigator tidak benar-benar speaking, biarkan
      if (voiceNavigationState.suspendedByCoordinator && !navigatorActuallySpeaking) {
        // Navigator tidak benar-benar speaking, resume jika perlu
        if (voiceNavigationState.navigatorPriorityActive) {
          resumeVoiceNavigation('navigation-priority');
        }
      }
    }
  }

  // Use SpeechCoordinator to check if we can speak (coordinate with navigation)
  if (typeof window.SpeechCoordinator !== 'undefined') {
    if (!window.SpeechCoordinator.requestSpeak(priority)) {
      const navigatorSpeaking = !!window.SpeechCoordinator.isNavigationSpeaking;
      const navigatorActive = navigatorSpeaking || window.SpeechCoordinator.isNavigating;
      
      if (priority === 'normal' && navigatorActive) {
        console.log('[ModeDetector] ⏸️ Navigation priority active - dropping object announcement');
        if (navigatorActive && !voiceNavigationState.navigatorPriorityActive) {
          pauseVoiceNavigation('navigation-priority');
        }
        return;
      }
      
      console.log('[ModeDetector] ⏸️ Speech delayed - retrying for priority:', priority);
      let retryCount = 0;
      const maxRetries = (priority === 'critical') ? 10 : 3;
      
      const trySpeak = () => {
        retryCount++;
        const speechSynthesisSpeaking = (typeof window.speechSynthesis !== 'undefined') && window.speechSynthesis.speaking;
        
        if (!voiceNavigationState.isSpeaking && !speechSynthesisSpeaking) {
          if (window.SpeechCoordinator.requestSpeak(priority)) {
            console.log('[ModeDetector] ✅ Retry successful (attempt ' + retryCount + ')');
            speakText(text, lang, priority);
            return;
          }
        }
        
        if (retryCount < maxRetries) {
          setTimeout(trySpeak, 400);
        } else {
          console.log('[ModeDetector] ⏸️ Max retries reached for priority:', priority);
        }
      };
      
      setTimeout(trySpeak, 400);
      return;
    }
  }

  // Check if already speaking
  if (voiceNavigationState.isSpeaking) {
    console.log('[Voice] Speech already in progress, skipping:', text);
    return;
  }

  // Cancel any pending speech (only if not critical warning)
  if (priority !== 'critical') {
    // For normal priority, don't cancel navigation speech
    // Only cancel if navigation is not speaking
    if (typeof window.SpeechCoordinator !== 'undefined' && window.SpeechCoordinator.isNavigationActive()) {
      console.log('[ModeDetector] ⏸️ Navigation is speaking - waiting...');
      return;
    }
  }
  
  // For critical warnings, cancel all speech EXCEPT if navigator is speaking
  // Critical warnings (collision) harus bisa menginterupsi, tapi tetap respect navigator priority
  if (priority === 'critical') {
    const coordinator = (typeof window !== 'undefined') ? window.SpeechCoordinator : null;
    const speechApi = (typeof window !== 'undefined' && 'speechSynthesis' in window) ? window.speechSynthesis : null;
    
    const navigatorActive = coordinator
      ? (typeof coordinator.isNavigationActive === 'function'
          ? coordinator.isNavigationActive()
          : !!coordinator.isNavigationSpeaking)
      : false;
    
    if (!navigatorActive && speechApi && speechApi.speaking) {
      console.log('[ModeDetector] 🚨 Clearing non-navigation speech before critical warning');
      speechApi.cancel();
    } else if (!coordinator && speechApi) {
      // Tanpa coordinator kita tetap cancel agar warning segera terdengar
      speechApi.cancel();
    } else if (navigatorActive) {
      console.log('[ModeDetector] ⏸️ Critical warning waiting for navigation to finish');
      if (coordinator && typeof coordinator.markSpeechEnd === 'function') {
        coordinator.markSpeechEnd('critical');
      } else if (coordinator) {
        coordinator.isModeDetectorWarning = false;
      }
      setTimeout(() => {
        speakText(text, lang, priority);
      }, 400);
      return;
    }
  }

  // Create utterance
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang; // Set to Indonesian language
  
  // Try to get Indonesian voice
  // Note: voices may not be loaded immediately, so we try to get them
  // If voices are not ready, browser will use default voice with Indonesian language
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    // Wait for voices to load if needed
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const indonesianVoice = getIndonesianVoice();
      if (indonesianVoice) {
        utterance.voice = indonesianVoice;
        console.log(`[Voice] 🎤 Using voice: ${indonesianVoice.name} (${indonesianVoice.lang})`);
      }
    }
  } else {
    // Try to get voices directly
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const indonesianVoice = getIndonesianVoice();
      if (indonesianVoice) {
        utterance.voice = indonesianVoice;
        console.log(`[Voice] 🎤 Using voice: ${indonesianVoice.name} (${indonesianVoice.lang})`);
      }
    }
  }
  
  utterance.rate = 0.85; // Slightly slower for clarity in Indonesian
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Event handlers
  utterance.onstart = () => {
    voiceNavigationState.isSpeaking = true;
    if (typeof window.SpeechCoordinator !== 'undefined') {
      if (priority === 'critical') {
        window.SpeechCoordinator.isModeDetectorWarning = true;
      } else {
        window.SpeechCoordinator.isModeDetectorSpeaking = true;
      }
    }
    console.log(`[ModeDetector] 🔊 Speaking (${priority}): "${text}"`);
  };

  utterance.onend = () => {
    voiceNavigationState.isSpeaking = false;
    if (typeof window.SpeechCoordinator !== 'undefined') {
      window.SpeechCoordinator.markSpeechEnd(priority);
    }
    console.log(`[ModeDetector] ✅ Speech ended (${priority}):`, text);
  };

  utterance.onerror = (error) => {
    voiceNavigationState.isSpeaking = false;
    if (typeof window.SpeechCoordinator !== 'undefined') {
      window.SpeechCoordinator.markSpeechEnd(priority);
    }
    console.error('[ModeDetector] ❌ Speech error:', error);
  };

  // Speak
  try {
    window.speechSynthesis.speak(utterance);
    console.log(`[Voice] 📢 Started speaking in Indonesian: "${text}"`);
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

  if (voiceNavigationState.suspendedByCoordinator) {
    console.log('[Voice] Voice navigation is temporarily suspended by navigator priority');
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
  
  // Use 'normal' priority for object announcements (will wait for navigation to finish)
  speakText(indonesianName, 'id-ID', 'normal');
  
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
  if (voiceNavigationState.suspendedByCoordinator) return;
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

  // Get Indonesian name for the object
  const indonesianName = getIndonesianClassName(className);
  
  // Determine warning level and message
  let warningLevel = 'warning'; // normal warning
  let warningMessage = '';
  let objectAnnouncement = ''; // Simple object name announcement
  
  if (distance <= collisionWarningState.criticalThreshold) {
    warningLevel = 'critical'; // sangat dekat!
    warningMessage = `Awas! ${indonesianName} sangat dekat! ${Math.round(distance)} sentimeter!`;
    objectAnnouncement = indonesianName; // Announce object name first
  } else if (isGettingCloser) {
    warningLevel = 'approaching'; // sedang mendekat
    warningMessage = `Hati-hati! ${indonesianName} mendekat! ${Math.round(distance)} sentimeter!`;
    objectAnnouncement = indonesianName; // Announce object name first
  } else {
    warningLevel = 'warning'; // normal warning
    warningMessage = `Peringatan! ${indonesianName} di depan! ${Math.round(distance)} sentimeter!`;
    objectAnnouncement = indonesianName; // Announce object name first
  }

  // Skip jika sedang menjauh
  if (isMovingAway && distance > collisionWarningState.criticalThreshold) {
    return;
  }

  // Check if already warning
  if (collisionWarningState.isWarning && !isGettingCloser) {
    return; // Skip jika sudah warning dan tidak semakin dekat
  }

  // First, announce object name in Indonesian (simple announcement)
  // This ensures user knows what object is detected
  if (objectAnnouncement) {
    console.log(`[Collision] 🎯 Announcing object: ${objectAnnouncement} (distance: ${distance.toFixed(1)}cm)`);
    
    // Use SpeechCoordinator for critical warning (will cancel navigation speech)
    if (typeof window.SpeechCoordinator !== 'undefined') {
      if (!window.SpeechCoordinator.requestSpeak('critical')) {
        console.log('[Collision] ⏸️ Critical warning delayed - retrying...');
        setTimeout(() => {
          checkCollisionWarnings(detections);
        }, 500);
        return;
      }
    } else {
      // Fallback: Cancel any ongoing speech to prioritize collision warning
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        voiceNavigationState.isSpeaking = false;
      }
    }
    
    // Speak object name first (simple announcement) - use critical priority
    const objectUtterance = new SpeechSynthesisUtterance(objectAnnouncement);
    objectUtterance.lang = 'id-ID';
    
    // Try to get Indonesian voice
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const indonesianVoice = getIndonesianVoice();
      if (indonesianVoice) {
        objectUtterance.voice = indonesianVoice;
      }
    }
    
    objectUtterance.rate = 0.9;
    objectUtterance.pitch = 1.0;
    objectUtterance.volume = 1.0;
    
    objectUtterance.onstart = () => {
      if (typeof window.SpeechCoordinator !== 'undefined') {
        window.SpeechCoordinator.isModeDetectorWarning = true;
      }
      console.log(`[Collision] 🔊 Announcing object: "${objectAnnouncement}"`);
    };
    
    objectUtterance.onend = () => {
      // After announcing object name, speak the warning message
      setTimeout(() => {
        speakCollisionWarning(warningMessage, warningLevel);
      }, 300); // Small delay between announcements
    };
    
    objectUtterance.onerror = (error) => {
      console.error(`[Collision] ❌ Error announcing object:`, error);
      if (typeof window.SpeechCoordinator !== 'undefined') {
        window.SpeechCoordinator.markSpeechEnd('critical');
      }
      // Continue to warning message even if object announcement fails
      speakCollisionWarning(warningMessage, warningLevel);
    };
    
    try {
      window.speechSynthesis.speak(objectUtterance);
      collisionWarningState.lastWarningTime[classId] = now;
      return; // Exit early, warning will be spoken after object announcement
    } catch (error) {
      console.error('[Collision] Failed to announce object:', error);
      // Continue to warning message
    }
  }

  // Speak warning message (called after object announcement or directly)
  speakCollisionWarning(warningMessage, warningLevel);
  collisionWarningState.lastWarningTime[classId] = now;
}

/**
 * Speak collision warning message
 * @param {string} warningMessage - Warning message to speak
 * @param {string} warningLevel - Warning level ('critical', 'approaching', 'warning')
 */
function speakCollisionWarning(warningMessage, warningLevel) {
  console.log(`[Collision] ${warningLevel.toUpperCase()}: ${warningMessage}`);
  
  // Use SpeechCoordinator for critical warning (will cancel navigation speech)
  if (typeof window.SpeechCoordinator !== 'undefined') {
    if (!window.SpeechCoordinator.requestSpeak('critical')) {
      console.log('[Collision] ⏸️ Critical warning delayed - retrying...');
      setTimeout(() => {
        speakCollisionWarning(warningMessage, warningLevel);
      }, 500);
      return;
    }
  } else {
    // Fallback: Cancel any ongoing speech for immediate warning
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      voiceNavigationState.isSpeaking = false;
    }
  }

  // Speak with appropriate urgency in Indonesian
  const utterance = new SpeechSynthesisUtterance(warningMessage);
  utterance.lang = 'id-ID'; // Ensure Indonesian language
  
  // Try to get Indonesian voice for warning
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const indonesianVoice = getIndonesianVoice();
    if (indonesianVoice) {
      utterance.voice = indonesianVoice;
    }
  }
  
  if (warningLevel === 'critical') {
    utterance.rate = 1.2; // Faster for critical urgency
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
    if (typeof window.SpeechCoordinator !== 'undefined') {
      window.SpeechCoordinator.isModeDetectorWarning = true;
    }
    console.log(`[Collision] 🔊 Warning spoken: ${warningMessage}`);
  };

  utterance.onend = () => {
    collisionWarningState.isWarning = false;
    voiceNavigationState.isSpeaking = false;
    if (typeof window.SpeechCoordinator !== 'undefined') {
      window.SpeechCoordinator.markSpeechEnd('critical');
    }
    console.log(`[Collision] ✅ Warning ended`);
  };

  utterance.onerror = (error) => {
    collisionWarningState.isWarning = false;
    voiceNavigationState.isSpeaking = false;
    if (typeof window.SpeechCoordinator !== 'undefined') {
      window.SpeechCoordinator.markSpeechEnd('critical');
    }
    console.error(`[Collision] ❌ Warning error:`, error);
  };

  try {
    window.speechSynthesis.speak(utterance);
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

  if (voiceNavigationState.suspendedByCoordinator) {
    console.log('[Voice] Voice navigation suspended - skipping detections');
    return;
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
 * Pause voice navigation temporarily (used when navigation instructions have priority)
 * @param {string} reason - Reason for the pause (e.g., 'navigation')
 */
function pauseVoiceNavigation(reason = 'navigation') {
  voiceNavigationState.suspensionDepth = Math.max(voiceNavigationState.suspensionDepth || 0, 0) + 1;
  const isNavigationReason = reason === 'navigation' || reason === 'navigation-priority';
  if (isNavigationReason) {
    voiceNavigationState.navigatorPriorityDepth = Math.max(voiceNavigationState.navigatorPriorityDepth || 0, 0) + 1;
    voiceNavigationState.navigatorPriorityActive = true;
  }
  
  if (!voiceNavigationState.suspendedByCoordinator) {
    voiceNavigationState.suspendedByCoordinator = true;
    voiceNavigationState.suspensionReason = reason;
    console.log(`[Voice] 🔇 Voice navigation paused (${reason})`);
    
    // Hanya cancel object detector speech, JANGAN cancel navigator speech!
    // Check apakah yang sedang berbicara adalah object detector (bukan navigator)
    if (voiceNavigationState.isSpeaking && 'speechSynthesis' in window) {
      // Hanya cancel jika object detector yang berbicara
      // Navigator speech tidak boleh dibatalkan
      const coordinator = (typeof window !== 'undefined') ? window.SpeechCoordinator : null;
      const navigatorSpeaking = coordinator ? coordinator.isNavigationSpeaking : false;
      
      if (!navigatorSpeaking) {
        // Bukan navigator yang berbicara, safe to cancel (object detector speech)
        window.speechSynthesis.cancel();
        voiceNavigationState.isSpeaking = false;
        console.log('[Voice] ✅ Canceled object detector speech (not navigator)');
      } else {
        // Navigator sedang berbicara, jangan cancel!
        console.log('[Voice] ⚠️ Navigator speaking - NOT canceling speech');
        // Tapi tetap set isSpeaking = false untuk object detector
        voiceNavigationState.isSpeaking = false;
      }
    }
    
    // Reset collision warning state while paused
    collisionWarningState.isWarning = false;
  } else {
    console.log(`[Voice] ⏳ Voice navigation pause depth increased (${voiceNavigationState.suspensionDepth})`);
  }
}

/**
 * Resume voice navigation after temporary suspension
 * @param {string} reason - Reason for resume
 */
function resumeVoiceNavigation(reason = 'navigation') {
  if (!voiceNavigationState.suspensionDepth) return;
  
  voiceNavigationState.suspensionDepth = Math.max(voiceNavigationState.suspensionDepth - 1, 0);
  const isNavigationReason = reason === 'navigation' || reason === 'navigation-priority';
  if (isNavigationReason && voiceNavigationState.navigatorPriorityDepth) {
    voiceNavigationState.navigatorPriorityDepth = Math.max(voiceNavigationState.navigatorPriorityDepth - 1, 0);
    if (voiceNavigationState.navigatorPriorityDepth === 0) {
      voiceNavigationState.navigatorPriorityActive = false;
    }
  }
  
  if (voiceNavigationState.suspensionDepth === 0 && voiceNavigationState.suspendedByCoordinator) {
    voiceNavigationState.suspendedByCoordinator = false;
    voiceNavigationState.suspensionReason = '';
    console.log(`[Voice] 🔔 Voice navigation resumed (${reason})`);
  } else if (voiceNavigationState.suspendedByCoordinator) {
    console.log(`[Voice] ⏳ Waiting to resume voice navigation (depth: ${voiceNavigationState.suspensionDepth})`);
  }
}

function isVoiceNavigationSuspended() {
  return !!voiceNavigationState.suspendedByCoordinator;
}

function isVoiceNavigationEnabledState() {
  return !!voiceNavigationState.enabled;
}

if (typeof window !== 'undefined') {
  window.setVoiceNavigationEnabled = setVoiceNavigationEnabled;
  window.pauseVoiceNavigation = pauseVoiceNavigation;
  window.resumeVoiceNavigation = resumeVoiceNavigation;
  window.isVoiceNavigationSuspended = isVoiceNavigationSuspended;
  window.isVoiceNavigationEnabled = isVoiceNavigationEnabledState;
}

function setupNavigatorPriorityMonitor() {
  if (typeof window === 'undefined') return;
  if (voiceNavigationState.navigatorPriorityMonitor) return;
  
  voiceNavigationState.navigatorPriorityMonitor = setInterval(() => {
    const coordinator = window.SpeechCoordinator;
    if (!coordinator) return;
    
    // Check apakah navigator BENAR-BENAR sedang berbicara (bukan hanya flag)
    const navigatorActuallySpeaking = coordinator.isNavigationSpeaking && 
                                     (typeof window.speechSynthesis !== 'undefined') && 
                                     window.speechSynthesis.speaking;
    
    if (navigatorActuallySpeaking) {
      // Navigator benar-benar sedang berbicara - pause object detector
      if (!voiceNavigationState.navigatorPriorityActive) {
        pauseVoiceNavigation('navigation-priority');
        console.log('[ModeDetector] 🔇 Paused by navigator priority monitor (actually speaking)');
      }
    } else {
      // Navigator tidak berbicara - resume object detector jika paused karena navigator
      if (voiceNavigationState.navigatorPriorityActive && 
          voiceNavigationState.navigatorPriorityDepth > 0 &&
          voiceNavigationState.suspensionDepth > 0) {
        // Tunggu sedikit untuk memastikan navigator benar-benar selesai
        setTimeout(() => {
          const stillSpeaking = coordinator.isNavigationSpeaking && 
                               (typeof window.speechSynthesis !== 'undefined') && 
                               window.speechSynthesis.speaking;
          if (!stillSpeaking) {
            resumeVoiceNavigation('navigation-priority');
            console.log('[ModeDetector] 🔔 Resumed by navigator priority monitor (navigation finished)');
          }
        }, 300); // Delay 300ms untuk memastikan navigator benar-benar selesai
      }
    }
  }, 200); // Check setiap 200ms (lebih sering untuk responsif)
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setupNavigatorPriorityMonitor();
  } else {
    window.addEventListener('DOMContentLoaded', setupNavigatorPriorityMonitor, { once: true });
  }
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
 * Set up Indonesian voice if available
 */
function initVoiceNavigation() {
  if (!('speechSynthesis' in window)) {
    console.warn('[Voice] ⚠️ Speech synthesis not supported by browser');
    voiceNavigationState.enabled = false;
    return false;
  }

  // Load and check available voices
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    console.log(`[Voice] 📋 Available voices: ${voices.length} total`);
    
    // Check for Indonesian voices
    const indonesianVoices = voices.filter(voice => 
      voice.lang.toLowerCase().includes('id') || 
      voice.lang.toLowerCase().includes('indonesia')
    );
    
    if (indonesianVoices.length > 0) {
      console.log(`[Voice] ✅ Found ${indonesianVoices.length} Indonesian voice(s):`);
      indonesianVoices.forEach(voice => {
        console.log(`[Voice]   - ${voice.name} (${voice.lang})`);
      });
    } else {
      console.warn('[Voice] ⚠️ No Indonesian voice found. System will use default voice with Indonesian language.');
      console.log('[Voice] 💡 Tip: Install Indonesian language pack in your OS for better pronunciation.');
    }
    
    // List all available languages for debugging
    const languages = [...new Set(voices.map(v => v.lang))].sort();
    console.log(`[Voice] 📚 Available languages: ${languages.length}`, languages.slice(0, 10));
  };
  
  // Try to load voices immediately
  loadVoices();
  
  // Also listen for voices to be loaded (some browsers load voices asynchronously)
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  console.log('[Voice] ✅ Voice navigation initialized (Bahasa Indonesia)');
  console.log('[Voice] Settings:', {
    enabled: voiceNavigationState.enabled,
    language: 'id-ID (Bahasa Indonesia)',
    distanceRange: `${voiceNavigationState.distanceMin}-${voiceNavigationState.distanceMax}cm`,
    minAnnounceInterval: voiceNavigationState.minAnnounceInterval + 'ms'
  });

  // Initialize collision warning
  console.log('[Collision] ✅ Collision warning system initialized (Bahasa Indonesia)');
  console.log('[Collision] Settings:', {
    enabled: collisionWarningState.enabled,
    language: 'id-ID (Bahasa Indonesia)',
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

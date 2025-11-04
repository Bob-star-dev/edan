/**
 * Voice Navigation System
 * Mengumumkan nama objek yang terdeteksi dalam jarak 50cm atau kurang
 */

// Voice navigation state
const voiceNavigationState = {
  enabled: true,
  announcedObjects: new Set(),
  lastAnnounceTime: {},
  minAnnounceInterval: 2000,
  isSpeaking: false,
  distanceThreshold: 50
};

// Mapping class names ke Bahasa Indonesia
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
  'cell phone': 'telepon'
};

function getIndonesianClassName(className) {
  const lowerClassName = className.toLowerCase();
  return classNamesIndonesian[lowerClassName] || className;
}

function speakText(text, lang = 'id-ID') {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    return;
  }
  if (voiceNavigationState.isSpeaking) {
    console.log(' Speech already in progress, skipping:', text);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.onstart = () => {
    voiceNavigationState.isSpeaking = true;
    console.log(' Speaking:', text);
  };
  utterance.onend = () => {
    voiceNavigationState.isSpeaking = false;
    console.log(' Speech ended');
  };
  utterance.onerror = (error) => {
    voiceNavigationState.isSpeaking = false;
    console.error(' Speech error:', error);
  };
  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error(' Failed to speak:', error);
    voiceNavigationState.isSpeaking = false;
  }
}

function announceObjectIfNearby(classId, distance, className) {
  if (!voiceNavigationState.enabled) return;
  if (distance > voiceNavigationState.distanceThreshold) return;
  const now = Date.now();
  const lastTime = voiceNavigationState.lastAnnounceTime[classId] || 0;
  const timeSinceLastAnnounce = now - lastTime;
  if (timeSinceLastAnnounce < voiceNavigationState.minAnnounceInterval) {
    console.log(` Object ${className} (class ${classId}) announced too recently, skipping`);
    return;
  }
  if (voiceNavigationState.isSpeaking) {
    setTimeout(() => {
      if (!voiceNavigationState.isSpeaking) {
        announceObjectIfNearby(classId, distance, className);
      }
    }, 500);
    return;
  }
  const indonesianName = getIndonesianClassName(className);
  speakText(indonesianName);
  voiceNavigationState.announcedObjects.add(classId);
  voiceNavigationState.lastAnnounceTime[classId] = now;
  console.log(` Announced: ${indonesianName} (distance: ${distance.toFixed(1)}cm)`);
}

function processDetectionsForVoice(detections) {
  if (!voiceNavigationState.enabled) return;
  const nearbyDetections = detections.filter(det => det.distance <= voiceNavigationState.distanceThreshold);
  if (nearbyDetections.length === 0) return;
  nearbyDetections.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 5) {
      return (b.confidence || 0) - (a.confidence || 0);
    }
    return a.distance - b.distance;
  });
  const closestDetection = nearbyDetections[0];
  announceObjectIfNearby(closestDetection.classId, closestDetection.distance, closestDetection.className);
  if (nearbyDetections.length > 1 && !voiceNavigationState.isSpeaking) {
    for (let i = 1; i < nearbyDetections.length; i++) {
      setTimeout(() => {
        const detection = nearbyDetections[i];
        announceObjectIfNearby(detection.classId, detection.distance, detection.className);
      }, i * 1500);
    }
  }
}

function clearAnnouncedObjects() {
  voiceNavigationState.announcedObjects.clear();
  voiceNavigationState.lastAnnounceTime = {};
  console.log(' Cleared announced objects tracking');
}

function setVoiceNavigationEnabled(enabled) {
  voiceNavigationState.enabled = enabled;
  if (!enabled) {
    window.speechSynthesis.cancel();
    voiceNavigationState.isSpeaking = false;
  }
  console.log(` Voice navigation ${enabled ? 'enabled' : 'disabled'"`);
}

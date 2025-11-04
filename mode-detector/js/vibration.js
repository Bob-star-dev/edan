/**
 * Vibration Motor Control
 * Mengirim sinyal getar ke vibration motor ketika jarak <= 150 cm
 * 
 * Support untuk:
 * - Web Vibration API (untuk device mobile yang support)
 * - Serial/WebUSB API (untuk hardware eksternal)
 * - Console logging untuk debugging
 */

// Vibration state
const vibrationState = {
  isEnabled: true,
  distanceThreshold: 150, // Jarak dalam cm untuk trigger vibration
  vibrationDuration: 200, // Durasi getar dalam ms
  lastVibrationTime: 0,
  vibrationCooldown: 500, // Cooldown antara getar dalam ms (mencegah spam)
  useWebVibration: true, // Gunakan Web Vibration API jika tersedia
  useSerialPort: false, // Gunakan Serial Port jika tersedia
  serialPort: null,
  serialWriter: null
};

/**
 * Initialize vibration system
 * Check available APIs and setup accordingly
 */
async function initVibration() {
  console.log('[Vibration] Initializing vibration system...');
  
  // Check Web Vibration API support
  if ('vibrate' in navigator) {
    vibrationState.useWebVibration = true;
    console.log('[Vibration] ✅ Web Vibration API available');
  } else {
    vibrationState.useWebVibration = false;
    console.log('[Vibration] ⚠️ Web Vibration API not available (desktop browser)');
  }
  
  // Check Serial Port API support (for external hardware)
  if ('serial' in navigator) {
    console.log('[Vibration] ✅ Serial Port API available');
    console.log('[Vibration] 💡 To connect to external vibration motor, call: connectSerialPort()');
  } else {
    console.log('[Vibration] ⚠️ Serial Port API not available');
  }
  
  console.log('[Vibration] ✅ Vibration system initialized');
  console.log('[Vibration] 📊 Configuration:', {
    distanceThreshold: vibrationState.distanceThreshold + 'cm',
    vibrationDuration: vibrationState.vibrationDuration + 'ms',
    cooldown: vibrationState.vibrationCooldown + 'ms',
    webVibrationEnabled: vibrationState.useWebVibration,
    serialPortEnabled: vibrationState.useSerialPort
  });
}

/**
 * Connect to serial port for external vibration motor
 * This function should be called manually to connect to hardware
 */
async function connectSerialPort() {
  try {
    if (!('serial' in navigator)) {
      console.error('[Vibration] ❌ Serial Port API not available');
      return false;
    }
    
    console.log('[Vibration] 🔌 Connecting to serial port...');
    
    // Request port access
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    
    vibrationState.serialPort = port;
    vibrationState.serialWriter = port.writable.getWriter();
    vibrationState.useSerialPort = true;
    
    console.log('[Vibration] ✅ Serial port connected successfully');
    console.log('[Vibration] 📡 Ready to send vibration signals');
    
    return true;
  } catch (error) {
    console.error('[Vibration] ❌ Failed to connect serial port:', error);
    vibrationState.useSerialPort = false;
    return false;
  }
}

/**
 * Disconnect serial port
 */
async function disconnectSerialPort() {
  try {
    if (vibrationState.serialWriter) {
      await vibrationState.serialWriter.releaseLock();
      vibrationState.serialWriter = null;
    }
    
    if (vibrationState.serialPort) {
      await vibrationState.serialPort.close();
      vibrationState.serialPort = null;
    }
    
    vibrationState.useSerialPort = false;
    console.log('[Vibration] ✅ Serial port disconnected');
  } catch (error) {
    console.error('[Vibration] ❌ Error disconnecting serial port:', error);
  }
}

/**
 * Send vibration signal via Web Vibration API
 * @param {number} duration - Vibration duration in ms
 */
function vibrateWeb(duration) {
  try {
    if (vibrationState.useWebVibration && 'vibrate' in navigator) {
      navigator.vibrate(duration);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Vibration] ❌ Web vibration error:', error);
    return false;
  }
}

/**
 * Send vibration signal via Serial Port
 * Sends command to external vibration motor
 * @param {number} duration - Vibration duration in ms
 */
async function vibrateSerial(duration) {
  try {
    if (!vibrationState.useSerialPort || !vibrationState.serialWriter) {
      return false;
    }
    
    // Send vibration command to hardware
    // Format: "VIBRATE:<duration>\n"
    const command = `VIBRATE:${duration}\n`;
    const encoder = new TextEncoder();
    const data = encoder.encode(command);
    
    await vibrationState.serialWriter.write(data);
    return true;
  } catch (error) {
    console.error('[Vibration] ❌ Serial vibration error:', error);
    vibrationState.useSerialPort = false;
    return false;
  }
}

/**
 * Trigger vibration based on distance
 * Called when object is detected within threshold distance
 * @param {number} distance - Distance in cm
 * @param {string} objectName - Name of detected object (for logging)
 */
async function triggerVibration(distance, objectName = 'object') {
  // Check if vibration is enabled
  if (!vibrationState.isEnabled) {
    return;
  }
  
  // Check cooldown to prevent spam
  const now = Date.now();
  const timeSinceLastVibration = now - vibrationState.lastVibrationTime;
  if (timeSinceLastVibration < vibrationState.vibrationCooldown) {
    // Still in cooldown, skip
    return;
  }
  
  // Check distance threshold
  if (distance > vibrationState.distanceThreshold) {
    return;
  }
  
  // Update last vibration time
  vibrationState.lastVibrationTime = now;
  
  // Calculate vibration intensity based on distance
  // Closer = stronger vibration
  const maxDistance = vibrationState.distanceThreshold;
  const minDistance = 50; // Minimum distance for max vibration
  const distanceRatio = Math.max(0, Math.min(1, (maxDistance - distance) / (maxDistance - minDistance)));
  const vibrationIntensity = Math.round(100 + (distanceRatio * 100)); // 100-200ms
  
  console.log(`[Vibration] 🔔 VIBRATION TRIGGERED!`, {
    object: objectName,
    distance: distance.toFixed(1) + 'cm',
    threshold: vibrationState.distanceThreshold + 'cm',
    intensity: vibrationIntensity + 'ms',
    methods: {
      webVibration: vibrationState.useWebVibration,
      serialPort: vibrationState.useSerialPort
    }
  });
  
  // Try Web Vibration API first (for mobile devices)
  let webVibrationSuccess = false;
  if (vibrationState.useWebVibration) {
    webVibrationSuccess = vibrateWeb(vibrationIntensity);
    if (webVibrationSuccess) {
      console.log(`[Vibration] ✅ Web Vibration API signal sent (${vibrationIntensity}ms)`);
    }
  }
  
  // Try Serial Port (for external hardware)
  let serialVibrationSuccess = false;
  if (vibrationState.useSerialPort) {
    serialVibrationSuccess = await vibrateSerial(vibrationIntensity);
    if (serialVibrationSuccess) {
      console.log(`[Vibration] ✅ Serial Port signal sent (${vibrationIntensity}ms)`);
    }
  }
  
  // Log if no method worked
  if (!webVibrationSuccess && !serialVibrationSuccess) {
    console.warn(`[Vibration] ⚠️ No vibration method available`, {
      webVibrationAvailable: vibrationState.useWebVibration,
      serialPortAvailable: vibrationState.useSerialPort,
      note: 'Connect serial port or use mobile device for vibration'
    });
  } else {
    console.log(`[Vibration] ✅ Vibration signal successfully sent!`);
  }
}

/**
 * Check if any object is within vibration threshold
 * This function processes all detections and triggers vibration for closest object
 * @param {Array} detections - Array of detection objects {distance, className, ...}
 */
function checkAndTriggerVibration(detections) {
  if (!vibrationState.isEnabled || !detections || detections.length === 0) {
    return;
  }
  
  // Filter detections within threshold
  const nearbyDetections = detections.filter(det => 
    typeof det.distance === 'number' && 
    det.distance <= vibrationState.distanceThreshold
  );
  
  if (nearbyDetections.length === 0) {
    return;
  }
  
  // Find closest object
  const closestDetection = nearbyDetections.reduce((closest, current) => {
    return current.distance < closest.distance ? current : closest;
  });
  
  // Trigger vibration for closest object
  triggerVibration(closestDetection.distance, closestDetection.className || 'object');
}

/**
 * Enable/disable vibration
 * @param {boolean} enabled - Enable or disable vibration
 */
function setVibrationEnabled(enabled) {
  vibrationState.isEnabled = enabled;
  console.log(`[Vibration] ${enabled ? '✅ Enabled' : '❌ Disabled'}`);
}

/**
 * Set distance threshold for vibration
 * @param {number} thresholdCm - Distance threshold in cm
 */
function setVibrationThreshold(thresholdCm) {
  vibrationState.distanceThreshold = thresholdCm;
  console.log(`[Vibration] 📊 Threshold updated: ${thresholdCm}cm`);
}

/**
 * Get vibration status
 */
function getVibrationStatus() {
  return {
    enabled: vibrationState.isEnabled,
    threshold: vibrationState.distanceThreshold + 'cm',
    duration: vibrationState.vibrationDuration + 'ms',
    cooldown: vibrationState.vibrationCooldown + 'ms',
    webVibrationAvailable: vibrationState.useWebVibration,
    serialPortConnected: vibrationState.useSerialPort
  };
}

// Initialize on load
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVibration);
  } else {
    initVibration();
  }
  
  // Make functions available globally for console access
  window.connectSerialPort = connectSerialPort;
  window.disconnectSerialPort = disconnectSerialPort;
  window.setVibrationEnabled = setVibrationEnabled;
  window.setVibrationThreshold = setVibrationThreshold;
  window.getVibrationStatus = getVibrationStatus;
  window.triggerVibration = triggerVibration; // For testing
}


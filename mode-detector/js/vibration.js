/**
 * Vibration Motor Control
 * Mengirim sinyal getar ke vibration motor ketika jarak <= 150 cm
 * 
 * IMPORTANT: Device akan bergetar ketika jarak objek <= 150 cm (termasuk tepat 150 cm)
 * Target: ESP32-CAM dengan vibration motor yang terhubung
 * 
 * Support untuk:
 * - ESP32-CAM HTTP API (mengirim sinyal ke ESP32-CAM untuk mengaktifkan vibration motor)
 * - Web Vibration API (fallback untuk device mobile yang support - Chrome/Edge/Safari mobile)
 * - Serial/WebUSB API (untuk hardware eksternal)
 * - Console logging untuk debugging
 * 
 * Fungsi Vibration:
 * - vibrate() - Getar sederhana 1000ms
 * - vibratePattern() - Pola getar [300, 400, 300, 400]
 * - vibrateMario() - Pola getar Mario [125, 75, 125, 275, 200, 275, 125, 75, 125, 275, 200, 600, 200, 600]
 * 
 * Sistem otomatis menggunakan pola berbeda berdasarkan jarak:
 * - <30cm: Mario pattern (CRITICAL)
 * - <50cm: Pattern vibration (WARNING)
 * - 50-150cm: Simple vibration dengan intensity dinamis (NORMAL)
 * - Jarak tepat 150 cm: Akan trigger vibration dengan pola NORMAL
 */

// ESP32-CAM Configuration untuk vibration motor
// Menggunakan DNS yang sama dengan ESP32-CAM camera
// Pastikan ESP32-CAM memiliki endpoint untuk mengontrol vibration motor
// Note: ESP32_DNS harus sama dengan yang ada di camera.js
function getESP32DNS() {
  // Get ESP32 DNS from camera.js if available, otherwise use default
  if (typeof window !== 'undefined' && window.ESP32_DNS) {
    return window.ESP32_DNS;
  }
  return 'esp32cam.local'; // Default DNS
}

function getESP32IP() {
  // Get ESP32 IP from camera.js if available
  if (typeof window !== 'undefined' && window.ESP32_IP) {
    return window.ESP32_IP;
  }
  return null;
}

function getESP32VibrateURL() {
  // Prioritaskan IP address jika tersedia (lebih reliable di Windows desktop)
  // IP address tidak bergantung pada mDNS yang mungkin tidak bekerja di Windows
  const ip = getESP32IP();
  if (ip) {
    return `http://${ip}/vibrate`;  // Gunakan IP address
  }
  
  // Fallback ke DNS
  const dns = getESP32DNS();
  return `http://${dns}/vibrate`;  // Endpoint untuk vibration motor
  // Alternative endpoints (sesuaikan dengan firmware ESP32-CAM Anda):
  // return `http://${dns}/motor/vibrate`;
  // return `http://${dns}/api/vibrate`;
}

// Vibration state
const vibrationState = {
  isEnabled: true,
  distanceThreshold: 150, // Jarak dalam cm untuk trigger vibration
  vibrationDuration: 200, // Durasi getar dalam ms
  lastVibrationTime: 0,
  vibrationCooldown: 500, // Cooldown antara getar dalam ms (mencegah spam)
  useESP32Vibration: true, // Gunakan ESP32-CAM vibration motor (prioritas utama)
  useWebVibration: false, // Fallback: Web Vibration API jika tersedia
  useSerialPort: false, // Gunakan Serial Port jika tersedia
  serialPort: null,
  serialWriter: null
};

/**
 * Send vibration signal to ESP32-CAM
 * Mengirim HTTP request ke ESP32-CAM untuk mengaktifkan vibration motor
 * @param {number|Array} pattern - Vibration pattern (duration in ms or array of [on, off, on, off, ...])
 * @param {string} direction - Direction: "left", "right", "both", or "stop" (optional)
 * @returns {Promise<boolean>} True if request sent successfully
 */
async function vibrateESP32(pattern, direction = null) {
  if (!vibrationState.useESP32Vibration) {
    return false;
  }
  
  try {
    // Convert pattern to duration string
    // If pattern is array, use first duration (ESP32 will handle pattern)
    // If pattern is number, use it directly
    let duration = 200; // Default duration
    if (Array.isArray(pattern)) {
      // For pattern array, calculate total duration or use first value
      // ESP32 firmware might need pattern in specific format
      duration = pattern[0] || 200;
    } else if (typeof pattern === 'number') {
      duration = Math.max(0, Math.min(5000, pattern)); // Limit 0-5000ms
    }
    
    // Build URL with parameters
    const baseUrl = getESP32VibrateURL();
    let url;
    
    // If direction is specified, use direction parameter
    if (direction && (direction === 'left' || direction === 'right' || direction === 'both' || direction === 'stop')) {
      url = `${baseUrl}?direction=${direction}&duration=${duration}&t=${Date.now()}`;
      // Only log occasionally to avoid console spam
      if (!window._lastDirectionalVibrationLog || Date.now() - window._lastDirectionalVibrationLog > 5000) {
        console.log(`[Vibration] 📡 Sending directional vibration to ESP32-CAM: ${url}`);
        console.log(`[Vibration] 📡 Direction: ${direction}, Duration: ${duration}ms`);
        window._lastDirectionalVibrationLog = Date.now();
      }
    } else {
      // Default: both motors
      url = `${baseUrl}?duration=${duration}&t=${Date.now()}`;
      // Only log occasionally to avoid console spam
      if (!window._lastVibrationUrlLog || Date.now() - window._lastVibrationUrlLog > 5000) {
        console.log(`[Vibration] 📡 Sending vibration signal to ESP32-CAM: ${url}`);
        console.log(`[Vibration] 📡 Duration: ${duration}ms (both motors)`);
        window._lastVibrationUrlLog = Date.now();
      }
    }
    
    // Send HTTP GET request to ESP32-CAM
    // Use no-cors mode directly to avoid CORS preflight issues
    // ESP32-CAM typically doesn't send proper CORS headers, so we use no-cors mode
    let response;
    let responseStatus = null;
    
    try {
      // Use no-cors mode directly to avoid CORS preflight issues
      // This prevents the "cache-control header not allowed" error
      // Note: With no-cors, we can't read the response, but the request is sent
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors', // Use no-cors to avoid CORS preflight issues
        cache: 'no-cache',
        signal: controller.signal
        // Don't add custom headers - they trigger preflight requests
      });
      clearTimeout(timeoutId);
      
      // With no-cors mode, we can't check response status (response.status is always 0)
      // But if no error is thrown, the request was sent successfully
      // Assume success if no error occurred
      // Only log occasionally to avoid console spam
      if (!window._lastVibrationSuccessLog || Date.now() - window._lastVibrationSuccessLog > 5000) {
        console.log(`[Vibration] ✅ Vibration signal sent to ESP32-CAM (${duration}ms) - no-cors mode`);
        window._lastVibrationSuccessLog = Date.now();
      }
      return true;
    } catch (error) {
      // Check if it's a timeout or connection error
      const isTimeout = error.name === 'AbortError' || 
                        error.message.includes('timeout') ||
                        error.message.includes('TIMED_OUT') ||
                        error.message.includes('ERR_CONNECTION_TIMED_OUT');
      
      const isConnectionError = error.message.includes('Failed to fetch') ||
                                error.message.includes('ERR_CONNECTION_REFUSED') ||
                                error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
                                error.message.includes('NetworkError');
      
      // Only log connection errors once (throttle logging)
      if (isTimeout || isConnectionError) {
        // Don't log every error - too verbose
        // Only log if this is the first error or after a delay
        if (!window._lastVibrationErrorLog || Date.now() - window._lastVibrationErrorLog > 10000) {
          console.warn(`[Vibration] ⚠️ ESP32-CAM tidak dapat dihubungi (timeout/connection error)`);
          console.warn(`[Vibration] 💡 Pastikan ESP32-CAM terhubung ke WiFi yang sama`);
          console.warn(`[Vibration] 💡 IP: ${url.split('/')[2]}`);
          console.warn(`[Vibration] 💡 Menggunakan Web Vibration API sebagai fallback`);
          window._lastVibrationErrorLog = Date.now();
        }
        // Return false to trigger fallback
        return false;
      }
      
      // Other errors - log occasionally
      if (!window._lastVibrationErrorLog || Date.now() - window._lastVibrationErrorLog > 10000) {
        console.warn(`[Vibration] ⚠️ Error sending vibration:`, error.message);
        window._lastVibrationErrorLog = Date.now();
      }
      return false;
    }
    
  } catch (error) {
    console.error(`[Vibration] ❌ Failed to send vibration signal to ESP32-CAM:`, error);
    
    // Check if it's a DNS resolution error
    const isDNSError = error.message && (
      error.message.includes('NAME_NOT_RESOLVED') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('ERR_NAME_NOT_RESOLVED')
    );
    
    const ip = getESP32IP();
    const dns = getESP32DNS();
    const url = getESP32VibrateURL();
    
    console.error(`[Vibration] ❌ Error details:`, {
      name: error.name,
      message: error.message,
      url: url,
      isDNSError: isDNSError,
      note: 'Pastikan ESP32-CAM terhubung dan memiliki endpoint /vibrate'
    });
    
    if (isDNSError && !ip) {
      console.error(`[Vibration] 💡 SOLUSI: DNS tidak bisa di-resolve (umum di Windows desktop)`);
      console.error(`[Vibration] 💡 Set ESP32_IP di camera.js (line ~109)`);
      console.error(`[Vibration] 💡 Cara menemukan IP ESP32-CAM:`);
      console.error(`[Vibration] 💡 1. Buka Serial Monitor di Arduino IDE (115200 baud)`);
      console.error(`[Vibration] 💡 2. ESP32-CAM akan menampilkan IP setelah connect WiFi`);
      console.error(`[Vibration] 💡 3. Atau cek di router WiFi Anda`);
      console.error(`[Vibration] 💡 4. Contoh: const ESP32_IP = '192.168.1.100';`);
      console.error(`[Vibration] 💡 5. Setelah set IP, refresh browser`);
    }
    
    return false;
  }
}

/**
 * Send vibration pattern to ESP32-CAM
 * Untuk pattern array, mengirim setiap pulse secara sequential
 * @param {Array} pattern - Array of [on, off, on, off, ...] durations in ms
 * @returns {Promise<boolean>} True if pattern sent successfully
 */
async function vibrateESP32Pattern(pattern, direction = null) {
  if (!vibrationState.useESP32Vibration || !Array.isArray(pattern)) {
    return false;
  }
  
  try {
    console.log(`[Vibration] 📡 Sending vibration pattern to ESP32-CAM:`, pattern);
    if (direction) {
      console.log(`[Vibration] 📡 Direction: ${direction}`);
    }
    
    // Method 1: Send pattern as comma-separated values
    // Format: http://esp32cam.local/vibrate?pattern=200,100,200,100&direction=left
    const patternString = pattern.join(',');
    const baseUrl = getESP32VibrateURL();
    let url;
    
    if (direction && (direction === 'left' || direction === 'right' || direction === 'both' || direction === 'stop')) {
      url = `${baseUrl}?pattern=${patternString}&direction=${direction}&t=${Date.now()}`;
    } else {
      url = `${baseUrl}?pattern=${patternString}&t=${Date.now()}`;
    }
    
    console.log(`[Vibration] 📡 Pattern URL: ${url}`);
    
    // Use no-cors mode directly to avoid CORS preflight issues
    // ESP32-CAM typically doesn't send proper CORS headers
    let timeoutId = null;
    
    try {
      // Use no-cors mode to avoid CORS preflight issues
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors', // Use no-cors to avoid CORS preflight issues
        signal: controller.signal,
        cache: 'no-cache'
        // Don't add custom headers - they trigger preflight requests
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      
      // With no-cors mode, we can't check response status
      // But if no error is thrown, the request was sent successfully
      // Only log occasionally to avoid console spam
      if (!window._lastVibrationPatternSuccessLog || Date.now() - window._lastVibrationPatternSuccessLog > 5000) {
        console.log(`[Vibration] ✅ Vibration pattern sent to ESP32-CAM - no-cors mode`);
        window._lastVibrationPatternSuccessLog = Date.now();
      }
      return true;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      
      // Check if it's a timeout or connection error
      const isTimeout = error.name === 'AbortError' || 
                        error.message.includes('timeout') ||
                        error.message.includes('TIMED_OUT') ||
                        error.message.includes('ERR_CONNECTION_TIMED_OUT');
      
      const isConnectionError = error.message.includes('Failed to fetch') ||
                                error.message.includes('ERR_CONNECTION_REFUSED') ||
                                error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
                                error.message.includes('NetworkError');
      
      // Only log connection errors occasionally (throttle logging)
      if (isTimeout || isConnectionError) {
        if (!window._lastVibrationErrorLog || Date.now() - window._lastVibrationErrorLog > 10000) {
          console.warn(`[Vibration] ⚠️ ESP32-CAM tidak dapat dihubungi (timeout/connection error)`);
          console.warn(`[Vibration] 💡 Pastikan ESP32-CAM terhubung ke WiFi yang sama`);
          window._lastVibrationErrorLog = Date.now();
        }
        return false;
      }
      
      // Other errors - log occasionally
      if (!window._lastVibrationErrorLog || Date.now() - window._lastVibrationErrorLog > 10000) {
        console.warn(`[Vibration] ⚠️ Error sending vibration pattern:`, error.message);
        window._lastVibrationErrorLog = Date.now();
      }
      return false;
    }
    
  } catch (error) {
    console.error(`[Vibration] ❌ Failed to send vibration pattern to ESP32-CAM:`, error);
    
    // Fallback: Send pattern sequentially (slower but more compatible)
    console.log(`[Vibration] 💡 Trying sequential pattern method...`);
    try {
      for (let i = 0; i < pattern.length; i += 2) {
        const onDuration = pattern[i];
        const offDuration = pattern[i + 1] || 0;
        
        if (onDuration > 0) {
          await vibrateESP32(onDuration, direction);
          if (offDuration > 0 && i + 1 < pattern.length) {
            await new Promise(resolve => setTimeout(resolve, offDuration));
          }
        }
      }
      return true;
    } catch (fallbackError) {
      console.error(`[Vibration] ❌ Sequential pattern also failed:`, fallbackError);
      return false;
    }
  }
}

/**
 * Initialize vibration system
 * Check available APIs and setup accordingly
 * Enhanced with permission checking and troubleshooting tips
 */
async function initVibration() {
  console.log('[Vibration] Initializing vibration system...');
  const esp32Dns = getESP32DNS();
  const esp32VibrateUrl = getESP32VibrateURL();
  console.log(`[Vibration] 📡 ESP32-CAM DNS: ${esp32Dns}`);
  console.log(`[Vibration] 📡 ESP32 Vibration URL: ${esp32VibrateUrl}`);
  console.log(`[Vibration] 📡 ESP32 Vibration enabled: ${vibrationState.useESP32Vibration}`);
  
  // ESP32-CAM vibration is primary method
  if (vibrationState.useESP32Vibration) {
    console.log('[Vibration] ✅ ESP32-CAM vibration motor configured');
    console.log(`[Vibration] 💡 Vibration akan dikirim ke: ${esp32VibrateUrl}`);
    console.log(`[Vibration] 💡 Format: GET ${esp32VibrateUrl}?duration=200`);
    console.log(`[Vibration] 💡 Pattern: GET ${esp32VibrateUrl}?pattern=200,100,200,100`);
  }
  
  // Check Web Vibration API support (fallback)
  // Web Vibration API bekerja di mobile browser (Chrome/Edge/Safari mobile)
  if ('vibrate' in navigator) {
    vibrationState.useWebVibration = true;
    console.log('[Vibration] ✅ Web Vibration API available (fallback)');
    console.log('[Vibration] 📱 Handphone akan bergetar ketika objek terdeteksi dalam jarak ≤150cm');
    console.log('[Vibration] 📱 Ketika jarak tepat 150 cm, device akan bergetar');
    
    // Check if we can actually test vibration (some browsers need user interaction first)
    try {
      // Try a very short vibration to test if it works
      const testResult = navigator.vibrate(1); // 1ms test - should be barely noticeable
      console.log('[Vibration] 📊 Test vibration result:', testResult);
      
      if (testResult === false) {
        console.warn('[Vibration] ⚠️ Vibration test returned false - may not be supported');
        console.warn('[Vibration] 💡 Possible causes:');
        console.warn('[Vibration] 💡 1. Device in silent/Do Not Disturb mode');
        console.warn('[Vibration] 💡 2. System vibration disabled');
        console.warn('[Vibration] 💡 3. Browser permission not granted');
      }
    } catch (error) {
      console.warn('[Vibration] ⚠️ Vibration test error:', error);
    }
    
    // Test vibration support (but don't actually vibrate during init)
    // Just log that it's available
    console.log('[Vibration] 💡 Test vibration dengan: vibrate(), vibratePattern(), atau vibrateMario()');
    console.log('[Vibration] 💡 Jika HP tidak bergetar, cek:');
    console.log('[Vibration] 💡 - Mode Silent/Do Not Disturb di HP');
    console.log('[Vibration] 💡 - Setting vibration di system HP');
    console.log('[Vibration] 💡 - Permission vibration di browser');
  } else {
    vibrationState.useWebVibration = false;
    console.log('[Vibration] ⚠️ Web Vibration API not available');
    console.log('[Vibration] 📱 Handphone TIDAK akan bergetar - gunakan browser mobile atau device yang support');
    console.log('[Vibration] 💡 Desktop browser biasanya tidak support Web Vibration API');
    console.log('[Vibration] 💡 Untuk mobile: gunakan Chrome/Edge/Safari di handphone Android/iOS');
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
 * Enhanced with better error handling and diagnostic
 * Also checks for common issues that prevent vibration
 * @param {number|Array} pattern - Vibration duration in ms or pattern array [vibrate, pause, vibrate, ...]
 */
function vibrateWeb(pattern) {
  try {
    // Check if vibrate exists in navigator (most direct check)
    if (!('vibrate' in navigator)) {
      console.warn('[Vibration] ❌ navigator.vibrate not available');
      return false;
    }
    
    // Normalize pattern - ensure it's valid
    // Some devices may have issues with very long patterns
    let normalizedPattern = pattern;
    if (Array.isArray(pattern)) {
      // Check pattern length - some devices may limit array length
      if (pattern.length > 20) {
        console.warn('[Vibration] ⚠️ Pattern too long, truncating to first 20 elements');
        normalizedPattern = pattern.slice(0, 20);
      }
      // Ensure all values are positive numbers
      normalizedPattern = normalizedPattern.map(v => Math.max(0, Math.round(v)));
    } else if (typeof pattern === 'number') {
      // Ensure positive number and not too long (some devices limit to 5 seconds)
      normalizedPattern = Math.max(0, Math.min(5000, Math.round(pattern)));
    }
    
    // Try to call vibrate directly (more reliable)
    // Some browsers may have vibrate but it might not work in all contexts
    const result = navigator.vibrate(normalizedPattern);
    
    // vibrate() returns true if pattern is supported, false otherwise
    // But some browsers may return undefined, so we check both
    if (result === true || result === undefined) {
      console.log('[Vibration] ✅ Vibration command sent:', normalizedPattern);
      
      // Additional check: if result is false, device may not support or is in silent mode
      if (result === false) {
        console.warn('[Vibration] ⚠️ Vibration returned false - device may be in silent mode or vibration disabled');
        console.warn('[Vibration] 💡 Check:');
        console.warn('[Vibration] 💡 1. Device not in silent/Do Not Disturb mode');
        console.warn('[Vibration] 💡 2. System vibration enabled');
        console.warn('[Vibration] 💡 3. Browser vibration permission');
      }
      
      return true;
    } else {
      console.warn('[Vibration] ⚠️ Vibration pattern not supported:', normalizedPattern);
      console.warn('[Vibration] 💡 Device may be in silent mode or vibration disabled');
      return false;
    }
  } catch (error) {
    console.error('[Vibration] ❌ Web vibration error:', error);
    console.error('[Vibration] ❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    return false;
  }
}

/**
 * Simple vibration - 1000ms continuous
 * Getar sederhana selama 1 detik
 * Enhanced with better diagnostic
 */
function vibrate() {
  if (!vibrationState.isEnabled) {
    console.log('[Vibration] ⚠️ Vibration is disabled');
    return false;
  }
  
  console.log('[Vibration] 🔔 Simple vibration triggered (1000ms)');
  
  // Diagnostic: Check navigator.vibrate availability
  const hasVibrate = 'vibrate' in navigator;
  console.log('[Vibration] 📊 Diagnostic:', {
    hasNavigatorVibrate: hasVibrate,
    useWebVibration: vibrationState.useWebVibration,
    navigatorType: typeof navigator,
    userAgent: navigator.userAgent.substring(0, 50)
  });
  
  if (!hasVibrate) {
    console.error('[Vibration] ❌ navigator.vibrate not found');
    console.error('[Vibration] 💡 Browser mungkin tidak support Web Vibration API');
    return false;
  }
  
  const success = vibrateWeb(1000);
  
  if (success) {
    console.log('[Vibration] ✅ Simple vibration sent successfully');
  } else {
    console.warn('[Vibration] ⚠️ Vibration command failed');
    console.warn('[Vibration] 💡 Mungkin device/browser tidak support atau ada masalah');
  }
  
  return success;
}

/**
 * Pattern vibration - [300ms vibrate, 400ms pause, 300ms vibrate, 400ms pause]
 * Pola getar dengan interval
 */
function vibratePattern() {
  if (!vibrationState.isEnabled) {
    console.log('[Vibration] ⚠️ Vibration is disabled');
    return;
  }
  
  const pattern = [300, 400, 300, 400];
  console.log('[Vibration] 🔔 Pattern vibration triggered:', pattern);
  const success = vibrateWeb(pattern);
  
  if (success) {
    console.log('[Vibration] ✅ Pattern vibration sent');
  } else {
    console.warn('[Vibration] ⚠️ Web Vibration API not available');
  }
  
  return success;
}

/**
 * Mario vibration pattern - Special pattern inspired by Super Mario theme
 * Pola getar khusus seperti lagu Mario
 */
function vibrateMario() {
  if (!vibrationState.isEnabled) {
    console.log('[Vibration] ⚠️ Vibration is disabled');
    return;
  }
  

  const pattern = [125, 75, 125, 275, 200, 275, 125, 75, 125, 275, 200, 600, 200, 600];
  console.log('[Vibration] 🔔 Mario vibration pattern triggered:', pattern);
  const success = vibrateWeb(pattern);
  
  if (success) {
    console.log('[Vibration] ✅ Mario vibration pattern sent');
  } else {
    console.warn('[Vibration] ⚠️ Web Vibration API not available');
  }
  
  return success;
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
 * Uses different vibration patterns based on distance severity
 * Device akan bergetar ketika jarak <= 150 cm (termasuk tepat 150 cm)
 * @param {number} distance - Distance in cm
 * @param {string} objectName - Name of detected object (for logging)
 */
/**
 * Determine vibration direction based on object position
 * @param {number} relativeX - Relative X position (0.0 = left, 1.0 = right)
 * @returns {string} Direction: "left", "right", or "both"
 */
function getVibrationDirection(relativeX) {
  if (relativeX === undefined || relativeX === null || isNaN(relativeX)) {
    return 'both'; // Default: both motors if position unknown
  }
  
  // Divide screen into 3 zones:
  // Left zone (0.0 - 0.33): Motor kiri
  // Center zone (0.33 - 0.67): Kedua motor
  // Right zone (0.67 - 1.0): Motor kanan
  if (relativeX < 0.33) {
    return 'left';
  } else if (relativeX > 0.67) {
    return 'right';
  } else {
    return 'both';
  }
}

async function triggerVibration(distance, objectName = 'object', detection = null) {
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
  
  // Check distance threshold - trigger vibration when distance <= 150cm (including exactly 150cm)
  // Jarak 150 cm akan trigger vibration
  if (distance > vibrationState.distanceThreshold) {
    return;
  }
  
  // Determine vibration direction based on object position
  let direction = 'both'; // Default: both motors
  if (detection && typeof detection.relativeX === 'number') {
    direction = getVibrationDirection(detection.relativeX);
    console.log(`[Vibration] 📍 Object position: ${(detection.relativeX * 100).toFixed(1)}% (${direction === 'left' ? '⬅️ Kiri' : direction === 'right' ? '➡️ Kanan' : '📳 Tengah/Kedua'})`);
  }
  
  // Update last vibration time
  vibrationState.lastVibrationTime = now;
  
  // Determine vibration pattern based on distance
  // Critical (<30cm): Mario pattern (most urgent)
  // Warning (<50cm): Pattern vibration (urgent)
  // Normal (50-150cm): Simple vibration (moderate)
  let vibrationPattern;
  let vibrationType;
  
  if (distance < 30) {
    // Critical - use Mario pattern for maximum attention
    vibrationPattern = [125, 75, 125, 275, 200, 275, 125, 75, 125, 275, 200, 600, 200, 600];
    vibrationType = 'CRITICAL (Mario pattern)';
  } else if (distance < 50) {
    // Warning - use pattern vibration
    vibrationPattern = [300, 400, 300, 400];
    vibrationType = 'WARNING (Pattern)';
  } else {
    // Normal - use simple vibration with intensity based on distance
    const maxDistance = vibrationState.distanceThreshold;
    const minDistance = 50;
    const distanceRatio = Math.max(0, Math.min(1, (maxDistance - distance) / (maxDistance - minDistance)));
    const vibrationIntensity = Math.round(100 + (distanceRatio * 100)); // 100-200ms
    vibrationPattern = vibrationIntensity;
    vibrationType = `NORMAL (${vibrationIntensity}ms)`;
  }
  
  console.log(`[Vibration] 🔔 VIBRATION TRIGGERED!`, {
    object: objectName,
    distance: distance.toFixed(1) + 'cm',
    threshold: vibrationState.distanceThreshold + 'cm',
    type: vibrationType,
    pattern: Array.isArray(vibrationPattern) ? vibrationPattern : vibrationPattern + 'ms',
    methods: {
      esp32Vibration: vibrationState.useESP32Vibration,
      webVibration: vibrationState.useWebVibration,
      serialPort: vibrationState.useSerialPort
    },
    note: '📳 Vibration motor akan aktif ketika jarak <= 150 cm (termasuk tepat 150 cm)'
  });
  
  // Show prominent visual notification when vibration is triggered
  // This helps user know vibration should happen even if device doesn't vibrate
  // Flash effect disabled - uncomment below to re-enable screen flash overlay
  /*
  if (typeof document !== 'undefined') {
    // Create flash effect overlay
    const flashOverlay = document.createElement('div');
    flashOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 200, 0, 0.3);
      z-index: 9999;
      pointer-events: none;
      animation: vibrationFlash 0.3s ease-out;
    `;
    
    // Add animation keyframes if not exists
    if (!document.getElementById('vibration-flash-style')) {
      const style = document.createElement('style');
      style.id = 'vibration-flash-style';
      style.textContent = `
        @keyframes vibrationFlash {
          0% { opacity: 0.6; }
          50% { opacity: 0.3; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(flashOverlay);
    setTimeout(() => {
      flashOverlay.remove();
    }, 300);
  }
  */
  
  // Show notification message
  if (typeof showError === 'function') {
    const esp32Dns = getESP32DNS();
    const esp32VibrateUrl = getESP32VibrateURL();
    const vibrationMsg = `📳 GETARAN AKTIF! Objek: ${objectName} (${distance.toFixed(1)}cm)\n\n✅ Sinyal vibration dikirim ke ESP32-CAM\n\n⚠️ Jika vibration motor TIDAK berfungsi:\n\n1. Periksa Koneksi ESP32-CAM\n   → Pastikan ESP32-CAM terhubung ke WiFi\n   → Pastikan DNS benar: ${esp32Dns}\n   → Coba akses: ${esp32VibrateUrl}\n\n2. Periksa Endpoint Vibration\n   → Pastikan ESP32-CAM memiliki endpoint /vibrate\n   → Endpoint harus menerima parameter: ?duration=200\n\n3. Periksa Koneksi Vibration Motor\n   → Pastikan motor terhubung ke pin GPIO ESP32\n   → Pastikan kode ESP32-CAM mendukung kontrol vibration\n\n4. Periksa Console Log\n   → Lihat pesan error di console browser\n   → Cek apakah HTTP request berhasil dikirim`;
    showError(vibrationMsg);
    // Hide after 3 seconds (longer so user can read)
    setTimeout(() => {
      if (typeof hideError === 'function') {
        hideError();
      }
    }, 3000);
  }
  
  // Try ESP32-CAM vibration motor first (priority method)
  // ESP32-CAM akan mengaktifkan kedua vibration motor secara bersamaan
  let esp32VibrationSuccess = false;
  if (vibrationState.useESP32Vibration) {
    // Only log occasionally to avoid console spam (throttle to once per 5 seconds)
    if (!window._lastVibrationSendLog || Date.now() - window._lastVibrationSendLog > 5000) {
      console.log(`[Vibration] 📡 Sending vibration to ESP32-CAM...`);
      console.log(`[Vibration] 📡 Object: ${objectName}, Distance: ${distance.toFixed(1)}cm`);
      console.log(`[Vibration] 📡 Pattern: ${Array.isArray(vibrationPattern) ? vibrationPattern.join(',') : vibrationPattern}ms`);
      window._lastVibrationSendLog = Date.now();
    }
    
    if (Array.isArray(vibrationPattern)) {
      // Send pattern array to ESP32-CAM with direction
      // Pattern akan dikirim ke endpoint /vibrate?pattern=200,100,200,100&direction=left
      esp32VibrationSuccess = await vibrateESP32Pattern(vibrationPattern, direction);
    } else {
      // Send simple duration to ESP32-CAM with direction
      // Duration akan dikirim ke endpoint /vibrate?duration=200&direction=left
      esp32VibrationSuccess = await vibrateESP32(vibrationPattern, direction);
    }
    
    if (esp32VibrationSuccess) {
      // Only log occasionally to avoid console spam
      if (!window._lastVibrationSuccessLog || Date.now() - window._lastVibrationSuccessLog > 5000) {
        console.log(`[Vibration] ✅ ESP32-CAM vibration signal sent successfully!`);
        console.log(`[Vibration] ✅ Type: ${vibrationType}`);
        window._lastVibrationSuccessLog = Date.now();
      }
    } else {
      // Only log occasionally to avoid console spam
      if (!window._lastVibrationFailLog || Date.now() - window._lastVibrationFailLog > 10000) {
        console.warn(`[Vibration] ⚠️ ESP32-CAM vibration failed, trying fallback methods...`);
        console.warn(`[Vibration] 💡 Check: ESP32-CAM endpoint /vibrate must exist`);
        console.warn(`[Vibration] 💡 Check: ESP32-CAM must be connected to WiFi`);
        console.warn(`[Vibration] 💡 Check: DNS must be correct (esp32cam.local)`);
        window._lastVibrationFailLog = Date.now();
      }
    }
  }
  
  // Fallback: Try Web Vibration API (for mobile devices)
  let webVibrationSuccess = false;
  if (!esp32VibrationSuccess && vibrationState.useWebVibration) {
    webVibrationSuccess = vibrateWeb(vibrationPattern);
    if (webVibrationSuccess) {
      console.log(`[Vibration] ✅ Web Vibration API signal sent (${vibrationType}) - Fallback`);
    }
  }
  
  // Fallback: Try Serial Port (for external hardware)
  // For serial port, we send the first duration if it's a pattern
  let serialVibrationSuccess = false;
  if (!esp32VibrationSuccess && !webVibrationSuccess && vibrationState.useSerialPort) {
    const serialDuration = Array.isArray(vibrationPattern) ? vibrationPattern[0] : vibrationPattern;
    serialVibrationSuccess = await vibrateSerial(serialDuration);
    if (serialVibrationSuccess) {
      console.log(`[Vibration] ✅ Serial Port signal sent (${serialDuration}ms) - Fallback`);
    }
  }
  
  // Log final result
  if (!esp32VibrationSuccess && !webVibrationSuccess && !serialVibrationSuccess) {
    console.error(`[Vibration] ❌ No vibration method worked!`, {
      object: objectName,
      distance: distance.toFixed(1) + 'cm',
      esp32VibrationAvailable: vibrationState.useESP32Vibration,
      webVibrationAvailable: vibrationState.useWebVibration,
      serialPortAvailable: vibrationState.useSerialPort,
      esp32Url: getESP32VibrateURL(),
      note: 'Pastikan ESP32-CAM terhubung dan memiliki endpoint /vibrate untuk vibration motor'
    });
    console.error(`[Vibration] 💡 TROUBLESHOOTING:`);
    console.error(`[Vibration] 💡 1. Pastikan ESP32-CAM kode Arduino sudah di-upload dengan endpoint /vibrate`);
    console.error(`[Vibration] 💡 2. Pastikan ESP32-CAM terhubung ke WiFi yang sama`);
    console.error(`[Vibration] 💡 3. Test endpoint: http://esp32cam.local/vibrate?duration=500`);
    console.error(`[Vibration] 💡 4. Pastikan vibration motor terhubung ke GPIO 14 (MOTOR_R) dan GPIO 15 (MOTOR_L)`);
  } else {
    const method = esp32VibrationSuccess ? 'ESP32-CAM (Both Motors)' : 
                   webVibrationSuccess ? 'Web Vibration API (Mobile Device)' : 
                   'Serial Port';
    console.log(`[Vibration] ✅ Vibration signal successfully sent via ${method}!`);
    
    if (esp32VibrationSuccess) {
      console.log(`[Vibration] 📳 ESP32-CAM should now vibrate both motors (MOTOR_R + MOTOR_L)`);
      console.log(`[Vibration] 📳 Duration/Pattern: ${Array.isArray(vibrationPattern) ? vibrationPattern.join(',') : vibrationPattern}ms`);
    }
  }
}

/**
 * Check if any object is within vibration threshold
 * This function processes all detections and triggers vibration for closest object
 * Device akan bergetar ketika ada objek dengan jarak <= 150 cm (termasuk tepat 150 cm)
 * ESP32-CAM akan mengaktifkan kedua vibration motor secara bersamaan
 * @param {Array} detections - Array of detection objects {distance, className, ...}
 */
function checkAndTriggerVibration(detections) {
  // Check if vibration is enabled
  if (!vibrationState.isEnabled) {
    return;
  }
  
  // Check if detections exist
  if (!detections || detections.length === 0) {
    return;
  }
  
  // Filter detections within threshold (jarak <= 150 cm, termasuk tepat 150 cm)
  // Filter objek yang jaraknya <= 150 cm untuk trigger vibration
  const nearbyDetections = detections.filter(det => 
    typeof det.distance === 'number' && 
    !isNaN(det.distance) &&
    det.distance <= vibrationState.distanceThreshold
  );
  
  if (nearbyDetections.length === 0) {
    // No objects within threshold - no vibration needed
    return;
  }
  
  // Find closest object (objek terdekat)
  const closestDetection = nearbyDetections.reduce((closest, current) => {
    return current.distance < closest.distance ? current : closest;
  });
  
  // Log detection info
  console.log(`[Vibration] 🔍 Detected ${nearbyDetections.length} object(s) within ${vibrationState.distanceThreshold}cm`);
  console.log(`[Vibration] 🔍 Closest: ${closestDetection.className || 'object'} at ${closestDetection.distance.toFixed(1)}cm`);
  if (closestDetection.relativeX !== undefined) {
    console.log(`[Vibration] 🔍 Position: ${(closestDetection.relativeX * 100).toFixed(1)}% (0% = left, 100% = right)`);
  }
  
  // Trigger vibration for closest object with position information
  // Device akan bergetar ketika objek terdekat dalam jarak <= 150 cm
  // ESP32-CAM akan mengaktifkan vibration motor berdasarkan posisi objek (left/right/both)
  triggerVibration(closestDetection.distance, closestDetection.className || 'object', closestDetection);
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
  window.vibrateESP32 = vibrateESP32;
  window.vibrateESP32Pattern = vibrateESP32Pattern;
  window.testVibrationESP32 = async function() {
    // Quick test function for console
    console.log('[Vibration] 🔔 Testing ESP32-CAM vibration motor...');
    const result1 = await vibrateESP32(200);
    console.log('[Vibration] Test 1 (200ms):', result1 ? '✅ Success' : '❌ Failed');
    await new Promise(resolve => setTimeout(resolve, 1000));
    const result2 = await vibrateESP32Pattern([300, 400, 300, 400]);
    console.log('[Vibration] Test 2 (Pattern):', result2 ? '✅ Success' : '❌ Failed');
    return { test1: result1, test2: result2 };
  };
  window.setVibrationEnabled = setVibrationEnabled;
  window.setVibrationThreshold = setVibrationThreshold;
  window.getVibrationStatus = getVibrationStatus;
  window.triggerVibration = triggerVibration; // For testing
  window.vibrate = vibrate; // Simple vibration
  window.vibratePattern = vibratePattern; // Pattern vibration
  window.vibrateMario = vibrateMario; // Mario pattern vibration
  
  // Add comprehensive diagnostic function
  window.testVibrationDiagnostic = function() {
    console.log('📊 Vibration Diagnostic Report');
    console.log('================================');
    console.log('1. navigator.vibrate exists:', 'vibrate' in navigator);
    console.log('2. navigator object:', typeof navigator);
    console.log('3. User Agent:', navigator.userAgent);
    console.log('4. Secure Context:', typeof window !== 'undefined' && window.isSecureContext);
    console.log('5. Protocol:', window.location.protocol);
    console.log('6. Hostname:', window.location.hostname);
    console.log('7. Vibration State:', vibrationState);
    
    if ('vibrate' in navigator) {
      console.log('\n✅ navigator.vibrate is available!');
      console.log('💡 Try direct test: navigator.vibrate(200)');
      console.log('💡 Try: vibrate()');
      console.log('💡 Try: vibratePattern()');
      console.log('💡 Try: vibrateMario()');
      
      // Try direct test with multiple patterns
      console.log('\n📊 Testing multiple vibration patterns:');
      const testPatterns = [
        { name: 'Short (100ms)', pattern: 100 },
        { name: 'Medium (500ms)', pattern: 500 },
        { name: 'Long (2000ms)', pattern: 2000 }
      ];
      
      testPatterns.forEach((test, index) => {
        setTimeout(() => {
          try {
            const result = navigator.vibrate(test.pattern);
            console.log(`📊 Test ${index + 1} (${test.name}) result:`, result);
            if (result === false) {
              console.warn(`⚠️ Test ${index + 1} returned false - device may be in silent mode`);
            } else {
              console.log(`✅ Test ${index + 1} accepted!`);
            }
          } catch (error) {
            console.error(`❌ Test ${index + 1} error:`, error);
          }
        }, index * 2500); // Space out tests
      });
      
      console.log('\n💡 Troubleshooting Tips:');
      console.log('💡 1. Check if device is in Silent/Do Not Disturb mode');
      console.log('💡 2. Check system vibration settings (Android: Settings > Sound > Vibration)');
      console.log('💡 3. Ensure volume is not at 0 (some devices disable vibration when volume is 0)');
      console.log('💡 4. Try restarting browser');
      console.log('💡 5. Check browser vibration permission');
      console.log('💡 6. Try testVibrationLong() for longer, more noticeable vibration');
    } else {
      console.error('❌ navigator.vibrate NOT available');
      console.error('💡 Browser/device does not support Web Vibration API');
      console.error('💡 Solutions:');
      console.error('   - Use Chrome/Edge/Safari on mobile device');
      console.error('   - Update browser to latest version');
      console.error('   - Desktop browsers usually do not support');
    }
    console.log('================================');
  };
  
  console.log('[Vibration] 💡 Diagnostic function available: testVibrationDiagnostic()');
  console.log('[Vibration] 💡 Test long vibration: testVibrationLong()');
}

// Add function to test with longer vibration for better detection
if (typeof window !== 'undefined') {
  window.testVibrationLong = function() {
    console.log('[Vibration Test] 🔔 Testing with LONG vibration (2000ms)...');
    if ('vibrate' in navigator) {
      const result = navigator.vibrate(2000);
      console.log('[Vibration Test] 📊 Result:', result);
      if (result === false) {
        console.warn('[Vibration Test] ⚠️ Device mungkin dalam mode silent atau vibration disabled');
      } else {
        console.log('[Vibration Test] ✅ Command sent! Jika HP tidak bergetar, cek:');
        console.log('[Vibration Test] 💡 1. Mode Silent/Do Not Disturb');
        console.log('[Vibration Test] 💡 2. System vibration settings');
        console.log('[Vibration Test] 💡 3. Volume settings (beberapa HP matikan vibration jika volume 0)');
        console.log('[Vibration Test] 💡 4. Restart browser');
      }
    } else {
      console.error('[Vibration Test] ❌ navigator.vibrate not available');
    }
  };
}


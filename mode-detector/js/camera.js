/**
 * Camera Management
 * Handles webcam and ESP32-CAM streaming
 * Optimized for mobile devices (Android/iOS)
 */

// Camera state
const cameraState = {
  source: 'webcam', // 'webcam' or 'esp32'
  facingMode: 'user', // 'user' or 'environment'
  isStreamReady: false,
  stream: null,
  espEndpointMode: 'stream', // 'stream' or 'capture'
  espErrorCount: 0
};

/**
 * Detect if device is mobile
 * @returns {boolean} True if device is mobile
 */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

/**
 * Check if running in secure context (HTTPS or localhost)
 * getUserMedia requires secure context to work
 * @returns {boolean} True if secure context
 */
function isSecureContext() {
  // Check if window.isSecureContext is available (modern browsers)
  if (typeof window !== 'undefined' && window.isSecureContext !== undefined) {
    return window.isSecureContext;
  }
  
  // Fallback: check protocol
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  // HTTPS is secure
  if (protocol === 'https:') {
    return true;
  }
  
  // HTTP localhost/127.0.0.1 is considered secure for getUserMedia
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0')) {
    return true;
  }
  
  // file:// protocol is NOT secure
  if (protocol === 'file:') {
    return false;
  }
  
  // Default: not secure
  return false;
}

/**
 * Get getUserMedia function with fallback support
 * Handles both modern and legacy APIs
 * @returns {Function|null} getUserMedia function or null if not available
 */
function getGetUserMedia() {
  // Modern API (preferred)
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
  }
  
  // Legacy API fallback
  if (navigator.getUserMedia) {
    return (constraints) => {
      return new Promise((resolve, reject) => {
        navigator.getUserMedia(constraints, resolve, reject);
      });
    };
  }
  
  // Webkit prefix fallback (for older browsers)
  if (navigator.webkitGetUserMedia) {
    return (constraints) => {
      return new Promise((resolve, reject) => {
        navigator.webkitGetUserMedia(constraints, resolve, reject);
      });
    };
  }
  
  // Mozilla prefix fallback
  if (navigator.mozGetUserMedia) {
    return (constraints) => {
      return new Promise((resolve, reject) => {
        navigator.mozGetUserMedia(constraints, resolve, reject);
      });
    };
  }
  
  return null;
}

// ESP32 Configuration
// Update DNS sesuai ESP32-CAM Anda
const ESP32_DNS = 'esp32cam.local';
// Fallback IP address jika DNS tidak bekerja (khusus Windows desktop)
// Cara menemukan IP ESP32-CAM:
// 1. Buka Serial Monitor di Arduino IDE (115200 baud) - akan menampilkan IP
// 2. Atau cek di router WiFi Anda
// 3. Atau gunakan aplikasi network scanner
const ESP32_IP = null; // Set ke IP ESP32-CAM Anda, contoh: '192.168.1.100'
// Make ESP32_DNS globally available for vibration.js
if (typeof window !== 'undefined') {
  window.ESP32_DNS = ESP32_DNS;
  window.ESP32_IP = ESP32_IP; // Make IP available too
}
// Helper function untuk mendapatkan base URL ESP32-CAM
// Mencoba IP address terlebih dahulu jika tersedia (lebih reliable di Windows)
// Fallback ke DNS jika IP tidak tersedia
function getESP32BaseURL() {
  if (ESP32_IP) {
    return `http://${ESP32_IP}`;
  }
  return `http://${ESP32_DNS}`;
}

// ESP32-S3 CAM biasanya menggunakan endpoint langsung
// Jika menggunakan proxy server, ganti dengan URL proxy Anda
const ESP32_STREAM_URL = `${getESP32BaseURL()}:81/stream`;  // Port 81 untuk stream
const ESP32_CAPTURE_URL = `${getESP32BaseURL()}/capture`;   // Port 80 untuk capture
// Fallback jika proxy digunakan (ganti dengan URL proxy jika ada)
const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;

// ESP32 LED/flash control endpoints (common ESP32-CAM implementations)
// Different ESP32-CAM firmware may use different endpoints
const ESP32_LED_OFF_URL = `${getESP32BaseURL()}/led?params=0`;  // Turn off flash LED
const ESP32_LED_ON_URL = `${getESP32BaseURL()}/led?params=255`;  // Turn on flash LED
// Alternative endpoints (uncomment if above doesn't work):
// const ESP32_LED_OFF_URL = `http://${ESP32_DNS}/ledoff`;
// const ESP32_LED_OFF_URL = `http://${ESP32_DNS}/led/off`;
// const ESP32_LED_ON_URL = `http://${ESP32_DNS}/ledon`;
// const ESP32_LED_ON_URL = `http://${ESP32_DNS}/led/on`;

// ESP32 buffer for offscreen canvas
let espBufferCanvas = null;
let espBufferHasFrame = false;
let espPollingTimer = null;
let espStreamReader = null; // For MJPEG stream reading
let espStreamAbortController = null; // For aborting stream requests

/**
 * Disable ESP32-CAM flash LED
 * Tries multiple common endpoints for different ESP32-CAM firmware versions
 */
async function disableESP32Flash() {
  const baseURL = getESP32BaseURL();
  const endpoints = [
    `${baseURL}/led?params=0`,
    `${baseURL}/ledoff`,
    `${baseURL}/led/off`,
    `${baseURL}/control?var=led_intensity&val=0`,
    `${baseURL}/?led=off`
  ];
  
  console.log('[ESP32-CAM] 💡 Attempting to disable flash LED...');
  
  // Try all endpoints (some ESP32-CAM firmware may use different endpoints)
  const promises = endpoints.map(endpoint => {
    return fetch(endpoint, { 
      method: 'GET',
      mode: 'no-cors', // Avoid CORS issues
      cache: 'no-cache'
    }).catch(err => {
      // Ignore errors - endpoint might not exist
      return null;
    });
  });
  
  // Try parallel requests (no-cors mode won't throw errors even if endpoint doesn't exist)
  try {
    await Promise.all(promises);
    console.log('[ESP32-CAM] 💡 Flash LED disable command sent');
  } catch (error) {
    // Ignore errors - some endpoints may not exist depending on firmware
    console.log('[ESP32-CAM] 💡 Flash LED disable attempted (some endpoints may not exist)');
  }
}

/**
 * Initialize webcam
 * Optimized for mobile devices - handles camera permissions and constraints properly
 */
async function initWebcam() {
  if (cameraState.source !== 'webcam') return;

  const video = document.getElementById('video-element');
  if (!video) return;

  try {
    // Detect mobile device
    const isMobile = isMobileDevice();
    const loadingMsg = isMobile ? 'Meminta izin akses kamera...' : 'Memulai webcam...';
    showLoading(loadingMsg);
    hideError();
    cameraState.isStreamReady = false;
    
    // Update status
    if (typeof updateStatusIndicators === 'function') {
      updateStatusIndicators();
    }

    // Stop existing stream
    if (cameraState.stream) {
      cameraState.stream.getTracks().forEach(track => track.stop());
      cameraState.stream = null;
    }

    // Check secure context first (required for getUserMedia)
    const isSecure = isSecureContext();
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    
    console.log(`[Camera] 🔒 Secure context: ${isSecure ? 'Yes' : 'No'}`);
    console.log(`[Camera] 🌐 Protocol: ${protocol}`);
    console.log(`[Camera] 🌐 Hostname: ${hostname}`);
    
    if (!isSecure) {
      const errorMsg = isMobile
        ? `❌ Akses kamera memerlukan HTTPS atau localhost!\n\n📱 Untuk mobile:\n1. Gunakan HTTPS\n2. Atau akses dari komputer ke: http://localhost:8000\n3. Atau gunakan IP komputer: http://[IP_KOMPUTER]:8000\n\n💡 Pastikan aplikasi di-host via HTTP server, bukan file://`
        : `❌ Akses kamera memerlukan HTTPS atau localhost!\n\nGunakan:\n- http://localhost:8000\n- http://127.0.0.1:8000\n- Atau HTTPS\n\n💡 Pastikan aplikasi di-host via HTTP server, bukan file://`;
      throw new Error(errorMsg);
    }
    
    // Get getUserMedia function (with fallback support)
    const getUserMedia = getGetUserMedia();
    if (!getUserMedia) {
      const browserInfo = navigator.userAgent;
      const errorMsg = isMobile
        ? `❌ Browser tidak mendukung akses kamera!\n\n📱 Gunakan:\n- Chrome (Android/iOS)\n- Edge (Android/iOS)\n- Safari (iOS)\n\n💡 Browser Anda: ${browserInfo.substring(0, 50)}...`
        : `❌ Browser tidak mendukung akses kamera. Gunakan browser modern (Chrome/Edge/Firefox/Safari).`;
      throw new Error(errorMsg);
    }

    // Request webcam access with mobile-optimized constraints
    // Mobile devices may have different camera capabilities
    const constraints = {
      video: {
        facingMode: cameraState.facingMode,
        // For mobile: use more flexible constraints
        width: isMobile ? { ideal: 640, max: 1280 } : { ideal: 1280 },
        height: isMobile ? { ideal: 480, max: 720 } : { ideal: 720 }
      },
      audio: false
    };

    console.log(`[Camera] 📱 Mobile device: ${isMobile ? 'Yes' : 'No'}`);
    console.log(`[Camera] 📷 Requesting camera access with constraints:`, constraints);

    // Request camera permission (using fallback-safe getUserMedia)
    cameraState.stream = await getUserMedia(constraints);
    
    // Set video element properties for mobile
    video.setAttribute('playsinline', 'true'); // Important for iOS
    video.setAttribute('webkit-playsinline', 'true'); // For older iOS
    video.muted = true; // Required for autoplay on mobile
    
    video.srcObject = cameraState.stream;
    
    // For mobile, we need to explicitly play after setting srcObject
    let playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        console.log('[Camera] ✅ Video play successful');
      }).catch((playError) => {
        console.warn('[Camera] ⚠️ Auto-play failed, waiting for user interaction:', playError);
        // On mobile, sometimes autoplay is blocked - user interaction needed
        if (isMobile) {
          showError('📱 Tekan layar untuk memulai kamera');
          
          // Add click/touch listener to start video on user interaction
          const startVideoOnInteraction = async () => {
            try {
              await video.play();
              console.log('[Camera] ✅ Video started after user interaction');
              hideError();
              // Remove listener after successful start
              document.removeEventListener('click', startVideoOnInteraction);
              document.removeEventListener('touchstart', startVideoOnInteraction);
            } catch (err) {
              console.error('[Camera] ❌ Failed to start video after interaction:', err);
            }
          };
          
          // Listen for both click and touch events (mobile)
          document.addEventListener('click', startVideoOnInteraction, { once: true });
          document.addEventListener('touchstart', startVideoOnInteraction, { once: true });
        }
      });
    }

    video.onloadedmetadata = () => {
      console.log('✅ Webcam ready!');
      console.log('📱 Mobile device:', isMobileDevice() ? 'Yes' : 'No');
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
      console.log('Camera facing mode:', cameraState.facingMode);
      
      cameraState.isStreamReady = true;
      hideLoading();
      setCanvasSize(video.videoWidth, video.videoHeight);
      video.style.display = 'block';
      const esp32Img = document.getElementById('esp32-img');
      if (esp32Img) {
        esp32Img.style.display = 'none';
      }
      
      // Auto-start live detection when camera is ready
      // Live detection should always be active
      if (typeof startLiveDetection === 'function') {
        startLiveDetection();
      }
    };

    video.onerror = (error) => {
      console.error('[Camera] ❌ Webcam error:', error);
      cameraState.isStreamReady = false;
      const errorMsg = isMobileDevice() 
        ? '❌ Error kamera mobile. Pastikan izin kamera sudah diberikan dan kamera tidak digunakan aplikasi lain.'
        : 'Webcam error occurred';
      showError(errorMsg);
      hideLoading();
    };

  } catch (error) {
    console.error('[Camera] ❌ Error accessing webcam:', error);
    console.error('[Camera] ❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    cameraState.isStreamReady = false;
    
    // Enhanced error messages for mobile
    let errorMessage = getErrorMessage(error);
    
    // Check if it's a secure context error
    if (error.message && (error.message.includes('HTTPS') || error.message.includes('localhost') || error.message.includes('secure'))) {
      errorMessage = error.message; // Use the detailed error message we created
    } else if (isMobileDevice()) {
      if (error.name === 'NotAllowedError') {
        errorMessage = '❌ Akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser/HP Anda.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = '❌ Kamera tidak ditemukan. Pastikan kamera HP Anda aktif dan tidak digunakan aplikasi lain.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = '❌ Kamera tidak dapat dibaca. Tutup aplikasi lain yang menggunakan kamera dan coba lagi.';
      } else if (error.message.includes('getUserMedia tidak tersedia')) {
        errorMessage = error.message; // Use the detailed error message
      }
    }
    
    showError(errorMessage);
    hideLoading();
  }
}

/**
 * Stop ESP32 stream reading
 */
function stopESP32Stream() {
  // Abort any ongoing stream requests
  if (espStreamAbortController) {
    espStreamAbortController.abort();
    espStreamAbortController = null;
  }
  
  // Close reader if exists
  if (espStreamReader) {
    espStreamReader.cancel();
    espStreamReader = null;
  }
  
  // Clear polling timer
  if (espPollingTimer) {
    clearTimeout(espPollingTimer);
    espPollingTimer = null;
  }
}

/**
 * Test ESP32-CAM connection before loading stream
 * This helps with mDNS resolution on mobile devices
 * @param {string} url - URL to test
 * @returns {Promise<boolean>} True if connection successful
 */
async function testESP32Connection(url) {
  return new Promise((resolve) => {
    const testImg = new Image();
    let resolved = false;
    
    // Set timeout for mobile (mDNS may take longer)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`[ESP32-CAM] ⏱️ Connection test timeout for: ${url}`);
        resolve(false);
      }
    }, 10000); // 10 seconds timeout for mobile mDNS resolution
    
    testImg.onload = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[ESP32-CAM] ✅ Connection test successful: ${url}`);
        resolve(true);
      }
    };
    
    testImg.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`[ESP32-CAM] ❌ Connection test failed: ${url}`);
        resolve(false);
      }
    };
    
    // Set crossOrigin for CORS
    testImg.crossOrigin = 'anonymous';
    
    // Try to load test image (small endpoint first)
    testImg.src = url + '?t=' + Date.now();
  });
}

/**
 * Read MJPEG stream from ESP32-CAM
 * Uses simpler approach: directly set img.src to stream URL
 * Browser will handle MJPEG stream automatically if supported
 * Falls back to fast polling if direct stream doesn't work
 * Enhanced for mobile devices with better mDNS resolution handling
 */
function readMJPEGStream() {
  const img = document.getElementById('esp32-img');
  if (!img) return;
  
  // Stop any existing stream first
  stopESP32Stream();
  
  // Set crossOrigin attribute for mobile browsers
  // This helps with CORS issues on mobile
  img.crossOrigin = 'anonymous';
  
  console.log(`[ESP32-CAM] 📡 Starting MJPEG stream from: ${ESP32_STREAM_URL}`);
  
  const isMobile = isMobileDevice();
  if (isMobile) {
    console.log(`[ESP32-CAM] 📱 Mobile device detected - using enhanced connection method`);
    console.log(`[ESP32-CAM] 💡 Testing connection first (mDNS may take time on mobile)...`);
    
    // Test connection first on mobile (mDNS resolution can be slow)
    testESP32Connection(ESP32_STREAM_URL).then((connected) => {
      if (connected) {
        console.log(`[ESP32-CAM] ✅ Connection test passed, starting stream...`);
        startStream();
      } else {
        console.warn(`[ESP32-CAM] ⚠️ Connection test failed, trying anyway (may still work)...`);
        // Try anyway - sometimes test fails but stream works
        startStream();
      }
    }).catch((error) => {
      console.error(`[ESP32-CAM] ❌ Connection test error:`, error);
      console.warn(`[ESP32-CAM] ⚠️ Proceeding with stream anyway...`);
      startStream();
    });
  } else {
    // Desktop: start immediately
    startStream();
  }
  
  function startStream() {
    // Method 1: Try direct img.src approach (works in most browsers)
    // For MJPEG stream, browser should handle it automatically
    let streamStartTime = Date.now();
    let frameCount = 0;
    let lastFrameTime = 0;
    
    // Setup image load handler
    img.onload = () => {
      const now = Date.now();
      const timeSinceLastFrame = now - lastFrameTime;
      lastFrameTime = now;
      frameCount++;
      
      // Set ready state on first successful load
      // Also check if img has valid dimensions to ensure it's actually loaded
      if (!cameraState.isStreamReady && img.naturalWidth > 0 && img.naturalHeight > 0) {
        cameraState.isStreamReady = true;
        hideLoading();
        hideError();
        cameraState.espErrorCount = 0;
        
        console.log(`[ESP32-CAM] ✅ Stream connected successfully`);
        console.log(`[ESP32-CAM] 📐 Frame dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
        console.log(`[ESP32-CAM] ✅ Camera ready for detection`);
        
        if (typeof updateStatusIndicators === 'function') {
          updateStatusIndicators();
        }
        
        // Auto-start live detection
        if (typeof startLiveDetection === 'function') {
          startLiveDetection();
        }
      }
      
      // Update buffer
      if (img.naturalWidth && img.naturalHeight) {
        if (!espBufferCanvas) {
          espBufferCanvas = document.createElement('canvas');
        }
        espBufferCanvas.width = img.naturalWidth;
        espBufferCanvas.height = img.naturalHeight;
        const ctx = espBufferCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          espBufferHasFrame = true;
        }
        
        // Also ensure isStreamReady is set if we have valid frame data
        // This handles cases where onload might have fired but ready state wasn't set
        if (!cameraState.isStreamReady) {
          cameraState.isStreamReady = true;
          console.log(`[ESP32-CAM] ✅ Camera ready (set from frame data)`);
          if (typeof updateStatusIndicators === 'function') {
            updateStatusIndicators();
          }
          if (typeof startLiveDetection === 'function') {
            startLiveDetection();
          }
        }
      }
      
      setCanvasSize(img.naturalWidth || 640, img.naturalHeight || 480);
      img.style.display = 'block';
      document.getElementById('video-element').style.display = 'none';

      // Log frame rate occasionally
      if (frameCount % 30 === 0) {
        const fps = timeSinceLastFrame > 0 ? (1000 / timeSinceLastFrame).toFixed(1) : 'N/A';
        console.log(`[ESP32-CAM] 📊 Stream running: ${frameCount} frames, ~${fps} FPS`);
      }
    };
    
    img.onerror = () => {
      console.error(`[ESP32-CAM] ❌ Stream frame error`);
      cameraState.espErrorCount += 1;
      
      // If stream doesn't work after 3 errors, try alternative method
      if (cameraState.espErrorCount >= 3 && !img.dataset.streamMethod) {
        console.warn(`[ESP32-CAM] ⚠️ Direct stream failed, trying alternative method...`);
        img.dataset.streamMethod = 'polling';
        // Switch to fast polling method
        startStreamPolling();
        return;
      }
      
      // If still failing, fallback to capture mode
      if (cameraState.espErrorCount >= 10) {
        console.warn(`[ESP32-CAM] ⚠️ Stream failed repeatedly, switching to capture mode`);
        cameraState.espEndpointMode = 'capture';
        updateESP32Buttons();
        initCamera();
        return;
      }
      
      const errorMsg = `ESP32-CAM stream error (${cameraState.espErrorCount}/10). Retrying...`;
      showError(errorMsg);
    };
    
    // Keep track of last flash disable time for stream mode
    let streamFlashDisableTime = 0;
    const STREAM_FLASH_DISABLE_INTERVAL = 10000; // Disable flash every 10 seconds in stream mode
    
    // Set stream URL directly - browser should handle MJPEG automatically
    // Add timestamp only once to establish connection, then let stream continue
    const streamUrl = `${ESP32_STREAM_URL}?t=${Date.now()}`;
    console.log(`[ESP32-CAM] 📡 Setting stream URL: ${streamUrl}`);
    console.log(`[ESP32-CAM] 📡 Image crossOrigin: ${img.crossOrigin || 'not set'}`);
    img.src = streamUrl;
    
    // Periodically disable flash in stream mode
    const streamFlashInterval = setInterval(() => {
      if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
        clearInterval(streamFlashInterval);
        return;
      }
      disableESP32Flash();
    }, STREAM_FLASH_DISABLE_INTERVAL);
    
    // Monitor if stream is working (check if frames are updating)
    const streamMonitor = setInterval(() => {
      if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
        clearInterval(streamMonitor);
        clearInterval(streamFlashInterval);
        return;
      }

      // If no frames received in 5 seconds, try alternative method
      if (frameCount === 0 && Date.now() - streamStartTime > 5000) {
        console.warn(`[ESP32-CAM] ⚠️ No frames received, trying alternative method...`);
        clearInterval(streamMonitor);
        clearInterval(streamFlashInterval);
        img.dataset.streamMethod = 'polling';
        startStreamPolling();
      }
    }, 1000);
  }
  
  // Alternative: Fast polling method if direct stream doesn't work
  function startStreamPolling() {
    console.log(`[ESP32-CAM] 📡 Using fast polling method for stream`);
    
    let pollingFlashDisableTime = 0;
    const STREAM_FLASH_DISABLE_INTERVAL = 10000; // Re-declare for polling function
    let lastPollFrameTime = Date.now();
    
    // Setup image load handler for polling method
    img.onload = () => {
      const now = Date.now();
      const timeSinceLastFrame = now - lastPollFrameTime;
      lastPollFrameTime = now;
      frameCount++; // Increment frame count for polling method too
      
      // Update buffer when frame loads
      if (img.naturalWidth && img.naturalHeight) {
        if (!espBufferCanvas) {
          espBufferCanvas = document.createElement('canvas');
        }
        espBufferCanvas.width = img.naturalWidth;
        espBufferCanvas.height = img.naturalHeight;
        const ctx = espBufferCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          espBufferHasFrame = true;
        }
        
        // Ensure isStreamReady is set
        if (!cameraState.isStreamReady) {
          cameraState.isStreamReady = true;
          console.log(`[ESP32-CAM] ✅ Camera ready (polling method)`);
          if (typeof updateStatusIndicators === 'function') {
            updateStatusIndicators();
          }
          if (typeof startLiveDetection === 'function') {
            startLiveDetection();
          }
        }
        
        // Log frame rate occasionally
        if (frameCount % 30 === 0) {
          const fps = timeSinceLastFrame > 0 ? (1000 / timeSinceLastFrame).toFixed(1) : 'N/A';
          console.log(`[ESP32-CAM] 📊 Polling stream: ${frameCount} frames, ~${fps} FPS`);
        }
      }
      
      setCanvasSize(img.naturalWidth || 640, img.naturalHeight || 480);
      img.style.display = 'block';
      document.getElementById('video-element').style.display = 'none';
    };
    
    img.onerror = () => {
      console.warn(`[ESP32-CAM] ⚠️ Frame error in polling method`);
      cameraState.espErrorCount += 1;
      
      // Auto fallback to capture mode after 3 errors
      if (cameraState.espErrorCount >= 3 && cameraState.espEndpointMode === 'stream') {
        console.warn('⚠️ Switching ESP32-CAM to capture mode (polling failed)');
        cameraState.espEndpointMode = 'capture';
        if (typeof updateESP32Buttons === 'function') {
          updateESP32Buttons();
        }
        initESP32(); // Reinitialize with capture mode
        return;
      }
    };
    
    function pollFrame() {
      if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
        return; // Stop if switched away
      }
      
      // Periodically disable flash during polling
      const now = Date.now();
      if (now - pollingFlashDisableTime > STREAM_FLASH_DISABLE_INTERVAL) {
        disableESP32Flash();
        pollingFlashDisableTime = now;
      }
      
      // Fast polling: request new frame every 50-100ms
      const timestamp = Date.now();
      const url = `${ESP32_STREAM_URL}?t=${timestamp}&frame=${Date.now()}`;
      img.src = url;
      
      // Schedule next poll
      espPollingTimer = setTimeout(pollFrame, 70);
    }
    
    pollFrame();
  }
}

/**
 * Initialize ESP32-CAM
 * Supports ESP32-CAM dengan konfigurasi DNS dan endpoint
 * Uses different methods for stream vs capture mode
 * Optimized for mobile devices - handles network connectivity and CORS
 */
function initESP32() {
  if (cameraState.source === 'webcam') return;

  const img = document.getElementById('esp32-img');
  if (!img) return;

  // Create offscreen buffer if not exists
  if (!espBufferCanvas) {
    espBufferCanvas = document.createElement('canvas');
  }

  // Detect mobile device
  const isMobile = isMobileDevice();
  const loadingMsg = isMobile 
    ? `Menghubungkan ke ESP32-CAM dari HP (${ESP32_DNS})...`
    : `Menghubungkan ke ESP32-CAM (${ESP32_DNS})...`;
  
  showLoading(loadingMsg);
  cameraState.isStreamReady = false; // Set to false initially, will be true when frame loads
  cameraState.espErrorCount = 0;
  
  console.log(`[ESP32-CAM] 🔌 Initializing ESP32-CAM connection...`);
  console.log(`[ESP32-CAM] 📱 Mobile device: ${isMobile ? 'Yes' : 'No'}`);
  console.log(`[ESP32-CAM] 📡 DNS: ${ESP32_DNS}`);
  if (ESP32_IP) {
    console.log(`[ESP32-CAM] 📡 IP Address: ${ESP32_IP} (using IP instead of DNS)`);
  } else {
    console.log(`[ESP32-CAM] ⚠️ IP Address: Not set - using DNS only`);
    console.log(`[ESP32-CAM] 💡 TIP: Set ESP32_IP in camera.js if DNS doesn't work (common on Windows)`);
  }
  console.log(`[ESP32-CAM] 📡 Stream URL: ${ESP32_STREAM_URL}`);
  console.log(`[ESP32-CAM] 📡 Capture URL: ${ESP32_CAPTURE_URL}`);
  console.log(`[ESP32-CAM] 📡 Mode: ${cameraState.espEndpointMode}`);
  
  // Mobile-specific tips
  if (isMobile) {
    console.log(`[ESP32-CAM] 💡 TIPS untuk mobile:`);
    console.log(`[ESP32-CAM] 💡 - Pastikan HP dan ESP32 di WiFi yang sama`);
    console.log(`[ESP32-CAM] 💡 - Pastikan DNS ESP32 benar: ${ESP32_DNS}`);
    console.log(`[ESP32-CAM] 💡 - Jika tidak connect, coba mode Capture (lebih stabil)`);
  }
  
  // Disable flash LED immediately when initializing ESP32-CAM
  disableESP32Flash();
  
  // Update status
  if (typeof updateStatusIndicators === 'function') {
    updateStatusIndicators();
  }

  // Use different approach for stream vs capture mode
  if (cameraState.espEndpointMode === 'stream') {
    // Use MJPEG stream reader for stream mode
    readMJPEGStream();
    return;
  }
  
  // Capture mode: use simple polling with img.src
  // Reset handlers for capture mode
  img.onload = null;
  img.onerror = null;
  
  // Set crossOrigin attribute for mobile browsers
  // This helps with CORS issues on mobile
  img.crossOrigin = 'anonymous';
  
  // Keep track of last flash disable time
  let lastFlashDisableTime = 0;
  const FLASH_DISABLE_INTERVAL = 5000; // Disable flash every 5 seconds to prevent it from turning on
  
  // For mobile: test connection first before starting capture polling
  // Use isMobile from function scope (already declared at top of initESP32)
  if (isMobile) {
    console.log(`[ESP32-CAM] 📱 Mobile device - testing connection before capture mode...`);
    testESP32Connection(ESP32_CAPTURE_URL).then((connected) => {
      if (connected) {
        console.log(`[ESP32-CAM] ✅ Connection test passed, starting capture polling...`);
        startCapturePolling();
      } else {
        console.warn(`[ESP32-CAM] ⚠️ Connection test failed, trying anyway...`);
        // Try anyway - sometimes test fails but capture works
        startCapturePolling();
      }
    }).catch((error) => {
      console.error(`[ESP32-CAM] ❌ Connection test error:`, error);
      console.warn(`[ESP32-CAM] ⚠️ Proceeding with capture polling anyway...`);
      startCapturePolling();
    });
  } else {
    // Desktop: start immediately
    startCapturePolling();
  }
  
  function startCapturePolling() {
    function setNextSrc() {
      if (!img) return;
      
      // Periodically disable flash to prevent it from turning on automatically
      // This is especially important in capture mode where each capture might trigger flash
      const now = Date.now();
      if (now - lastFlashDisableTime > FLASH_DISABLE_INTERVAL) {
        disableESP32Flash();
        lastFlashDisableTime = now;
      }
      
      // Gunakan URL langsung ke ESP32-CAM untuk capture mode
      // Tambahkan timestamp untuk menghindari cache browser
      const timestamp = Date.now();
      const url = `${ESP32_CAPTURE_URL}?t=${timestamp}`;
      
      console.log(`[ESP32-CAM] 📡 Fetching frame: ${url}`);
      console.log(`[ESP32-CAM] 📡 Image crossOrigin: ${img.crossOrigin || 'not set'}`);
      img.src = url;
    }
    
    // Start first frame immediately
    setNextSrc();
    
    img.onload = () => {
    console.log(`[ESP32-CAM] ✅ Frame loaded successfully`);
    console.log(`[ESP32-CAM] 📐 Frame dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
    
    // Set ready on first successful load with valid dimensions
    // Check dimensions to ensure frame is actually loaded
    if (!cameraState.isStreamReady && img.naturalWidth > 0 && img.naturalHeight > 0) {
      cameraState.isStreamReady = true;
      hideLoading();
      hideError();
      
      console.log(`[ESP32-CAM] ✅ Camera ready for detection`);
      
      // Update status indicators if function exists
      if (typeof updateStatusIndicators === 'function') {
        updateStatusIndicators();
      }
    }

    // Update buffer immediately when new frame arrives
    // This ensures buffer always has latest frame for detection
    if (img.naturalWidth && img.naturalHeight) {
      // Ensure buffer canvas exists
      if (!espBufferCanvas) {
        espBufferCanvas = document.createElement('canvas');
      }
      
      espBufferCanvas.width = img.naturalWidth;
      espBufferCanvas.height = img.naturalHeight;
      const ctx = espBufferCanvas.getContext('2d');
      if (ctx) {
        // Copy latest frame to buffer for fallback use
        ctx.drawImage(img, 0, 0);
        espBufferHasFrame = true;
        console.log(`📸 Buffer updated: ${espBufferCanvas.width}x${espBufferCanvas.height}`);
      }
      
      // Also ensure isStreamReady is set if we have valid frame data
      // This handles cases where ready state might not have been set properly
      if (!cameraState.isStreamReady) {
        cameraState.isStreamReady = true;
        console.log(`[ESP32-CAM] ✅ Camera ready (set from frame data)`);
        hideLoading();
        hideError();
        if (typeof updateStatusIndicators === 'function') {
          updateStatusIndicators();
        }
      }
    }

    setCanvasSize(img.naturalWidth || 640, img.naturalHeight || 480);
    img.style.display = 'block';
    document.getElementById('video-element').style.display = 'none';

    // Auto-start live detection when ESP32 camera is ready
    // Live detection should always be active
    if (typeof startLiveDetection === 'function' && cameraState.isStreamReady) {
      startLiveDetection();
    }

      // Schedule next frame
      // Use slightly longer delay to ensure frame is fully processed
      const delay = cameraState.espEndpointMode === 'stream' ? 70 : 180;
      if (espPollingTimer) clearTimeout(espPollingTimer);
      espPollingTimer = setTimeout(setNextSrc, delay);
    };

    img.onerror = () => {
      const errorUrl = cameraState.espEndpointMode === 'stream' ? ESP32_STREAM_URL : ESP32_CAPTURE_URL;
      // Use isMobile from function scope (already declared at top of initESP32)
      
      console.error(`[ESP32-CAM] ❌ Frame error`);
      console.error(`[ESP32-CAM] ❌ Failed to load from: ${errorUrl}`);
      console.error(`[ESP32-CAM] 📡 DNS: ${ESP32_DNS}`);
      console.error(`[ESP32-CAM] 📡 Mode: ${cameraState.espEndpointMode}`);
      console.error(`[ESP32-CAM] 📱 Mobile device: ${isMobile ? 'Yes' : 'No'}`);
      
      cameraState.espErrorCount += 1;

      // Auto fallback to capture mode after 3 errors in stream mode
      if (cameraState.espEndpointMode === 'stream' && cameraState.espErrorCount >= 3) {
        console.warn('⚠️ Switching ESP32-CAM to capture mode (stream failed)');
        cameraState.espEndpointMode = 'capture';
        updateESP32Buttons();
      }

      // Enhanced error messages for mobile
      let errorMsg;
      if (isMobile) {
        if (cameraState.espErrorCount <= 3) {
          errorMsg = `ESP32-CAM tidak connect (${cameraState.espErrorCount}/3). Pastikan HP dan ESP32 di WiFi yang sama. Retrying...`;
        } else {
          errorMsg = `ESP32-CAM tidak bisa diakses. Periksa:\n1. HP dan ESP32 di WiFi yang sama\n2. DNS ESP32 benar: ${ESP32_DNS}\n3. ESP32 sudah running\n4. Coba mode Capture`;
        }
      } else {
        // Desktop error message
        if (cameraState.espErrorCount <= 3) {
          errorMsg = `ESP32-CAM connection failed (${cameraState.espErrorCount}/3). Retrying...`;
        } else {
          let troubleshooting = `ESP32-CAM connection failed.\n\n`;
          troubleshooting += `TROUBLESHOOTING:\n\n`;
          troubleshooting += `1. Check DNS: ${ESP32_DNS}\n`;
          if (!ESP32_IP) {
            troubleshooting += `2. ⚠️ IP Address not set!\n`;
            troubleshooting += `   → Set ESP32_IP in camera.js (line ~103)\n`;
            troubleshooting += `   → Find IP in Serial Monitor or router\n`;
            troubleshooting += `   → Example: const ESP32_IP = '192.168.1.100';\n`;
          } else {
            troubleshooting += `2. IP Address: ${ESP32_IP}\n`;
          }
          troubleshooting += `3. Ensure ESP32-CAM is connected to same WiFi\n`;
          troubleshooting += `4. Check if ESP32-CAM is running\n`;
          troubleshooting += `5. Test in browser: ${ESP32_CAPTURE_URL}`;
          errorMsg = troubleshooting;
        }
      }
      
      showError(errorMsg);
      
      const delay = cameraState.espEndpointMode === 'stream' ? 350 : 500;
      if (espPollingTimer) clearTimeout(espPollingTimer);
      espPollingTimer = setTimeout(setNextSrc, delay);
    };
  }
}

/**
 * Initialize camera based on current source
 * Note: Live detection will auto-start when camera becomes ready
 */
function initCamera() {
  // Don't stop live detection - it will restart automatically when camera is ready
  // Live detection should always be active
  if (cameraState.source === 'webcam') {
    initWebcam();
  } else {
    initESP32();
  }
}

/**
 * Switch camera (front/back for webcam)
 * Works well on mobile devices - switches between front and back camera
 */
function switchCamera() {
  if (cameraState.source === 'webcam') {
    const oldMode = cameraState.facingMode;
    cameraState.facingMode = cameraState.facingMode === 'user' ? 'environment' : 'user';
    const newMode = cameraState.facingMode === 'user' ? 'Depan' : 'Belakang';
    console.log(`[Camera] 🔄 Switching camera from ${oldMode} to ${cameraState.facingMode} (${newMode})`);
    console.log(`[Camera] 📱 Mobile device: ${isMobileDevice() ? 'Yes' : 'No'}`);
    initCamera();
  } else {
    console.log(`[Camera] ⚠️ Switch camera hanya untuk webcam mode`);
  }
}

/**
 * Set camera source
 * @param {string} source - 'webcam' or 'esp32'
 */
function setCameraSource(source) {
  if (source === cameraState.source) {
    console.log(`[Camera] Source already set to: ${source}`);
    return;
  }

  console.log(`[Camera] 🔄 Switching camera source from ${cameraState.source} to ${source}`);
  cameraState.source = source;
  updateCameraButtons();

  // Update focal length calibration for the newly selected camera
  if (typeof window !== 'undefined' && typeof window.updateFocalLengthForCamera === 'function') {
    window.updateFocalLengthForCamera(source, true);
  }
  
  // If switching to ESP32-CAM, log the DNS
  if (source === 'esp32') {
    console.log(`[Camera] 📡 Switching to ESP32-CAM at DNS: ${ESP32_DNS}`);
  }
  
  initCamera();
}

/**
 * Set ESP32 endpoint mode
 * @param {string} mode - 'stream' or 'capture'
 */
function setESP32Mode(mode) {
  if (mode === cameraState.espEndpointMode) return;

  cameraState.espEndpointMode = mode;
  cameraState.espErrorCount = 0;
  updateESP32Buttons();
  
  if (cameraState.source === 'esp32') {
    initCamera();
  }
}

/**
 * Check if ESP32 frame is ready for detection
 * @returns {boolean} True if frame is available
 */
function isESP32FrameReady() {
  if (cameraState.source === 'webcam') return true;

  // First check if camera state says it's ready
  if (!cameraState.isStreamReady) {
    return false;
  }

  const img = document.getElementById('esp32-img');
  
  // Check if img element has a valid frame (most reliable)
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return true;
  }
  
  // Fallback: check buffer (if img element not ready yet, buffer might have frame)
  if (espBufferHasFrame && espBufferCanvas &&
      espBufferCanvas.width > 0 && espBufferCanvas.height > 0) {
    return true;
  }
  
  // If state says ready but no frame yet, wait a bit more
  // This handles timing issues where state is ready but frame is still loading
  // Return false to wait for frame, but don't block detection loop for too long
  return false;
}

/**
 * Capture frame from camera
 * @returns {CanvasRenderingContext2D|null} Canvas context or null
 */
function captureFrame() {
  const canvas = document.getElementById('canvas-overlay');
  if (!canvas) {
    console.warn('❌ Canvas element not found');
    return null;
  }

  // Validate canvas dimensions
  if (canvas.width === 0 || canvas.height === 0) {
    console.warn('❌ Canvas has zero dimensions:', canvas.width, 'x', canvas.height);
    console.warn('Canvas may not be initialized. Waiting for camera to set canvas size...');
    return null;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    console.error('❌ Failed to get canvas context');
    return null;
  }

  if (cameraState.source !== 'webcam') {
    // ESP32 mode: try to get frame from img element first (always latest)
    // Fallback to buffer if img element is not ready
    const img = document.getElementById('esp32-img');
    
    // Method 1: Try to capture directly from img element (most up-to-date)
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      // Draw directly from img element to get latest frame
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      console.log('✅ Frame captured from ESP32-S3 CAM (direct from img)');
      return ctx;
    }
    
    // Method 2: Fallback to buffer if img element not ready
    if (!espBufferCanvas || !espBufferHasFrame) {
      console.warn('❌ ESP32-S3 CAM buffer not ready:', {
        bufferExists: !!espBufferCanvas,
        hasFrame: espBufferHasFrame,
        imgReady: img && img.complete,
        imgDimensions: img ? `${img.naturalWidth}x${img.naturalHeight}` : 'N/A'
      });
      return null;
    }
    
    // Validate buffer dimensions
    if (espBufferCanvas.width === 0 || espBufferCanvas.height === 0) {
      console.warn('❌ ESP32 buffer has zero dimensions');
      return null;
    }
    
    // Use buffer as fallback
    ctx.drawImage(espBufferCanvas, 0, 0, canvas.width, canvas.height);
    console.log('✅ Frame captured from ESP32-S3 CAM buffer');
  } else {
    // Webcam mode
    const video = document.getElementById('video-element');
    if (!video) {
      console.warn('❌ Video element not found');
      return null;
    }
    
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      console.warn('❌ Video not ready. ReadyState:', video.readyState);
      return null;
    }
    
    // Validate video dimensions
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn('❌ Video has zero dimensions:', video.videoWidth, 'x', video.videoHeight);
      return null;
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    console.log('✅ Frame captured from webcam');
  }

  return ctx;
}

/**
 * Set canvas size based on video/image dimensions
 */
function setCanvasSize(width, height) {
  const canvas = document.getElementById('canvas-overlay');
  const container = document.getElementById('camera-container');
  
  if (!canvas || !container) return;

  const containerWidth = container.offsetWidth - 32; // Account for padding
  const aspectRatio = height / width;

  canvas.width = containerWidth;
  canvas.height = containerWidth * aspectRatio;
  canvas.style.width = containerWidth + 'px';
  canvas.style.height = (containerWidth * aspectRatio) + 'px';
}

/**
 * Cleanup camera resources
 */
function cleanupCamera() {
  if (cameraState.stream) {
    cameraState.stream.getTracks().forEach(track => track.stop());
    cameraState.stream = null;
  }
  
  // Stop ESP32 stream
  stopESP32Stream();
}

/**
 * Update camera source buttons
 */
function updateCameraButtons() {
  const webcamBtn = document.getElementById('webcam-btn');
  const esp32Btn = document.getElementById('esp32-btn');
  const esp32Info = document.getElementById('esp32-info');
  const switchBtn = document.getElementById('switch-camera-btn');

  if (cameraState.source === 'webcam') {
    webcamBtn.classList.add('active');
    esp32Btn.classList.remove('active');
    esp32Info.style.display = 'none';
    switchBtn.disabled = false;
  } else {
    esp32Btn.classList.add('active');
    webcamBtn.classList.remove('active');
    esp32Info.style.display = 'block';
    switchBtn.disabled = true;
  }
}

/**
 * Update ESP32 mode buttons
 */
function updateESP32Buttons() {
  const streamBtn = document.getElementById('esp32-stream-btn');
  const captureBtn = document.getElementById('esp32-capture-btn');

  if (cameraState.espEndpointMode === 'stream') {
    streamBtn.classList.add('active');
    captureBtn.classList.remove('active');
  } else {
    captureBtn.classList.add('active');
    streamBtn.classList.remove('active');
  }
}

/**
 * Show loading indicator
 */
function showLoading(message = 'Loading...') {
  const indicator = document.getElementById('loading-indicator');
  const text = document.getElementById('loading-text');
  if (indicator) {
    indicator.classList.add('active');
    if (text) text.textContent = message;
  }
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  const indicator = document.getElementById('loading-indicator');
  if (indicator) {
    indicator.classList.remove('active');
  }
}

/**
 * Show error message
 * Supports multi-line messages with \n
 */
function showError(message) {
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    // Convert \n to <br> for HTML display
    const htmlMessage = message.replace(/\n/g, '<br>');
    errorEl.innerHTML = htmlMessage;
    errorEl.style.display = 'block';
    errorEl.style.whiteSpace = 'pre-wrap'; // Preserve line breaks
  }
}

/**
 * Hide error message
 */
function hideError() {
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    errorEl.style.display = 'none';
  }
}

/**
 * Get user-friendly error message
 * Enhanced for mobile devices with better error messages
 */
function getErrorMessage(error) {
  const isMobile = isMobileDevice();
  
  if (error.name === 'NotAllowedError') {
    return isMobile 
      ? '❌ Akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser/HP Anda. Untuk Chrome: Settings > Site Settings > Camera'
      : '❌ Akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser Anda.';
  } else if (error.name === 'NotFoundError') {
    return isMobile
      ? '❌ Kamera tidak ditemukan. Pastikan kamera HP Anda aktif dan tidak digunakan aplikasi lain. Tutup aplikasi kamera lain dan coba lagi.'
      : '❌ Kamera tidak ditemukan. Pastikan kamera terhubung dan tidak digunakan aplikasi lain.';
  } else if (error.name === 'NotReadableError') {
    return isMobile
      ? '❌ Kamera tidak dapat dibaca. Tutup aplikasi lain yang menggunakan kamera (seperti aplikasi kamera, WhatsApp, dll) dan coba lagi.'
      : '❌ Kamera tidak dapat dibaca. Pastikan kamera tidak digunakan aplikasi lain.';
  } else if (error.name === 'OverconstrainedError') {
    return '❌ Kamera tidak mendukung resolusi yang diminta. Mencoba resolusi alternatif...';
  } else if (error.name === 'TypeError' && error.message.includes('getUserMedia')) {
    return isMobile
      ? '❌ Browser tidak mendukung akses kamera. Gunakan Chrome/Edge/Safari terbaru dan pastikan menggunakan HTTPS atau localhost.'
      : '❌ Browser tidak mendukung akses kamera. Gunakan browser modern (Chrome/Edge/Firefox/Safari).';
  } else {
    return `❌ Error: ${error.message || 'Terjadi kesalahan yang tidak diketahui'}`;
  }
}

// Initialize ESP32 info and log mobile status
document.addEventListener('DOMContentLoaded', () => {
  const esp32IpEl = document.getElementById('esp32-ip');
  if (esp32IpEl) {
    esp32IpEl.textContent = ESP32_DNS;
  }
  
  // Log mobile device status on page load
  const isMobile = isMobileDevice();
  const isSecure = isSecureContext();
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  if (isMobile) {
    console.log('[Camera] 📱 Mobile device detected!');
    console.log('[Camera] 📱 Camera access optimized for mobile');
    console.log('[Camera] 📱 ESP32 access optimized for mobile WiFi');
    console.log(`[Camera] 🔒 Secure context: ${isSecure ? '✅ Yes' : '❌ No'}`);
    console.log(`[Camera] 🌐 Protocol: ${protocol}`);
    console.log(`[Camera] 🌐 Hostname: ${hostname}`);
    
    if (!isSecure) {
      console.warn('[Camera] ⚠️ WARNING: Not in secure context!');
      console.warn('[Camera] ⚠️ getUserMedia requires HTTPS or localhost');
      console.warn('[Camera] 💡 Solutions:');
      console.warn('[Camera] 💡 1. Use HTTPS');
      console.warn('[Camera] 💡 2. Access from computer: http://localhost:8000');
      console.warn('[Camera] 💡 3. Access via IP: http://[COMPUTER_IP]:8000');
      console.warn('[Camera] 💡 4. Make sure app is served via HTTP server, not file://');
    }
    
    console.log('[Camera] 💡 Tips:');
    console.log('[Camera] 💡 - Izinkan akses kamera saat diminta');
    console.log('[Camera] 💡 - Pastikan HP dan ESP32 di WiFi yang sama untuk ESP32-CAM');
    console.log('[Camera] 💡 - Gunakan mode Capture jika Stream tidak bekerja');
  } else {
    console.log('[Camera] 💻 Desktop device detected');
    console.log(`[Camera] 🔒 Secure context: ${isSecure ? '✅ Yes' : '❌ No'}`);
    
    if (!isSecure) {
      console.warn('[Camera] ⚠️ WARNING: Not in secure context!');
      console.warn('[Camera] ⚠️ Use http://localhost:8000 or HTTPS');
    }
  }
  
  // Check getUserMedia availability
  const getUserMedia = getGetUserMedia();
  if (getUserMedia) {
    console.log('[Camera] ✅ getUserMedia available');
  } else {
    console.error('[Camera] ❌ getUserMedia NOT available');
    console.error('[Camera] ❌ Browser may not support camera access');
  }
  
  // Make functions available globally for debugging
  if (typeof window !== 'undefined') {
    window.isMobileDevice = isMobileDevice;
    window.isSecureContext = isSecureContext;
    window.getGetUserMedia = getGetUserMedia;
    console.log('[Camera] 💡 Debug functions available: isMobileDevice(), isSecureContext(), getGetUserMedia()');                                        
  }
});
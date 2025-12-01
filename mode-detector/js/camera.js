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

// ESP32 Configuration - IP Static Priority System
// Primary: Static IP (192.168.1.12) - No mDNS dependency
// Fallback: mDNS (esp32cam.local) - Only if static IP fails

const ESP32_STATIC_IP = '192.168.1.12'; // Primary: Static IP
const ESP32_STATIC_BASE_URL = `http://${ESP32_STATIC_IP}`;

const ESP32_MDNS_HOST = 'esp32cam.local'; // Fallback: mDNS (only if static IP fails)
const ESP32_MDNS_BASE_URL = `http://${ESP32_MDNS_HOST}`;

// Legacy variables for backward compatibility
const ESP32_DNS = ESP32_MDNS_HOST;
const ESP32_IP = ESP32_STATIC_IP;

// Make globally available for vibration.js and other modules
if (typeof window !== 'undefined') {
  window.ESP32_STATIC_IP = ESP32_STATIC_IP;
  window.ESP32_STATIC_BASE_URL = ESP32_STATIC_BASE_URL;
  window.ESP32_MDNS_HOST = ESP32_MDNS_HOST;
  window.ESP32_DNS = ESP32_DNS; // Legacy
  window.ESP32_IP = ESP32_IP; // Legacy
}

/**
 * Get ESP32 Base URL - Always returns Static IP (Primary)
 * Fallback to mDNS is handled in connection logic, not here
 * @returns {string} Base URL using static IP
 */
function getESP32BaseURL() {
  // Always use static IP as primary
  // Fallback mechanism handled in connection functions
  return ESP32_STATIC_BASE_URL;
}

/**
 * Get ESP32 Stream URL - Uses Static IP (Port 80)
 * @returns {string} Stream URL
 */
function getESP32StreamURL() {
  return `${ESP32_STATIC_BASE_URL}/stream`;
}

/**
 * Get ESP32 Capture URL - Uses Static IP (Port 80)
 * @returns {string} Capture URL
 */
function getESP32CaptureURL() {
  return `${ESP32_STATIC_BASE_URL}/capture`;
}

// ESP32-CAM Endpoints - All using Static IP (Port 80)
// Note: Port 81 removed, all endpoints use Port 80
const ESP32_STREAM_URL = getESP32StreamURL();   // http://192.168.1.12/stream
const ESP32_CAPTURE_URL = getESP32CaptureURL(); // http://192.168.1.12/capture
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

// ESP32 fetch-based frame capture (avoids tainted canvas)
let espFetchImageBitmap = null;
let espFetchFrameActive = false;
let espFetchFrameController = null;
let espFetchUseStream = false; // Flag to switch between /capture and /stream

// Make buffer canvas globally accessible for preprocessing
if (typeof window !== 'undefined') {
  // Expose getter function to access buffer canvas safely
  window.getESP32BufferCanvas = function() {
    if (cameraState.source === 'esp32' && espBufferCanvas && espBufferHasFrame) {
      return espBufferCanvas;
    }
    return null;
  };
}

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
  
  // Only log first attempt to reduce console spam
  if (!window._flashDisableLogged) {
    console.log('[ESP32-CAM] 💡 Attempting to disable flash LED...');
    window._flashDisableLogged = true;
  }
  
  // Try all endpoints (some ESP32-CAM firmware may use different endpoints)
  // Add timeout to prevent hanging requests
  const promises = endpoints.map(endpoint => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000); // 1 second timeout
    
    return fetch(endpoint, { 
      method: 'GET',
      mode: 'no-cors', // Avoid CORS issues
      cache: 'no-cache',
      signal: controller.signal
    }).then(() => {
      clearTimeout(timeoutId);
      return true;
    }).catch(err => {
      clearTimeout(timeoutId);
      // Ignore errors - endpoint might not exist or connection failed
      return null;
    });
  });
  
  // Try parallel requests (no-cors mode won't throw errors even if endpoint doesn't exist)
  try {
    await Promise.all(promises);
    // Don't log every attempt - too verbose
    // Only log on first success
    if (!window._flashDisableSuccessLogged) {
      console.log('[ESP32-CAM] 💡 Flash LED disable command sent');
      window._flashDisableSuccessLogged = true;
    }
  } catch (error) {
    // Ignore errors - some endpoints may not exist depending on firmware
    // Don't log - connection errors are expected if ESP32-CAM is not connected
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
  
  // Stop fetch-based frame capture
  if (espFetchFrameController) {
    espFetchFrameController.abort();
    espFetchFrameController = null;
  }
  espFetchFrameActive = false;
  espFetchImageBitmap = null;
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
 * Fetch ESP32-CAM frame using Fetch API with no-cors mode + ImageBitmap (avoids tainted canvas)
 * This method uses Fetch API with no-cors mode to get frame as blob without requiring CORS headers
 * Then converts to ImageBitmap which can be drawn to canvas without tainting it
 * Note: Uses /capture endpoint (single frame) - more reliable than /stream for fetch
 */
async function fetchESP32Frame() {
  if (cameraState.source !== 'esp32') {
    return Promise.resolve(null);
  }

  // Abort previous request if exists
  if (espFetchFrameController && espFetchFrameController.abort) {
    espFetchFrameController.abort();
  }
  
  // Use /capture endpoint (single JPEG frame - best for XHR)
  // User confirmed /capture is accessible, so use it directly
  const url = `${ESP32_STATIC_BASE_URL}/capture?t=${Date.now()}`;
  
  // Log fetch attempt occasionally for debugging
  const now = Date.now();
  if (!window._lastFetchAttemptLog || now - window._lastFetchAttemptLog > 5000) {
    console.log(`[ESP32-CAM] 🔄 Fetching frame from: ${url}`);
    window._lastFetchAttemptLog = now;
  }
  
  // Use XMLHttpRequest instead of fetch for better reliability with /capture endpoint
  // XHR with responseType='blob' works better for binary data like JPEG images
  // XHR doesn't have CORS preflight issues like fetch
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.timeout = 8000; // 8 second timeout (reasonable for /capture endpoint)
    
    const xhrStartTime = Date.now();
    
    xhr.onload = async () => {
      const xhrTime = Date.now() - xhrStartTime;
      
      // Log status code and response info
      if (xhr.status !== 200) {
        const now = Date.now();
        if (!window._lastXHRStatusErrorLog || now - window._lastXHRStatusErrorLog > 10000) {
          console.warn(`[ESP32-CAM] ⚠️ XHR status ${xhr.status} (expected 200)`);
          console.warn('[ESP32-CAM] 💡 Endpoint /capture mungkin mengembalikan error');
          console.warn('[ESP32-CAM] 💡 Coba akses langsung di browser: ' + url);
          window._lastXHRStatusErrorLog = now;
        }
        resolve(null);
        return;
      }
      
      if (xhrTime > 2000) {
        const now = Date.now();
        if (!window._lastSlowXHRLog || now - window._lastSlowXHRLog > 10000) {
          console.log(`[ESP32-CAM] ⏱️ XHR took ${xhrTime}ms (slow but working)`);
          window._lastSlowXHRLog = now;
        }
      }
      
      // XHR with responseType='blob' gives us the blob directly
      const blob = xhr.response;
      
      if (!blob || blob.size === 0) {
        const now = Date.now();
        if (!window._lastEmptyBlobLog || now - window._lastEmptyBlobLog > 10000) {
          console.warn('[ESP32-CAM] ⚠️ Received empty blob from XHR');
          console.warn('[ESP32-CAM] 💡 Endpoint /capture mungkin tidak tersedia atau mengembalikan data kosong');
          console.warn('[ESP32-CAM] 💡 Coba akses langsung di browser: ' + url);
          window._lastEmptyBlobLog = now;
        }
        resolve(null);
        return;
      }
      
      // Log blob size for debugging (always log first few times)
      const now = Date.now();
      if (!window._blobSizeLogCount) {
        window._blobSizeLogCount = 0;
      }
      window._blobSizeLogCount++;
      if (window._blobSizeLogCount <= 5 || !window._lastBlobSizeLog || now - window._lastBlobSizeLog > 10000) {
        console.log(`[ESP32-CAM] 📦 Received blob: ${blob.size} bytes, type: ${blob.type || 'unknown'}, status: ${xhr.status}, time: ${xhrTime}ms`);
        window._lastBlobSizeLog = now;
      }
      
      // Convert blob to ImageBitmap (preferred - avoids tainted canvas)
      // ImageBitmap created from blob can be drawn to canvas without tainting it
      if (typeof createImageBitmap !== 'undefined') {
        try {
          const imageBitmap = await createImageBitmap(blob);
          espFetchImageBitmap = imageBitmap;
          // Log success on first frame and occasionally
          if (!window._imageBitmapSuccessLogged) {
            console.log('[ESP32-CAM] ✅ ImageBitmap created successfully from blob (XHR method)!');
            console.log('[ESP32-CAM] ✅ Canvas tidak akan tainted - YOLO bisa memproses frame!');
            console.log(`[ESP32-CAM] ✅ ImageBitmap dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
            console.log('[ESP32-CAM] 🎉 YOLO detection sekarang bisa bekerja dengan ESP32-CAM!');
            window._imageBitmapSuccessLogged = true;
          } else if (!window._lastImageBitmapSuccessLog || now - window._lastImageBitmapSuccessLog > 30000) {
            console.log(`[ESP32-CAM] ✅ ImageBitmap method working: ${imageBitmap.width}x${imageBitmap.height}`);
            window._lastImageBitmapSuccessLog = now;
          }
          resolve(imageBitmap);
          return;
        } catch (bitmapError) {
          // ImageBitmap creation failed, try data URL method
          const now = Date.now();
          if (!window._lastImageBitmapErrorLog || now - window._lastImageBitmapErrorLog > 10000) {
            console.warn('[ESP32-CAM] ⚠️ ImageBitmap creation failed:', bitmapError.message);
            console.warn('[ESP32-CAM] 💡 Trying data URL method as fallback...');
            window._lastImageBitmapErrorLog = now;
          }
        }
      }
      
      // Fallback: convert blob to data URL -> Image
      // Data URL is considered same-origin, so canvas won't be tainted
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Store as ImageBitmap-like object for consistency
          espFetchImageBitmap = img;
          if (!window._dataURLSuccessLogged) {
            console.log('[ESP32-CAM] ✅ Data URL method working (fallback)');
            console.log(`[ESP32-CAM] ✅ Image dimensions: ${img.width}x${img.height}`);
            window._dataURLSuccessLogged = true;
          }
          resolve(img);
        };
        img.onerror = () => {
          const now = Date.now();
          if (!window._lastDataURLErrorLog || now - window._lastDataURLErrorLog > 10000) {
            console.warn('[ESP32-CAM] ⚠️ Data URL image load failed');
            window._lastDataURLErrorLog = now;
          }
          resolve(null);
        };
        img.src = reader.result; // data URL - same origin, no taint
      };
      reader.onerror = () => {
        const now = Date.now();
        if (!window._lastFileReaderErrorLog || now - window._lastFileReaderErrorLog > 10000) {
          console.warn('[ESP32-CAM] ⚠️ FileReader error');
          window._lastFileReaderErrorLog = now;
        }
        resolve(null);
      };
      reader.readAsDataURL(blob);
    };
    
    xhr.onerror = () => {
      const now = Date.now();
      if (!window._lastXHRErrorLog || now - window._lastXHRErrorLog > 10000) {
        console.warn('[ESP32-CAM] ⚠️ XHR error fetching frame');
        console.warn('[ESP32-CAM] 💡 Pastikan ESP32-CAM terhubung ke WiFi yang sama');
        console.warn('[ESP32-CAM] 💡 IP: ' + ESP32_STATIC_BASE_URL);
        console.warn('[ESP32-CAM] 💡 URL: ' + url);
        console.warn('[ESP32-CAM] 💡 XHR akan terus mencoba setiap 200ms...');
        window._lastXHRErrorLog = now;
      }
      resolve(null);
    };
    
    xhr.ontimeout = () => {
      const now = Date.now();
      if (!window._lastXHRTimeoutLog || now - window._lastXHRTimeoutLog > 30000) {
        console.warn('[ESP32-CAM] ⚠️ XHR timeout (8s) - endpoint mungkin lambat');
        console.warn('[ESP32-CAM] 💡 Endpoint: /capture');
        console.warn('[ESP32-CAM] 💡 Pastikan ESP32-CAM merespons dengan cepat');
        console.warn('[ESP32-CAM] 💡 Coba akses langsung di browser: ' + url);
        console.warn('[ESP32-CAM] 💡 XHR akan terus mencoba setiap 200ms...');
        window._lastXHRTimeoutLog = now;
      }
      resolve(null);
    };
    
    // Store controller for abort
    espFetchFrameController = { abort: () => xhr.abort() };
    
    try {
      xhr.open('GET', url, true);
      xhr.send();
      
      // Log XHR start (first time only)
      const now = Date.now();
      if (!window._xhrStartLogged) {
        console.log('[ESP32-CAM] 🔄 XHR fetch started for /capture endpoint');
        console.log('[ESP32-CAM] 💡 XHR akan terus mencoba setiap 200ms sampai berhasil');
        window._xhrStartLogged = true;
      }
    } catch (error) {
      const now = Date.now();
      if (!window._lastXHROpenErrorLog || now - window._lastXHROpenErrorLog > 10000) {
        console.error('[ESP32-CAM] ❌ XHR open/send failed:', error);
        console.error('[ESP32-CAM] 💡 URL: ' + url);
        window._lastXHROpenErrorLog = now;
      }
      resolve(null);
    }
  });
}

/**
 * Start continuous fetch-based frame capture for ESP32-CAM
 * This runs in background and updates espFetchImageBitmap
 * Uses /capture endpoint for single frame capture (better for fetch than /stream)
 */
function startFetchFrameCapture() {
  if (cameraState.source !== 'esp32') {
    return;
  }
  
  // Check if createImageBitmap is available
  if (typeof createImageBitmap === 'undefined') {
    console.warn('[ESP32-CAM] ⚠️ createImageBitmap not available, skipping fetch method');
    return;
  }
  
  espFetchFrameActive = true;
  console.log('[ESP32-CAM] 🎯 Starting fetch-based frame capture (ImageBitmap method - avoids tainted canvas)');
  console.log('[ESP32-CAM] ✅ espFetchFrameActive = true');
  console.log('[ESP32-CAM] 📡 Target URL: ' + ESP32_STATIC_BASE_URL + '/capture');
  
  let fetchAttempts = 0;
  let fetchSuccessCount = 0;
  let lastFetchErrorTime = 0;
  let fetchMethodWorking = false;
  let fetchLoopRunning = false;
  
  async function fetchLoop() {
    // Prevent multiple fetch loops from running
    if (fetchLoopRunning) {
      console.warn('[ESP32-CAM] ⚠️ Fetch loop already running, skipping...');
      return;
    }
    
    fetchLoopRunning = true;
    
    // Check if still active and source is still ESP32
    if (!espFetchFrameActive) {
      console.warn('[ESP32-CAM] ⚠️ Fetch loop stopped: espFetchFrameActive = false');
      fetchLoopRunning = false;
      return;
    }
    
    if (cameraState.source !== 'esp32') {
      console.warn('[ESP32-CAM] ⚠️ Fetch loop stopped: camera source changed to ' + cameraState.source);
      espFetchFrameActive = false; // Stop fetch loop
      fetchLoopRunning = false;
      return;
    }
    
    fetchAttempts++;
    const imageBitmap = await fetchESP32Frame();
    
    if (imageBitmap) {
      fetchSuccessCount++;
      fetchMethodWorking = true;
      
      // Update camera ready state if we got a frame
      if (!cameraState.isStreamReady) {
        cameraState.isStreamReady = true;
        console.log('[ESP32-CAM] ✅ Camera ready (fetch method - ImageBitmap)');
        console.log('[ESP32-CAM] ✅ YOLO sekarang bisa memproses frame dari ESP32-CAM!');
        if (typeof updateStatusIndicators === 'function') {
          updateStatusIndicators();
        }
        if (typeof startLiveDetection === 'function') {
          startLiveDetection();
        }
      }
      
      // Clear any previous errors
      if (window._esp32CorsErrorShown) {
        window._esp32CorsErrorShown = false;
        if (typeof hideError === 'function') {
          hideError();
        }
      }
      
      // Log success on first frame and occasionally
      if (fetchSuccessCount === 1) {
        console.log(`[ESP32-CAM] ✅ Fetch method working! ImageBitmap method berhasil menghindari tainted canvas`);
        console.log(`[ESP32-CAM] ✅ Frame pertama berhasil diambil - YOLO detection akan berjalan`);
      } else if (fetchSuccessCount % 100 === 0) {
        console.log(`[ESP32-CAM] ✅ Fetch method: ${fetchSuccessCount} frames captured (ImageBitmap)`);
      }
    } else {
      // Fetch failed - might be network error or endpoint not available
      const now = Date.now();
      if (fetchAttempts === 1) {
        // Log on first attempt
        console.log('[ESP32-CAM] 🔄 Attempting to fetch frame from /capture endpoint...');
        console.log('[ESP32-CAM] 💡 Fetch loop akan terus berjalan setiap 200ms sampai berhasil');
      } else if (fetchAttempts >= 10 && fetchSuccessCount === 0 && (now - lastFetchErrorTime > 20000)) {
        console.warn('[ESP32-CAM] ⚠️ Fetch method belum berhasil setelah 10 attempts');
        console.warn('[ESP32-CAM] 💡 Kemungkinan: Network error atau endpoint /capture tidak tersedia');
        console.warn('[ESP32-CAM] 💡 Pastikan ESP32-CAM terhubung ke WiFi yang sama');
        console.warn('[ESP32-CAM] 💡 Pastikan endpoint /capture tersedia di ESP32-CAM');
        console.warn('[ESP32-CAM] 💡 IP: ' + ESP32_STATIC_BASE_URL);
        console.warn('[ESP32-CAM] 💡 Coba akses di browser: ' + ESP32_STATIC_BASE_URL + '/capture');
        console.warn('[ESP32-CAM] 💡 Fetch loop akan terus mencoba setiap 200ms...');
        lastFetchErrorTime = now;
      }
    }
    
    fetchLoopRunning = false;
    
    // Schedule next fetch (every 200ms for ~5 FPS - slower but more reliable)
    // This is acceptable since it's a method that avoids tainted canvas
    // IMPORTANT: Always schedule next fetch if still active, even if current fetch failed
    if (espFetchFrameActive && cameraState.source === 'esp32') {
      setTimeout(() => {
        // Double-check before scheduling next fetch
        if (espFetchFrameActive && cameraState.source === 'esp32') {
          fetchLoop();
        } else {
          console.warn('[ESP32-CAM] ⚠️ Fetch loop stopped before next iteration: espFetchFrameActive = ' + espFetchFrameActive + ', source = ' + cameraState.source);
        }
      }, 200);
    } else {
      console.warn('[ESP32-CAM] ⚠️ Fetch loop stopped: espFetchFrameActive = ' + espFetchFrameActive + ', source = ' + cameraState.source);
    }
  }
  
  // Start fetch loop immediately
  console.log('[ESP32-CAM] 🚀 Starting fetch loop for ImageBitmap method...');
  console.log('[ESP32-CAM] 💡 Fetch akan mencoba setiap 200ms sampai berhasil');
  fetchLoop();
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
  
  // CORS Bypass: Remove crossOrigin to avoid CORS check
  // ESP32 doesn't send CORS headers, so we bypass CORS check
  // Image will still load and display, but we need to handle pixel data differently
  img.crossOrigin = null; // Remove CORS requirement - allows image to load without CORS headers
  
  console.log(`[ESP32-CAM] 📡 Starting MJPEG stream from: ${ESP32_STREAM_URL}`);
  console.log(`[ESP32-CAM] ✅ Connecting directly to: http://192.168.1.12/stream`);
  console.log(`[ESP32-CAM] 🎥 STREAM MODE ONLY - No capture mode`);
  console.log(`[ESP32-CAM] ⚡ CORS bypass: crossOrigin = null (no CORS check)`);
  
  // Skip connection test - directly connect to stream
  // Connection test often fails even when stream works
  startStream();
  
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
      
      // Update buffer canvas (critical for YOLO detection)
      // Buffer is used to avoid tainted canvas issues when reading pixel data
      // NOTE: If ESP32-CAM doesn't send CORS headers, the buffer canvas will still be tainted
      // The only real solution is to enable CORS on ESP32-CAM firmware
      if (img.naturalWidth && img.naturalHeight) {
        if (!espBufferCanvas) {
          espBufferCanvas = document.createElement('canvas');
        }
        // Only update buffer dimensions if they changed (performance optimization)
        if (espBufferCanvas.width !== img.naturalWidth || 
            espBufferCanvas.height !== img.naturalHeight) {
          espBufferCanvas.width = img.naturalWidth;
          espBufferCanvas.height = img.naturalHeight;
        }
        const ctx = espBufferCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          try {
            // Draw image to buffer canvas
            // Note: Even with crossOrigin=null, drawing to canvas is allowed
            // However, if the source image is from a different origin without CORS,
            // the canvas will be tainted and we cannot read pixel data
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
            
            // Test if buffer is not tainted by trying to read a single pixel
            // This will throw SecurityError if canvas is tainted
            try {
              ctx.getImageData(0, 0, 1, 1);
              espBufferHasFrame = true;
              // Clear any previous tainted canvas error if successful
              if (window._lastTaintedCanvasErrorLog) {
                delete window._lastTaintedCanvasErrorLog;
                if (typeof hideError === 'function') {
                  hideError();
                }
              }
            } catch (taintedTestError) {
              // Buffer canvas is tainted - this means ESP32-CAM doesn't send CORS headers
              espBufferHasFrame = false;
              // Only log if ImageBitmap method is not active or has failed
              const now = Date.now();
              if ((!espFetchFrameActive || (espFetchFrameActive && !espFetchImageBitmap)) && 
                  (!window._lastTaintedCanvasErrorLog || now - window._lastTaintedCanvasErrorLog > 30000)) {
                console.error('[ESP32-CAM] ❌ Buffer canvas is tainted - YOLO tidak dapat memproses frame');
                console.error('[ESP32-CAM] 💡 MASALAH: ESP32-CAM tidak mengirim CORS headers');
                console.error('[ESP32-CAM] 💡 SOLUSI: Aktifkan CORS di ESP32-CAM firmware');
                console.error('[ESP32-CAM] 💡 Untuk Arduino/ESP-IDF, tambahkan di setiap response:');
                console.error('[ESP32-CAM] 💡   server.sendHeader("Access-Control-Allow-Origin", "*");');
                console.error('[ESP32-CAM] 💡 Atau tunggu ImageBitmap method selesai memuat frame...');
                if (typeof showError === 'function' && !window._esp32CorsErrorShown && !espFetchFrameActive) {
                  showError('❌ ESP32-CAM: Canvas tainted - YOLO tidak dapat memproses frame\n\n💡 MASALAH:\nESP32-CAM tidak mengirim CORS headers\n\n💡 SOLUSI:\n1. Aktifkan CORS di ESP32-CAM firmware\n2. Tambahkan: Access-Control-Allow-Origin: *\n3. Atau tunggu ImageBitmap method...');
                  window._esp32CorsErrorShown = true;
                }
                window._lastTaintedCanvasErrorLog = now;
              }
            }
          } catch (bufferError) {
            console.warn('[ESP32-CAM] ⚠️ Error updating buffer canvas:', bufferError);
            espBufferHasFrame = false;
          }
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
        
        // Note: OffscreenCanvas method removed because it doesn't help
        // If img element is tainted, ImageBitmap created from it will also be tainted
        // We rely on fetch method to get clean ImageBitmap from /capture endpoint
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
      cameraState.espErrorCount += 1;
      
      // Don't show error immediately - give stream time to establish connection
      if (cameraState.espErrorCount <= 5) {
        console.warn(`[ESP32-CAM] ⚠️ Stream connecting... (attempt ${cameraState.espErrorCount}/10)`);
        console.log(`[ESP32-CAM] 📡 Retrying: ${ESP32_STREAM_URL}`);
        // Retry with same stream URL
        setTimeout(() => {
          const retryUrl = `${ESP32_STATIC_BASE_URL}/stream?t=${Date.now()}`;
          img.src = retryUrl;
        }, 1000);
        return;
      }
      
      console.error(`[ESP32-CAM] ❌ Stream frame error (${cameraState.espErrorCount} attempts)`);
      console.error(`[ESP32-CAM] 📡 Stream URL: ${ESP32_STREAM_URL}`);
      
      // If stream doesn't work after 5 errors, try alternative polling method (still using /stream)
      if (cameraState.espErrorCount >= 5 && cameraState.espErrorCount < 10 && !img.dataset.streamMethod) {
        console.warn(`[ESP32-CAM] ⚠️ Direct stream failed, trying polling method (still using /stream endpoint)...`);
        img.dataset.streamMethod = 'polling';
        // Switch to fast polling method - IMPORTANT: Still uses /stream endpoint for ML
        startStreamPolling();
        return;
      }
      
      // Keep retrying stream - no fallback to capture mode
      // Stream is required for ML, so we keep trying
      if (cameraState.espErrorCount >= 10) {
        console.error(`[ESP32-CAM] ❌ Stream failed after 10 attempts`);
        console.error(`[ESP32-CAM] ⚠️ Stream is required for ML - will keep retrying`);
        // Don't switch to capture - keep trying stream
      }
      
      // Show error only after 5 attempts
      if (cameraState.espErrorCount > 5) {
        const errorMsg = `ESP32-CAM stream error (${cameraState.espErrorCount}/10). Retrying...\n\nStream URL: ${ESP32_STREAM_URL}\n\nMake sure ESP32 web server is running on port 80 with /stream endpoint.`;
        showError(errorMsg);
      }
    };
    
    // Keep track of last flash disable time for stream mode
    let streamFlashDisableTime = 0;
    const STREAM_FLASH_DISABLE_INTERVAL = 10000; // Disable flash every 10 seconds in stream mode
    
    // Set stream URL directly - browser should handle MJPEG automatically
    // Primary: Use Static IP (192.168.1.12/stream)
    // Fallback: mDNS handled in onerror handler
    const streamUrl = `${ESP32_STATIC_BASE_URL}/stream?t=${Date.now()}`;
    console.log(`[ESP32-CAM] 📡 Setting stream URL (Static IP): ${streamUrl}`);
    console.log(`[ESP32-CAM] ✅ Primary: http://192.168.1.12/stream`);
    console.log(`[ESP32-CAM] 📡 Image crossOrigin: ${img.crossOrigin || 'null (CORS bypass)'}`);
    console.log(`[ESP32-CAM] ⚡ CORS bypass enabled - image should load without CORS headers`);
    
    // Setup fallback handler before setting src
    let fallbackAttempted = false;
    const originalOnError = img.onerror;
    img.onerror = function() {
      if (!fallbackAttempted) {
        fallbackAttempted = true;
        console.warn(`[ESP32-CAM] ⚠️ Static IP failed, trying mDNS fallback...`);
        const fallbackUrl = `${ESP32_MDNS_BASE_URL}/stream?t=${Date.now()}`;
        console.log(`[ESP32-CAM] 🔄 Fallback URL: ${fallbackUrl}`);
        img.src = fallbackUrl;
      } else {
        // Both failed, call original error handler
        if (originalOnError) originalOnError.call(this);
      }
    };
    
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
    console.log(`[ESP32-CAM] ⚡ CORS bypass: crossOrigin = null for polling`);
    
    // Ensure crossOrigin is null for polling (CORS bypass)
    img.crossOrigin = null;
    
    let pollingFlashDisableTime = 0;
    const STREAM_FLASH_DISABLE_INTERVAL = 10000; // Re-declare for polling function
    let lastPollFrameTime = Date.now();
    let consecutiveErrors = 0;
    let pollingInterval = 150; // Start with 150ms (6-7 FPS)
    let lastSuccessfulFrame = Date.now();
    
    // Setup image load handler for polling method
    img.onload = () => {
      // Clear any pending timeout
      if (window._currentPollingTimeout) {
        clearTimeout(window._currentPollingTimeout);
        window._currentPollingTimeout = null;
      }
      
      const now = Date.now();
      const timeSinceLastFrame = now - lastPollFrameTime;
      lastPollFrameTime = now;
      frameCount++; // Increment frame count for polling method too
      
      // Update buffer canvas (critical for YOLO detection)
      // Buffer is used to avoid tainted canvas issues when reading pixel data
      if (img.naturalWidth && img.naturalHeight) {
        if (!espBufferCanvas) {
          espBufferCanvas = document.createElement('canvas');
        }
        // Only update buffer dimensions if they changed (performance optimization)
        if (espBufferCanvas.width !== img.naturalWidth || 
            espBufferCanvas.height !== img.naturalHeight) {
          espBufferCanvas.width = img.naturalWidth;
          espBufferCanvas.height = img.naturalHeight;
        }
        const ctx = espBufferCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          try {
            // Draw image to buffer canvas
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
            
            // Test if buffer is not tainted
            try {
              ctx.getImageData(0, 0, 1, 1);
              espBufferHasFrame = true;
              // Clear any previous tainted canvas error if successful
              if (window._lastTaintedCanvasErrorLog) {
                delete window._lastTaintedCanvasErrorLog;
                if (typeof hideError === 'function') {
                  hideError();
                }
              }
            } catch (taintedTestError) {
              // Buffer canvas is tainted
              espBufferHasFrame = false;
              // Logging is handled in main onload handler, no need to duplicate here
            }
          } catch (bufferError) {
            console.warn('[ESP32-CAM] ⚠️ Error updating buffer canvas (polling):', bufferError);
            espBufferHasFrame = false;
          }
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
      
      // Reset error counters on successful frame
      consecutiveErrors = 0;
      pollingInterval = 150; // Reset to normal interval
      lastSuccessfulFrame = Date.now();
      
      setCanvasSize(img.naturalWidth || 640, img.naturalHeight || 480);
      img.style.display = 'block';
      document.getElementById('video-element').style.display = 'none';
    };
    
    img.onerror = () => {
      consecutiveErrors++;
      cameraState.espErrorCount += 1;
      
      // Throttle error logging
      const now = Date.now();
      if (!window._lastPollingErrorLog || now - window._lastPollingErrorLog > 5000) {
        console.warn(`[ESP32-CAM] ⚠️ Frame error in polling method (${consecutiveErrors} consecutive errors)`);
        console.warn(`[ESP32-CAM] 💡 Check: ESP32-CAM is connected and /capture endpoint is available`);
        console.warn(`[ESP32-CAM] 💡 IP: ${ESP32_STATIC_IP}`);
        window._lastPollingErrorLog = now;
      }
      
      // If too many consecutive errors, slow down polling
      if (consecutiveErrors > 5) {
        pollingInterval = Math.min(pollingInterval * 1.2, 2000); // Increase interval, max 2 seconds
      }
      
      // Keep retrying - don't stop polling
      // Polling will continue with adjusted interval
    };
    
    function pollFrame() {
      if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
        return; // Stop if switched away
      }
      
      // Check if too many consecutive errors - increase interval
      const now = Date.now();
      if (now - lastSuccessfulFrame > 5000 && consecutiveErrors > 10) {
        // Too many errors, slow down polling
        pollingInterval = Math.min(pollingInterval * 1.5, 2000); // Max 2 seconds
        const now2 = Date.now();
        if (!window._lastPollingSlowdownLog || now2 - window._lastPollingSlowdownLog > 10000) {
          console.warn(`[ESP32-CAM] ⚠️ Too many errors, slowing down polling to ${pollingInterval}ms`);
          window._lastPollingSlowdownLog = now2;
        }
      }
      
      // Periodically disable flash during polling
      if (now - pollingFlashDisableTime > STREAM_FLASH_DISABLE_INTERVAL) {
        disableESP32Flash();
        pollingFlashDisableTime = now;
      }
      
      // Try to use fetch/XHR method first (ImageBitmap - avoids tainted canvas)
      // This is the same method used by fetchESP32Frame()
      fetchESP32Frame().then((imageBitmap) => {
        if (imageBitmap) {
          // Success! Store ImageBitmap for captureFrame() to use
          espFetchImageBitmap = imageBitmap;
          consecutiveErrors = 0;
          pollingInterval = 150; // Reset to normal interval
          lastSuccessfulFrame = Date.now();
          
          // Also update img element for display (even if tainted, it's just for display)
          const timestamp = Date.now();
          const url = `${ESP32_STATIC_BASE_URL}/capture?t=${timestamp}`;
          if (img.crossOrigin !== null) {
            img.crossOrigin = null;
          }
          img.src = url;
          
          // Schedule next poll
          espPollingTimer = setTimeout(pollFrame, pollingInterval);
        } else {
          // Fetch failed, fallback to direct img.src (will be tainted but at least we try)
          consecutiveErrors++;
          const timestamp = Date.now();
          const url = `${ESP32_STATIC_BASE_URL}/capture?t=${timestamp}`;
          
          if (img.crossOrigin !== null) {
            img.crossOrigin = null;
          }
          
          // Set timeout for image load
          const loadTimeout = setTimeout(() => {
            if (img.src === url) {
              consecutiveErrors++;
              cameraState.espErrorCount++;
              const now = Date.now();
              if (!window._lastPollingTimeoutLog || now - window._lastPollingTimeoutLog > 5000) {
                console.warn(`[ESP32-CAM] ⚠️ Frame load timeout (${consecutiveErrors} consecutive errors)`);
                window._lastPollingTimeoutLog = now;
              }
              espPollingTimer = setTimeout(pollFrame, pollingInterval);
            }
          }, 3000);
          
          window._currentPollingTimeout = loadTimeout;
          img.src = url;
          
          // Schedule next poll
          espPollingTimer = setTimeout(pollFrame, pollingInterval);
        }
      }).catch((error) => {
        // Fetch error, fallback to direct img.src
        consecutiveErrors++;
        const timestamp = Date.now();
        const url = `${ESP32_STATIC_BASE_URL}/capture?t=${timestamp}`;
        
        if (img.crossOrigin !== null) {
          img.crossOrigin = null;
        }
        
        img.src = url;
        espPollingTimer = setTimeout(pollFrame, pollingInterval);
      });
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
    ? `Menghubungkan ke ESP32-CAM dari HP (${ESP32_STATIC_IP})...`
    : `Menghubungkan ke ESP32-CAM (${ESP32_STATIC_IP})...`;
  
  showLoading(loadingMsg);
  cameraState.isStreamReady = false; // Set to false initially, will be true when frame loads
  cameraState.espErrorCount = 0;
  
  console.log(`[ESP32-CAM] 🔌 Initializing ESP32-CAM connection...`);
  console.log(`[ESP32-CAM] 📱 Mobile device: ${isMobile ? 'Yes' : 'No'}`);
  console.log(`[ESP32-CAM] 📡 Primary (Static IP): ${ESP32_STATIC_IP}`);
  console.log(`[ESP32-CAM] 📡 Fallback (mDNS): ${ESP32_MDNS_HOST}`);
  console.log(`[ESP32-CAM] 📡 Stream URL: ${ESP32_STREAM_URL}`);
  console.log(`[ESP32-CAM] 📡 Mode: STREAM ONLY (no capture mode)`);
  console.log(`[ESP32-CAM] ✅ Machine Learning will use: ${ESP32_STREAM_URL}`);
  
  // Mobile-specific tips
  if (isMobile) {
    console.log(`[ESP32-CAM] 💡 TIPS untuk mobile:`);
    console.log(`[ESP32-CAM] 💡 - Pastikan HP dan ESP32 di WiFi yang sama`);
    console.log(`[ESP32-CAM] 💡 - IP ESP32: ${ESP32_STATIC_IP}`);
    console.log(`[ESP32-CAM] 💡 - Stream endpoint: /stream (for ML)`);
    console.log(`[ESP32-CAM] 💡 - Jika tidak connect, akan fallback ke mDNS`);
  }
  
  // Disable flash LED immediately when initializing ESP32-CAM
  disableESP32Flash();
  
  // Update status
  if (typeof updateStatusIndicators === 'function') {
    updateStatusIndicators();
  }

  // STREAM MODE ONLY - No capture mode
  // Always use MJPEG stream for Machine Learning
  console.log(`[ESP32-CAM] 🎥 Starting STREAM mode only (no capture mode)`);
  
  // Start fetch-based frame capture as alternative method (avoids tainted canvas)
  // This runs in parallel with img.src method
  if (typeof createImageBitmap !== 'undefined') {
    console.log(`[ESP32-CAM] 🎯 Starting fetch-based frame capture (ImageBitmap method)`);
    startFetchFrameCapture();
  }
  
  readMJPEGStream();
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
  
  // If switching to ESP32-CAM, log the IP
  if (source === 'esp32') {
    console.log(`[Camera] 📡 Switching to ESP32-CAM at IP: ${ESP32_STATIC_IP}`);
    console.log(`[Camera] ✅ Stream URL: ${ESP32_STREAM_URL}`);
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
  
  // Priority 1: Check ImageBitmap from fetch (BEST - avoids tainted canvas)
  if (espFetchImageBitmap) {
    const width = espFetchImageBitmap.width || (espFetchImageBitmap.naturalWidth || 0);
    const height = espFetchImageBitmap.height || (espFetchImageBitmap.naturalHeight || 0);
    if (width > 0 && height > 0) {
      return true;
    }
  }
  
  // Priority 2: Check img element (may be tainted)
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return true;
  }
  
  // Priority 3: Check buffer (if img element not ready yet, buffer might have frame)
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
    // ESP32 mode: Try multiple methods to get non-tainted frame
    
    // Method 1: Use ImageBitmap from fetch (BEST - avoids tainted canvas completely)
    // This is the preferred method as it doesn't require CORS headers
    // ImageBitmap created from blob (via fetch) should never taint canvas
    if (espFetchImageBitmap) {
      const width = espFetchImageBitmap.width || (espFetchImageBitmap.naturalWidth || 0);
      const height = espFetchImageBitmap.height || (espFetchImageBitmap.naturalHeight || 0);
      
      if (width > 0 && height > 0) {
        try {
          // Draw ImageBitmap to canvas
          ctx.drawImage(espFetchImageBitmap, 0, 0, canvas.width, canvas.height);
          
          // Test if canvas is not tainted
          // ImageBitmap from blob should never taint canvas
          try {
            ctx.getImageData(0, 0, 1, 1);
            // Success! ImageBitmap method works - no tainted canvas
            // Log success on first use
            if (!window._imageBitmapCaptureSuccessLogged) {
              console.log('[ESP32-CAM] ✅ ImageBitmap method working in captureFrame()!');
              console.log('[ESP32-CAM] ✅ Canvas tidak tainted - YOLO bisa memproses frame!');
              console.log(`[ESP32-CAM] ✅ ImageBitmap size: ${width}x${height}`);
              window._imageBitmapCaptureSuccessLogged = true;
            }
            // Clear any previous errors
            if (window._esp32CorsErrorShown) {
              window._esp32CorsErrorShown = false;
              if (typeof hideError === 'function') {
                hideError();
              }
            }
            return ctx;
          } catch (testError) {
            // Still tainted somehow - this should NEVER happen with ImageBitmap from blob
            // If this happens, it means ImageBitmap was created from tainted source
            const now = Date.now();
            if (!window._lastImageBitmapTaintedLog || now - window._lastImageBitmapTaintedLog > 10000) {
              console.error('[ESP32-CAM] ❌ ImageBitmap still tainted (CRITICAL ERROR)!', testError);
              console.error('[ESP32-CAM] 💡 This should NEVER happen - ImageBitmap from blob should not taint canvas');
              console.error('[ESP32-CAM] 💡 Possible cause: ImageBitmap was created from tainted img element');
              console.error('[ESP32-CAM] 💡 Solution: Ensure ImageBitmap is created from fetch blob, not from img element');
              window._lastImageBitmapTaintedLog = now;
            }
            // Don't return ctx - try next method
          }
        } catch (error) {
          // Error drawing ImageBitmap, try next method
          const now = Date.now();
          if (!window._lastImageBitmapDrawErrorLog || now - window._lastImageBitmapDrawErrorLog > 10000) {
            console.error('[ESP32-CAM] ❌ Error drawing ImageBitmap:', error);
            window._lastImageBitmapDrawErrorLog = now;
          }
        }
      } else {
        // ImageBitmap exists but has invalid dimensions
        const now = Date.now();
        if (!window._lastImageBitmapInvalidSizeLog || now - window._lastImageBitmapInvalidSizeLog > 10000) {
          console.warn('[ESP32-CAM] ⚠️ ImageBitmap has invalid dimensions:', width, 'x', height);
          window._lastImageBitmapInvalidSizeLog = now;
        }
      }
     } else {
       // ImageBitmap not available yet
       // Check if fetch method is active
       if (espFetchFrameActive) {
         // Fetch is active but hasn't gotten a frame yet - this is normal, just wait
         // Don't log error, just wait for fetch to succeed
         const now = Date.now();
         if (!window._lastImageBitmapWaitingLog || now - window._lastImageBitmapWaitingLog > 5000) {
           console.log('[ESP32-CAM] ⏳ Waiting for ImageBitmap from fetch method...');
           console.log('[ESP32-CAM] 💡 Fetch method sedang mengambil frame dari /capture endpoint');
           console.log('[ESP32-CAM] 💡 Ini normal - tunggu beberapa detik untuk frame pertama');
           console.log('[ESP32-CAM] 💡 espFetchFrameActive = ' + espFetchFrameActive);
           window._lastImageBitmapWaitingLog = now;
         }
       } else {
         // Fetch method not active - log warning
         const now = Date.now();
         if (!window._lastFetchNotActiveLog || now - window._lastFetchNotActiveLog > 10000) {
           console.warn('[ESP32-CAM] ⚠️ ImageBitmap method tidak aktif - fetch method belum dimulai');
           console.warn('[ESP32-CAM] 💡 espFetchFrameActive = ' + espFetchFrameActive);
           console.warn('[ESP32-CAM] 💡 Pastikan startFetchFrameCapture() dipanggil');
           window._lastFetchNotActiveLog = now;
         }
       }
     }
    
    // Method 2: Use buffer canvas (may be tainted if ESP32 doesn't send CORS)
    const img = document.getElementById('esp32-img');
    if (espBufferCanvas && espBufferHasFrame && 
        espBufferCanvas.width > 0 && espBufferCanvas.height > 0) {
      try {
        // Draw from buffer to canvas
        ctx.drawImage(espBufferCanvas, 0, 0, canvas.width, canvas.height);
        // Test if canvas is not tainted
        try {
          ctx.getImageData(0, 0, 1, 1);
          // Success! Buffer canvas works
          return ctx;
        } catch (taintedError) {
          // Buffer canvas is tainted, try ImageBitmap method or direct img
          // Don't log here - will be handled below
        }
      } catch (error) {
        // Error drawing from buffer, try next method
      }
    }
    
    // Method 3: Try direct img element (usually tainted without CORS)
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Test if canvas is tainted
        try {
          ctx.getImageData(0, 0, 1, 1);
          // Success! Direct img works (ESP32 must have CORS enabled)
          return ctx;
        } catch (taintedError) {
          // Canvas is tainted - all methods failed
          // Check if ImageBitmap method is still trying
          if (espFetchFrameActive && !espFetchImageBitmap) {
            // ImageBitmap method is active but hasn't gotten a frame yet
            // Don't log error - just wait for ImageBitmap method
            return null;
          }
          
          // All methods failed including ImageBitmap
          // Throttle logging to avoid console spam
          const now = Date.now();
          if (!window._lastTaintedCanvasWarningLog || now - window._lastTaintedCanvasWarningLog > 30000) {
            console.warn('⚠️ Canvas is tainted (CORS issue). ESP32-CAM tidak mengirim CORS headers.');
            console.warn('💡 SOLUSI: Aktifkan CORS di ESP32-CAM firmware (Access-Control-Allow-Origin: *)');
            console.warn('💡 Atau tunggu ImageBitmap method selesai memuat frame...');
            if (typeof showError === 'function') {
              showError('❌ Canvas is tainted - YOLO tidak dapat memproses frame.\n\n💡 SOLUSI:\n1. Aktifkan CORS di ESP32-CAM firmware\n2. Tambahkan: Access-Control-Allow-Origin: *');
            }
            window._lastTaintedCanvasWarningLog = now;
          }
          return null;
        }
      } catch (drawError) {
        // Throttle error logging
        const now = Date.now();
        if (!window._lastDrawErrorLog || now - window._lastDrawErrorLog > 10000) {
          console.warn('⚠️ Error drawing from img element:', drawError);
          window._lastDrawErrorLog = now;
        }
        return null;
      }
    }
    
    // Method 4: No frame available yet
    // Wait for ImageBitmap or buffer to be ready
    return null;
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
    esp32IpEl.textContent = ESP32_STATIC_IP;
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
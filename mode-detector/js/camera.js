/**
 * Camera Management
 * Handles webcam and ESP32-CAM streaming
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

// ESP32 Configuration
// Update IP address sesuai ESP32-CAM Anda
const ESP32_IP = '192.168.1.48';
// ESP32-S3 CAM biasanya menggunakan endpoint langsung
// Jika menggunakan proxy server, ganti dengan URL proxy Anda
const ESP32_STREAM_URL = `http://${ESP32_IP}:81/stream`;  // Port 81 untuk stream
const ESP32_CAPTURE_URL = `http://${ESP32_IP}/capture`;   // Port 80 untuk capture
// Fallback jika proxy digunakan (ganti dengan URL proxy jika ada)
const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;

// ESP32 buffer for offscreen canvas
let espBufferCanvas = null;
let espBufferHasFrame = false;
let espPollingTimer = null;
let espStreamReader = null; // For MJPEG stream reading
let espStreamAbortController = null; // For aborting stream requests

/**
 * Initialize webcam
 */
async function initWebcam() {
  if (cameraState.source !== 'webcam') return;

  const video = document.getElementById('video-element');
  if (!video) return;

  try {
    showLoading('Memulai webcam...');
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

    // Request webcam access
    const constraints = {
      video: {
        facingMode: cameraState.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    cameraState.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = cameraState.stream;
    video.play();

    video.onloadedmetadata = () => {
      console.log('✅ Webcam ready!');
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
      cameraState.isStreamReady = true;
      hideLoading();
      setCanvasSize(video.videoWidth, video.videoHeight);
      video.style.display = 'block';
      document.getElementById('esp32-img').style.display = 'none';
      
      // Auto-start live detection when camera is ready
      // Live detection should always be active
      if (typeof startLiveDetection === 'function') {
        startLiveDetection();
      }
    };

    video.onerror = (error) => {
      console.error('Webcam error:', error);
      cameraState.isStreamReady = false;
      showError('Webcam error occurred');
    };

  } catch (error) {
    console.error('Error accessing webcam:', error);
    cameraState.isStreamReady = false;
    showError(getErrorMessage(error));
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
 * Read MJPEG stream from ESP32-CAM
 * Uses simpler approach: directly set img.src to stream URL
 * Browser will handle MJPEG stream automatically if supported
 * Falls back to fast polling if direct stream doesn't work
 */
function readMJPEGStream() {
  const img = document.getElementById('esp32-img');
  if (!img) return;
  
  // Stop any existing stream first
  stopESP32Stream();
  
  console.log(`[ESP32-CAM] 📡 Starting MJPEG stream from: ${ESP32_STREAM_URL}`);
  
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
    if (!cameraState.isStreamReady) {
      cameraState.isStreamReady = true;
      hideLoading();
      hideError();
      cameraState.espErrorCount = 0;
      
      console.log(`[ESP32-CAM] ✅ Stream connected successfully`);
      console.log(`[ESP32-CAM] 📐 Frame dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
      
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
  
  // Set stream URL directly - browser should handle MJPEG automatically
  // Add timestamp only once to establish connection, then let stream continue
  const streamUrl = `${ESP32_STREAM_URL}?t=${Date.now()}`;
  console.log(`[ESP32-CAM] 📡 Setting stream URL: ${streamUrl}`);
  img.src = streamUrl;
  
  // Alternative: Fast polling method if direct stream doesn't work
  function startStreamPolling() {
    console.log(`[ESP32-CAM] 📡 Using fast polling method for stream`);
    
    function pollFrame() {
      if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
        return; // Stop if switched away
      }
      
      // Fast polling: request new frame every 50-100ms
      const timestamp = Date.now();
      const url = `${ESP32_STREAM_URL}?t=${timestamp}&frame=${frameCount}`;
      img.src = url;
      
      // Schedule next poll
      espPollingTimer = setTimeout(pollFrame, 70);
    }
    
    pollFrame();
  }
  
  // Monitor if stream is working (check if frames are updating)
  const streamMonitor = setInterval(() => {
    if (cameraState.source !== 'esp32' || cameraState.espEndpointMode !== 'stream') {
      clearInterval(streamMonitor);
      return;
    }
    
    // If no frames received in 5 seconds, try alternative method
    if (frameCount === 0 && Date.now() - streamStartTime > 5000) {
      console.warn(`[ESP32-CAM] ⚠️ No frames received, trying alternative method...`);
      clearInterval(streamMonitor);
      img.dataset.streamMethod = 'polling';
      startStreamPolling();
    }
  }, 1000);
}

/**
 * Initialize ESP32-CAM
 * Supports ESP32-CAM dengan konfigurasi IP dan endpoint
 * Uses different methods for stream vs capture mode
 */
function initESP32() {
  if (cameraState.source === 'webcam') return;

  const img = document.getElementById('esp32-img');
  if (!img) return;

  // Create offscreen buffer if not exists
  if (!espBufferCanvas) {
    espBufferCanvas = document.createElement('canvas');
  }

  showLoading(`Menghubungkan ke ESP32-CAM (${ESP32_IP})...`);
  cameraState.isStreamReady = false; // Set to false initially, will be true when frame loads
  cameraState.espErrorCount = 0;
  
  console.log(`[ESP32-CAM] 🔌 Initializing ESP32-CAM connection...`);
  console.log(`[ESP32-CAM] 📡 IP Address: ${ESP32_IP}`);
  console.log(`[ESP32-CAM] 📡 Stream URL: ${ESP32_STREAM_URL}`);
  console.log(`[ESP32-CAM] 📡 Capture URL: ${ESP32_CAPTURE_URL}`);
  console.log(`[ESP32-CAM] 📡 Mode: ${cameraState.espEndpointMode}`);
  
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
  
  function setNextSrc() {
    if (!img) return;
    // Gunakan URL langsung ke ESP32-CAM untuk capture mode
    // Tambahkan timestamp untuk menghindari cache browser
    const timestamp = Date.now();
    const url = `${ESP32_CAPTURE_URL}?t=${timestamp}`;
    
    console.log(`[ESP32-CAM] 📡 Fetching frame: ${url}`);
    img.src = url;
  }

  img.onload = () => {
    console.log(`[ESP32-CAM] ✅ Frame loaded successfully`);
    console.log(`[ESP32-CAM] 📐 Frame dimensions: ${img.naturalWidth}x${img.naturalHeight}`);
    
    // Set ready on first successful load
    if (!cameraState.isStreamReady) {
      cameraState.isStreamReady = true;
      hideLoading();
      hideError();
      
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
    console.error(`[ESP32-CAM] ❌ Frame error`);
    console.error(`[ESP32-CAM] ❌ Failed to load from: ${errorUrl}`);
    console.error(`[ESP32-CAM] 📡 IP Address: ${ESP32_IP}`);
    console.error(`[ESP32-CAM] 📡 Mode: ${cameraState.espEndpointMode}`);
    cameraState.espErrorCount += 1;

    // Auto fallback to capture mode after 3 errors in stream mode
    if (cameraState.espEndpointMode === 'stream' && cameraState.espErrorCount >= 3) {
      console.warn('⚠️ Switching ESP32-S3 CAM to capture mode (stream failed)');
      cameraState.espEndpointMode = 'capture';
      updateESP32Buttons();
    }

    const errorMsg = cameraState.espErrorCount <= 3
      ? `ESP32-S3 CAM connection failed (${cameraState.espErrorCount}/3). Retrying...`
      : `ESP32-S3 CAM connection failed. Check IP ${ESP32_IP} and endpoint.`;
    showError(errorMsg);
    
    const delay = cameraState.espEndpointMode === 'stream' ? 350 : 500;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };

  // Start polling
  setNextSrc();
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
 */
function switchCamera() {
  if (cameraState.source === 'webcam') {
    cameraState.facingMode = cameraState.facingMode === 'user' ? 'environment' : 'user';
    initCamera();
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
  
  // If switching to ESP32-CAM, log the IP address
  if (source === 'esp32') {
    console.log(`[Camera] 📡 Switching to ESP32-CAM at IP: ${ESP32_IP}`);
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
  
  const img = document.getElementById('esp32-img');
  // Check if img element has a valid frame
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return true;
  }
  // Fallback: check buffer
  return espBufferHasFrame && espBufferCanvas && 
         espBufferCanvas.width > 0 && espBufferCanvas.height > 0;
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
 */
function showError(message) {
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
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
 */
function getErrorMessage(error) {
  if (error.name === 'NotAllowedError') {
    return '❌ Akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser Anda.';
  } else if (error.name === 'NotFoundError') {
    return '❌ Kamera tidak ditemukan. Pastikan kamera terhubung dan tidak digunakan aplikasi lain.';
  } else if (error.name === 'NotReadableError') {
    return '❌ Kamera tidak dapat dibaca. Pastikan kamera tidak digunakan aplikasi lain.';
  } else if (error.name === 'OverconstrainedError') {
    return '❌ Kamera tidak mendukung resolusi yang diminta. Mencoba resolusi alternatif...';
  } else {
    return `❌ Error: ${error.message || 'Terjadi kesalahan yang tidak diketahui'}`;
  }
}

// Initialize ESP32 info
document.addEventListener('DOMContentLoaded', () => {
  const esp32IpEl = document.getElementById('esp32-ip');
  if (esp32IpEl) {
    esp32IpEl.textContent = ESP32_IP;
  }
});


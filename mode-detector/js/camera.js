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
const ESP32_IP = '192.168.1.19';
const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;

// ESP32 buffer for offscreen canvas
let espBufferCanvas = null;
let espBufferHasFrame = false;
let espPollingTimer = null;

/**
 * Initialize webcam
 */
async function initWebcam() {
  if (cameraState.source !== 'webcam') return;

  const video = document.getElementById('video-element');
  if (!video) return;

  try {
    showLoading('Starting webcam...');
    hideError();
    cameraState.isStreamReady = false;

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
 * Initialize ESP32-CAM
 */
function initESP32() {
  if (cameraState.source === 'webcam') return;

  const img = document.getElementById('esp32-img');
  if (!img) return;

  // Create offscreen buffer if not exists
  if (!espBufferCanvas) {
    espBufferCanvas = document.createElement('canvas');
  }

  showLoading('Connecting to ESP32-CAM...');
  cameraState.isStreamReady = true;
  cameraState.espErrorCount = 0;

  function setNextSrc() {
    if (!img) return;
    const url = cameraState.espEndpointMode === 'stream'
      ? `${ESP32_PROXY_STREAM_URL}?t=${Date.now()}`
      : `${ESP32_PROXY_CAPTURE_URL}?t=${Date.now()}`;
    img.src = url;
  }

  img.onload = () => {
    console.log('✅ ESP32 frame loaded');
    hideLoading();
    hideError();

    // Update buffer
    if (img.naturalWidth && img.naturalHeight) {
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

    // Schedule next frame
    const delay = cameraState.espEndpointMode === 'stream' ? 70 : 180;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };

  img.onerror = () => {
    console.error('ESP32 frame error');
    cameraState.espErrorCount += 1;

    // Auto fallback to capture mode after 3 errors in stream mode
    if (cameraState.espEndpointMode === 'stream' && cameraState.espErrorCount >= 3) {
      console.warn('Switching ESP32 to capture mode');
      cameraState.espEndpointMode = 'capture';
      updateESP32Buttons();
    }

    showError('ESP32-CAM connection failed. Retrying...');
    const delay = cameraState.espEndpointMode === 'stream' ? 350 : 500;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };

  // Start polling
  setNextSrc();
}

/**
 * Initialize camera based on current source
 */
function initCamera() {
  stopLiveDetection();
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
  if (source === cameraState.source) return;

  cameraState.source = source;
  updateCameraButtons();
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
 * Capture frame from camera
 * @returns {CanvasRenderingContext2D|null} Canvas context or null
 */
function captureFrame() {
  const canvas = document.getElementById('canvas-overlay');
  if (!canvas) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (cameraState.source !== 'webcam') {
    // ESP32 mode: use buffer
    if (!espBufferCanvas || !espBufferHasFrame) {
      return null;
    }
    ctx.drawImage(espBufferCanvas, 0, 0, canvas.width, canvas.height);
  } else {
    // Webcam mode
    const video = document.getElementById('video-element');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return null;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
  if (espPollingTimer) {
    clearTimeout(espPollingTimer);
    espPollingTimer = null;
  }
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
    return 'Camera permission denied. Please allow camera access.';
  } else if (error.name === 'NotFoundError') {
    return 'No camera found. Please connect a camera.';
  } else {
    return error.message || 'Unknown error occurred';
  }
}

// Initialize ESP32 info
document.addEventListener('DOMContentLoaded', () => {
  const esp32IpEl = document.getElementById('esp32-ip');
  if (esp32IpEl) {
    esp32IpEl.textContent = ESP32_IP;
  }
});


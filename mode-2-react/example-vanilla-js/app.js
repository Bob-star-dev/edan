/**
 * Object Detection Camera - Vanilla JavaScript Implementation
 * 
 * Ini adalah contoh implementasi vanilla JS dari React component
 * Semua core functionality tetap sama, hanya struktur code yang berbeda
 */

// ============================================================================
// APPLICATION STATE
// ============================================================================

const state = {
  inferenceTime: 0,
  totalTime: 0,
  isStreamReady: false,
  cameraSource: 'webcam',
  facingMode: 'user',
  modelName: 'yolov7-tiny_256x256.onnx',
  modelResolution: [256, 256],
  session: null,
  liveDetection: false,
  liveDetectionFrame: null
};

// Model configurations
const MODELS = [
  { name: 'yolov7-tiny_256x256.onnx', resolution: [256, 256] },
  { name: 'yolov7-tiny_320x320.onnx', resolution: [320, 320] },
  { name: 'yolov7-tiny_640x640.onnx', resolution: [640, 640] }
];

let currentModelIndex = 0;

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
  video: document.getElementById('video-element'),
  img: document.getElementById('esp32-img'),
  canvas: document.getElementById('canvas-overlay'),
  loadingIndicator: document.getElementById('loading-indicator'),
  errorMessage: document.getElementById('error-message'),
  inferenceTime: document.getElementById('inference-time'),
  totalTime: document.getElementById('total-time'),
  fps: document.getElementById('fps'),
  modelName: document.getElementById('model-name'),
  captureBtn: document.getElementById('capture-btn'),
  liveBtn: document.getElementById('live-detection-btn'),
  switchBtn: document.getElementById('switch-camera-btn'),
  resetBtn: document.getElementById('reset-btn'),
  modelBtn: document.getElementById('model-btn'),
  webcamBtn: document.getElementById('webcam-btn'),
  esp32Btn: document.getElementById('esp32-btn')
};

// ============================================================================
// CAMERA MANAGEMENT
// ============================================================================

let currentStream = null;
let espBufferCanvas = null;
let espBufferHasFrame = false;
const ESP32_IP = '192.168.1.19';
const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;
let espPollingTimer = null;
let espEndpointMode = 'stream';

/**
 * Initialize Webcam
 */
async function initWebcam() {
  if (state.cameraSource !== 'webcam') return;
  
  const video = elements.video;
  if (!video) return;
  
  try {
    showLoading('Starting webcam...');
    hideError();
    state.isStreamReady = false;
    
    // Stop existing stream
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    
    // Request webcam access
    const constraints = {
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };
    
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    video.play();
    
    video.onloadedmetadata = () => {
      console.log('✅ Webcam ready!');
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
      
      state.isStreamReady = true;
      hideLoading();
      
      // Set canvas size
      setCanvasSize(video.videoWidth, video.videoHeight);
      
      // Show video element
      video.style.display = 'block';
      elements.img.style.display = 'none';
    };
    
    video.onerror = (error) => {
      console.error('Webcam error:', error);
      state.isStreamReady = false;
      showError('Webcam error occurred');
    };
    
  } catch (error) {
    console.error('Error accessing webcam:', error);
    state.isStreamReady = false;
    showError(getErrorMessage(error));
  }
}

/**
 * Initialize ESP32-CAM
 */
function initESP32() {
  if (state.cameraSource === 'webcam') return;
  
  const img = elements.img;
  if (!img) return;
  
  // Create offscreen buffer if not exists
  if (!espBufferCanvas) {
    espBufferCanvas = document.createElement('canvas');
  }
  
  showLoading('Connecting to ESP32-CAM...');
  state.isStreamReady = true;
  
  function setNextSrc() {
    if (!img) return;
    const url = espEndpointMode === 'stream'
      ? `${ESP32_PROXY_STREAM_URL}?t=${Date.now()}`
      : `${ESP32_PROXY_CAPTURE_URL}?t=${Date.now()}`;
    img.src = url;
  }
  
  img.onload = () => {
    console.log('✅ ESP32 frame loaded');
    hideLoading();
    
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
    
    // Show image element
    img.style.display = 'block';
    elements.video.style.display = 'none';
    
    // Schedule next frame
    const delay = espEndpointMode === 'stream' ? 70 : 180;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };
  
  img.onerror = () => {
    console.error('ESP32 frame error');
    showError('ESP32-CAM connection failed');
    const delay = espEndpointMode === 'stream' ? 350 : 500;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };
  
  // Start polling
  setNextSrc();
}

/**
 * Initialize Camera (webcam or ESP32)
 */
function initCamera() {
  stopLiveDetection();
  
  if (state.cameraSource === 'webcam') {
    initWebcam();
  } else {
    initESP32();
  }
}

/**
 * Cleanup camera resources
 */
function cleanupCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  if (espPollingTimer) {
    clearTimeout(espPollingTimer);
    espPollingTimer = null;
  }
}

/**
 * Set Canvas Size
 */
function setCanvasSize(width, height) {
  const canvas = elements.canvas;
  const container = document.querySelector('.camera-container');
  
  if (!canvas || !container) return;
  
  const containerWidth = container.offsetWidth - 40; // Account for padding
  const aspectRatio = height / width;
  
  canvas.width = containerWidth;
  canvas.height = containerWidth * aspectRatio;
  canvas.style.width = containerWidth + 'px';
  canvas.style.height = (containerWidth * aspectRatio) + 'px';
}

// ============================================================================
// MODEL MANAGEMENT
// ============================================================================

/**
 * Configure ONNX Runtime
 */
function configureONNXRuntime() {
  if (typeof ort !== 'undefined') {
    ort.env.wasm.wasmPaths = '/static/wasm/';
    ort.env.wasm.simd = false;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    console.log('ONNX Runtime configured');
  } else {
    console.error('ONNX Runtime not loaded!');
  }
}

/**
 * Load Model
 */
async function loadModel(modelName) {
  try {
    console.log(`Loading model: /static/models/${modelName}`);
    showLoading(`Loading model: ${modelName}...`);
    
    const session = await ort.InferenceSession.create(
      `/static/models/${modelName}`,
      {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      }
    );
    
    state.session = session;
    state.modelName = modelName;
    
    // Update model name in UI
    elements.modelName.textContent = modelName.replace('.onnx', '');
    
    console.log('✅ Model loaded successfully');
    hideLoading();
    
    return session;
  } catch (error) {
    console.error('Error loading model:', error);
    showError(`Failed to load model: ${error.message}`);
    throw error;
  }
}

/**
 * Change Model
 */
function changeModel() {
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  const model = MODELS[currentModelIndex];
  state.modelResolution = model.resolution;
  loadModel(model.name);
}

// ============================================================================
// IMAGE PROCESSING
// ============================================================================

/**
 * Capture Frame from Camera
 */
function capture() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (state.cameraSource !== 'webcam') {
    // ESP32 mode: use buffer
    if (!espBufferCanvas || !espBufferHasFrame) {
      return null;
    }
    ctx.drawImage(espBufferCanvas, 0, 0, canvas.width, canvas.height);
  } else {
    // Webcam mode
    const video = elements.video;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return null;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  
  return ctx;
}

/**
 * Preprocess Image for Model
 * Note: Ini adalah versi simplified. Versi lengkap perlu ndarray library
 */
function preprocess(ctx, modelResolution) {
  // Create temporary canvas with model resolution
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = modelResolution[0];
  tempCanvas.height = modelResolution[1];
  const tempCtx = tempCanvas.getContext('2d');
  
  // Draw and scale image
  tempCtx.drawImage(ctx.canvas, 0, 0, modelResolution[0], modelResolution[1]);
  
  // Get image data
  const imageData = tempCtx.getImageData(0, 0, modelResolution[0], modelResolution[1]);
  const { data, width, height } = imageData;
  
  // Convert to tensor format [1, 3, height, width]
  // Normalize pixel values from [0-255] to [0-1]
  const tensorData = new Float32Array(width * height * 3);
  
  for (let i = 0; i < width * height; i++) {
    tensorData[i] = data[i * 4] / 255.0;     // R
    tensorData[i + width * height] = data[i * 4 + 1] / 255.0; // G
    tensorData[i + width * height * 2] = data[i * 4 + 2] / 255.0; // B
    // Skip alpha channel (data[i * 4 + 3])
  }
  
  return new ort.Tensor('float32', tensorData, [1, 3, height, width]);
}

/**
 * Postprocess Model Output (Simplified - YOLOv7 format)
 */
function postprocess(outputTensor, inferenceTime, ctx, modelName) {
  const dx = ctx.canvas.width / state.modelResolution[0];
  const dy = ctx.canvas.height / state.modelResolution[1];
  
  // Clear previous drawings
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  
  // YOLOv7 output format: [det_num, 7]
  // Each detection: [batch_id, x0, y0, x1, y1, class_id, confidence]
  const detectionData = outputTensor.data;
  const numDetections = outputTensor.dims[0];
  
  for (let i = 0; i < numDetections; i++) {
    const offset = i * 7;
    const batchId = detectionData[offset];
    const x0 = detectionData[offset + 1];
    const y0 = detectionData[offset + 2];
    const x1 = detectionData[offset + 3];
    const y1 = detectionData[offset + 4];
    const classId = Math.round(detectionData[offset + 5]);
    const confidence = detectionData[offset + 6];
    
    // Filter by confidence threshold
    if (confidence < 0.25) continue;
    
    // Scale to canvas size
    const scaledX0 = x0 * dx;
    const scaledY0 = y0 * dy;
    const scaledX1 = x1 * dx;
    const scaledY1 = y1 * dy;
    
    // Draw bounding box
    const color = conf2color(confidence);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(scaledX0, scaledY0, scaledX1 - scaledX0, scaledY1 - scaledY0);
    
    // Draw label
    const label = `Class ${classId} ${Math.round(confidence * 100)}%`;
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(label, scaledX0 + 5, scaledY0 - 10);
    ctx.fillText(label, scaledX0 + 5, scaledY0 - 10);
    
    // Fill with transparent color
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
    ctx.fillRect(scaledX0, scaledY0, scaledX1 - scaledX0, scaledY1 - scaledY0);
  }
}

/**
 * Confidence to Color
 */
function conf2color(conf) {
  const r = Math.round(255 * (1 - conf));
  const g = Math.round(255 * conf);
  return `rgb(${r},${g},0)`;
}

// ============================================================================
// DETECTION
// ============================================================================

/**
 * Run Single Detection
 */
async function runDetection() {
  if (!state.session) {
    console.warn('Model not loaded yet');
    showError('Model not loaded. Please wait...');
    return;
  }
  
  if (!state.isStreamReady) {
    console.warn('Camera not ready');
    showError('Camera not ready. Please wait...');
    return;
  }
  
  const startTime = Date.now();
  const ctx = capture();
  
  if (!ctx) {
    console.warn('Failed to capture frame');
    return;
  }
  
  try {
    // Preprocess
    const inputTensor = preprocess(ctx, state.modelResolution);
    
    // Inference
    const feeds = {};
    feeds[state.session.inputNames[0]] = inputTensor;
    const outputData = await state.session.run(feeds);
    const outputTensor = outputData[state.session.outputNames[0]];
    const inferenceTime = Date.now() - startTime;
    
    // Postprocess
    postprocess(outputTensor, inferenceTime, ctx, state.modelName);
    
    // Update stats
    state.inferenceTime = inferenceTime;
    state.totalTime = Date.now() - startTime;
    updateStats();
    
    hideError();
  } catch (error) {
    console.error('Detection error:', error);
    showError(`Detection failed: ${error.message}`);
  }
}

/**
 * Start Live Detection
 */
function startLiveDetection() {
  if (state.liveDetection) {
    stopLiveDetection();
    return;
  }
  
  state.liveDetection = true;
  elements.liveBtn.textContent = '⏸️ Stop Detection';
  
  function loop() {
    if (!state.liveDetection) return;
    
    runDetection().then(() => {
      if (state.liveDetection) {
        state.liveDetectionFrame = requestAnimationFrame(loop);
      }
    });
  }
  
  loop();
}

/**
 * Stop Live Detection
 */
function stopLiveDetection() {
  state.liveDetection = false;
  if (state.liveDetectionFrame) {
    cancelAnimationFrame(state.liveDetectionFrame);
    state.liveDetectionFrame = null;
  }
  elements.liveBtn.textContent = '▶️ Live Detection';
}

/**
 * Reset Canvas
 */
function reset() {
  stopLiveDetection();
  const ctx = elements.canvas.getContext('2d');
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.inferenceTime = 0;
  state.totalTime = 0;
  updateStats();
  hideError();
}

// ============================================================================
// UI UPDATES
// ============================================================================

/**
 * Update Stats Display
 */
function updateStats() {
  elements.inferenceTime.textContent = state.inferenceTime;
  elements.totalTime.textContent = state.totalTime;
  const fps = state.totalTime > 0 ? (1000 / state.totalTime).toFixed(1) : '0';
  elements.fps.textContent = fps;
}

/**
 * Update Camera Source
 */
function updateCameraSource(source) {
  state.cameraSource = source;
  
  // Update button states
  if (source === 'webcam') {
    elements.webcamBtn.classList.add('active');
    elements.esp32Btn.classList.remove('active');
  } else {
    elements.esp32Btn.classList.add('active');
    elements.webcamBtn.classList.remove('active');
  }
  
  // Reinitialize camera
  initCamera();
}

/**
 * Show/Hide Loading
 */
function showLoading(message = 'Loading...') {
  elements.loadingIndicator.style.display = 'block';
  elements.loadingIndicator.querySelector('div').textContent = message;
}

function hideLoading() {
  elements.loadingIndicator.style.display = 'none';
}

/**
 * Show/Hide Error
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.style.display = 'block';
}

function hideError() {
  elements.errorMessage.style.display = 'none';
}

/**
 * Get Error Message
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

// ============================================================================
// EVENT LISTENERS
// ============================================================================

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Capture button
  elements.captureBtn.addEventListener('click', async () => {
    await runDetection();
  });
  
  // Live detection button
  elements.liveBtn.addEventListener('click', () => {
    startLiveDetection();
  });
  
  // Switch camera button (only for webcam)
  elements.switchBtn.addEventListener('click', () => {
    if (state.cameraSource === 'webcam') {
      state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
      initCamera();
    }
  });
  
  // Reset button
  elements.resetBtn.addEventListener('click', () => {
    reset();
  });
  
  // Model button
  elements.modelBtn.addEventListener('click', () => {
    changeModel();
  });
  
  // Camera source buttons
  elements.webcamBtn.addEventListener('click', () => {
    updateCameraSource('webcam');
  });
  
  elements.esp32Btn.addEventListener('click', () => {
    updateCameraSource('esp32');
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Application
 */
async function init() {
  console.log('🚀 Initializing application...');
  
  // Configure ONNX Runtime
  configureONNXRuntime();
  
  // Setup event listeners
  setupEventListeners();
  
  // Load initial model
  try {
    await loadModel(state.modelName);
  } catch (error) {
    console.error('Failed to load initial model:', error);
  }
  
  // Initialize camera
  initCamera();
  
  console.log('✅ Application initialized');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupCamera();
  stopLiveDetection();
});


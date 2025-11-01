# Panduan Konversi ke Vanilla HTML/CSS/JavaScript

## ✅ YA, BISA DIUBAH!

Sistem camera detection **bisa diubah** menjadi native HTML/CSS/JS karena:

1. **Core functionality menggunakan Web APIs standar:**
   - ✅ Canvas API (native browser)
   - ✅ MediaDevices API (native browser)
   - ✅ ONNX Runtime Web (library JS, tidak depend React)
   - ✅ Fetch API untuk ESP32

2. **React hanya wrapper untuk:**
   - State management → bisa pakai variabel biasa
   - Lifecycle hooks → bisa pakai event listeners
   - DOM references → bisa pakai querySelector

---

## 🔄 Mapping React → Vanilla JS

### 1. State Management

**React (sebelum):**
```tsx
const [inferenceTime, setInferenceTime] = useState<number>(0);
const [isStreamReady, setIsStreamReady] = useState<boolean>(false);
```

**Vanilla JS (sesudah):**
```javascript
// State sebagai object biasa
const state = {
  inferenceTime: 0,
  isStreamReady: false,
  cameraSource: 'webcam',
  // ... state lainnya
};

// Setter function dengan DOM update
function setInferenceTime(value) {
  state.inferenceTime = value;
  updateUI(); // Update DOM setelah state berubah
}

function setIsStreamReady(value) {
  state.isStreamReady = value;
  updateStreamStatus(); // Update loading indicator
}
```

### 2. DOM References

**React (sebelum):**
```tsx
const videoRef = useRef<HTMLVideoElement>(null);
const canvasRef = useRef<HTMLCanvasElement>(null);
```

**Vanilla JS (sesudah):**
```javascript
// Langsung ambil dari DOM
const videoRef = document.getElementById('video-element');
const canvasRef = document.getElementById('canvas-element');

// Atau dengan querySelector
const videoRef = document.querySelector('#video-element');
const canvasRef = document.querySelector('#canvas-element');
```

### 3. Lifecycle Hooks (useEffect)

**React (sebelum):**
```tsx
useEffect(() => {
  if (cameraSource !== 'webcam' || !videoRef.current) return;
  
  const startWebcam = async () => {
    // ... logic
  };
  
  startWebcam();
  
  return () => {
    // Cleanup
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };
}, [cameraSource, facingMode]);
```

**Vanilla JS (sesudah):**
```javascript
// Initialize saat halaman load
function initWebcam() {
  if (state.cameraSource !== 'webcam') return;
  
  const video = document.getElementById('video-element');
  if (!video) return;
  
  let stream = null;
  
  const startWebcam = async () => {
    try {
      const constraints = {
        video: {
          facingMode: state.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.play();
      
      video.onloadedmetadata = () => {
        state.isStreamReady = true;
        updateUI();
      };
    } catch (error) {
      console.error('Error accessing webcam:', error);
    }
  };
  
  startWebcam();
  
  // Cleanup saat halaman unload
  window.addEventListener('beforeunload', () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  });
}

// Panggil saat DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initWebcam();
});
```

### 4. Event Handlers

**React (sebelum):**
```tsx
<button
  onClick={async () => {
    await processImage();
  }}
>
  Capture
</button>
```

**Vanilla JS (sesudah):**
```javascript
// HTML
<button id="capture-btn">Capture</button>

// JavaScript
document.getElementById('capture-btn').addEventListener('click', async () => {
  await processImage();
});
```

### 5. Conditional Rendering

**React (sebelum):**
```tsx
{!isStreamReady && (
  <div>Loading...</div>
)}
{videoSource === 'webcam' && (
  <video ref={videoRef} />
)}
```

**Vanilla JS (sesudah):**
```javascript
// HTML
<div id="loading-indicator" style="display: none;">
  Loading...
</div>
<video id="video-element" style="display: none;"></video>

// JavaScript
function updateUI() {
  const loadingEl = document.getElementById('loading-indicator');
  const videoEl = document.getElementById('video-element');
  
  if (state.isStreamReady) {
    loadingEl.style.display = 'none';
    if (state.cameraSource === 'webcam') {
      videoEl.style.display = 'block';
    }
  } else {
    loadingEl.style.display = 'block';
    videoEl.style.display = 'none';
  }
}
```

---

## 📁 Struktur File Vanilla JS

```
camera-detection-vanilla/
├── index.html          # HTML structure
├── styles/
│   └── main.css        # CSS styling
├── js/
│   ├── app.js          # Main application logic
│   ├── camera.js       # Camera management
│   ├── model.js        # Model loading & inference
│   ├── preprocessing.js # Image preprocessing
│   ├── postprocessing.js # Detection postprocessing
│   ├── distance.js     # Distance estimation
│   └── utils.js        # Utility functions
├── static/
│   ├── models/         # ONNX model files
│   └── wasm/           # ONNX Runtime WASM files
└── api/
    └── esp32-capture.js # ESP32 proxy (jika perlu)
```

---

## 🔧 Dependencies yang Tetap Diperlukan

### 1. ONNX Runtime Web (CDN atau npm)
```html
<!-- Via CDN -->
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>

<!-- Atau via npm/bundler -->
import * as ort from 'onnxruntime-web';
```

### 2. NDArray (untuk tensor operations)
```html
<!-- Via CDN -->
<script src="https://cdn.jsdelivr.net/npm/ndarray@1/dist/ndarray.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/ndarray-ops@1/dist/ndarray-ops.min.js"></script>
```

### 3. Lodash (optional, untuk utility)
```html
<script src="https://cdn.jsdelivr.net/npm/lodash@4/dist/lodash.min.js"></script>
```

---

## 📝 Contoh Implementasi Sederhana

### index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Object Detection - Vanilla JS</title>
  <link rel="stylesheet" href="styles/main.css">
</head>
<body>
  <div class="container">
    <!-- Camera Container -->
    <div id="camera-container" class="camera-container">
      <div id="loading-indicator" class="loading">Loading camera...</div>
      <video id="video-element" autoplay playsinline muted></video>
      <img id="esp32-img" style="display: none;" crossorigin="anonymous">
      <canvas id="canvas-overlay"></canvas>
    </div>
    
    <!-- Controls -->
    <div class="controls">
      <button id="capture-btn">Capture</button>
      <button id="live-detection-btn">Live Detection</button>
      <button id="switch-camera-btn">Switch Camera</button>
      <button id="reset-btn">Reset</button>
      
      <!-- Camera Source Toggle -->
      <div class="camera-source">
        <button id="webcam-btn" class="active">Webcam</button>
        <button id="esp32-btn">ESP32-CAM</button>
      </div>
    </div>
    
    <!-- Stats -->
    <div class="stats">
      <div class="stat-item">
        <span class="stat-label">Inference:</span>
        <span id="inference-time">0</span>ms
      </div>
      <div class="stat-item">
        <span class="stat-label">Total:</span>
        <span id="total-time">0</span>ms
      </div>
      <div class="stat-item">
        <span class="stat-label">FPS:</span>
        <span id="fps">0</span>
      </div>
    </div>
  </div>
  
  <!-- Scripts -->
  <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ndarray@1/dist/ndarray.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ndarray-ops@1/dist/ndarray-ops.min.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/distance.js"></script>
  <script src="js/preprocessing.js"></script>
  <script src="js/postprocessing.js"></script>
  <script src="js/model.js"></script>
  <script src="js/camera.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

### js/app.js (Main Application)
```javascript
// Application State
const state = {
  inferenceTime: 0,
  totalTime: 0,
  isStreamReady: false,
  cameraSource: 'webcam',
  facingMode: 'user',
  modelName: 'yolov7-tiny_256x256.onnx',
  modelResolution: [256, 256],
  session: null,
  liveDetection: false
};

// DOM Elements
const elements = {
  video: document.getElementById('video-element'),
  img: document.getElementById('esp32-img'),
  canvas: document.getElementById('canvas-overlay'),
  loadingIndicator: document.getElementById('loading-indicator'),
  inferenceTime: document.getElementById('inference-time'),
  totalTime: document.getElementById('total-time'),
  fps: document.getElementById('fps'),
  captureBtn: document.getElementById('capture-btn'),
  liveBtn: document.getElementById('live-detection-btn'),
  switchBtn: document.getElementById('switch-camera-btn'),
  resetBtn: document.getElementById('reset-btn'),
  webcamBtn: document.getElementById('webcam-btn'),
  esp32Btn: document.getElementById('esp32-btn')
};

// Initialize ONNX Runtime
if (typeof ort !== 'undefined') {
  ort.env.wasm.wasmPaths = '/static/wasm/';
  ort.env.wasm.simd = false;
  ort.env.wasm.numThreads = 1;
}

// Load Model
async function loadModel(modelName) {
  try {
    console.log(`Loading model: /static/models/${modelName}`);
    const session = await ort.InferenceSession.create(
      `/static/models/${modelName}`,
      {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      }
    );
    state.session = session;
    console.log('Model loaded successfully');
  } catch (error) {
    console.error('Error loading model:', error);
  }
}

// Capture Frame
function capture() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (state.cameraSource !== 'webcam') {
    // ESP32 mode
    const buffer = espBufferCanvas; // Offscreen buffer
    if (!buffer) return null;
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
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

// Run Detection
async function runDetection() {
  if (!state.session) {
    console.warn('Model not loaded yet');
    return;
  }
  
  const ctx = capture();
  if (!ctx) return;
  
  const startTime = Date.now();
  
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
}

// Live Detection Loop
let liveDetectionInterval = null;

function startLiveDetection() {
  if (state.liveDetection) {
    stopLiveDetection();
    return;
  }
  
  state.liveDetection = true;
  elements.liveBtn.textContent = 'Stop Detection';
  
  function loop() {
    if (!state.liveDetection) return;
    runDetection().then(() => {
      if (state.liveDetection) {
        requestAnimationFrame(loop);
      }
    });
  }
  
  loop();
}

function stopLiveDetection() {
  state.liveDetection = false;
  elements.liveBtn.textContent = 'Live Detection';
}

// Update UI
function updateStats() {
  elements.inferenceTime.textContent = state.inferenceTime;
  elements.totalTime.textContent = state.totalTime;
  const fps = state.totalTime > 0 ? (1000 / state.totalTime).toFixed(1) : '0';
  elements.fps.textContent = fps;
}

function updateCameraSource(source) {
  state.cameraSource = source;
  
  // Update button states
  if (source === 'webcam') {
    elements.webcamBtn.classList.add('active');
    elements.esp32Btn.classList.remove('active');
    elements.video.style.display = 'block';
    elements.img.style.display = 'none';
  } else {
    elements.esp32Btn.classList.add('active');
    elements.webcamBtn.classList.remove('active');
    elements.video.style.display = 'none';
    elements.img.style.display = 'block';
  }
  
  // Reinitialize camera
  stopLiveDetection();
  initCamera();
}

// Event Listeners
elements.captureBtn.addEventListener('click', async () => {
  await runDetection();
});

elements.liveBtn.addEventListener('click', () => {
  startLiveDetection();
});

elements.resetBtn.addEventListener('click', () => {
  stopLiveDetection();
  const ctx = elements.canvas.getContext('2d');
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.inferenceTime = 0;
  state.totalTime = 0;
  updateStats();
});

elements.webcamBtn.addEventListener('click', () => {
  updateCameraSource('webcam');
});

elements.esp32Btn.addEventListener('click', () => {
  updateCameraSource('esp32');
});

elements.switchBtn.addEventListener('click', () => {
  if (state.cameraSource === 'webcam') {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    initCamera();
  }
});

// Initialize Application
async function init() {
  console.log('Initializing application...');
  
  // Load model
  await loadModel(state.modelName);
  
  // Initialize camera
  initCamera();
  
  console.log('Application initialized');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

### js/camera.js (Camera Management)
```javascript
let currentStream = null;
let espBufferCanvas = null;
let espBufferHasFrame = false;
const ESP32_IP = '192.168.1.19';
const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;
let espPollingTimer = null;
let espEndpointMode = 'stream';

// Initialize Webcam
async function initWebcam() {
  if (state.cameraSource !== 'webcam') return;
  
  const video = elements.video;
  if (!video) return;
  
  try {
    state.isStreamReady = false;
    updateLoadingIndicator(true);
    
    // Stop existing stream
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
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
      state.isStreamReady = true;
      updateLoadingIndicator(false);
      setCanvasSize(video.videoWidth, video.videoHeight);
    };
    
    video.onerror = (error) => {
      console.error('Webcam error:', error);
      state.isStreamReady = false;
      updateLoadingIndicator(true, 'Webcam error');
    };
    
  } catch (error) {
    console.error('Error accessing webcam:', error);
    state.isStreamReady = false;
    updateLoadingIndicator(true, getErrorMessage(error));
  }
}

// Initialize ESP32-CAM
function initESP32() {
  if (state.cameraSource === 'webcam') return;
  
  const img = elements.img;
  if (!img) return;
  
  // Create offscreen buffer
  if (!espBufferCanvas) {
    espBufferCanvas = document.createElement('canvas');
  }
  
  state.isStreamReady = true; // Optimistically show
  updateLoadingIndicator(false);
  
  function setNextSrc() {
    if (!img) return;
    const url = espEndpointMode === 'stream'
      ? `${ESP32_PROXY_STREAM_URL}?t=${Date.now()}`
      : `${ESP32_PROXY_CAPTURE_URL}?t=${Date.now()}`;
    img.src = url;
  }
  
  img.onload = () => {
    console.log('✅ ESP32 frame loaded');
    
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
    
    // Schedule next frame
    const delay = espEndpointMode === 'stream' ? 70 : 180;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };
  
  img.onerror = () => {
    console.error('ESP32 frame error');
    const delay = espEndpointMode === 'stream' ? 350 : 500;
    if (espPollingTimer) clearTimeout(espPollingTimer);
    espPollingTimer = setTimeout(setNextSrc, delay);
  };
  
  // Start polling
  setNextSrc();
}

// Initialize Camera (webcam or ESP32)
function initCamera() {
  if (state.cameraSource === 'webcam') {
    initWebcam();
  } else {
    initESP32();
  }
}

// Cleanup
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

// Set Canvas Size
function setCanvasSize(width, height) {
  const canvas = elements.canvas;
  if (!canvas) return;
  
  const container = document.getElementById('camera-container');
  if (container) {
    const containerWidth = container.offsetWidth;
    const aspectRatio = height / width;
    canvas.width = containerWidth;
    canvas.height = containerWidth * aspectRatio;
  }
}

// Update Loading Indicator
function updateLoadingIndicator(show, message = 'Loading...') {
  const indicator = elements.loadingIndicator;
  if (indicator) {
    indicator.style.display = show ? 'block' : 'none';
    indicator.textContent = message;
  }
}

// Get Error Message
function getErrorMessage(error) {
  if (error.name === 'NotAllowedError') {
    return 'Camera permission denied';
  } else if (error.name === 'NotFoundError') {
    return 'No camera found';
  } else {
    return error.message || 'Unknown error';
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupCamera);
```

---

## ✅ Keuntungan Konversi ke Vanilla JS

1. **Lebih Ringan**: Tidak perlu bundle React (~40KB)
2. **Lebih Cepat**: Tidak ada overhead virtual DOM
3. **Lebih Sederhana**: Tidak perlu build step (jika pakai CDN)
4. **Lebih Universal**: Bisa langsung di-hosting di static hosting
5. **Lebih Mudah Debug**: Code langsung, tidak ada abstraction layer

---

## ⚠️ Hal yang Perlu Diperhatikan

1. **State Management**: Harus manual update DOM setelah state berubah
2. **Event Cleanup**: Harus manual remove event listeners
3. **No TypeScript**: Harus pakai JSDoc atau skip type checking
4. **Manual DOM Updates**: Tidak ada reactive updates otomatis

---

## 🚀 Kesimpulan

**BISA DIUBAH!** Sistem ini sangat cocok untuk vanilla JS karena:

- ✅ Core functionality tidak depend pada React
- ✅ Menggunakan Web APIs standar
- ✅ Library dependencies (ONNX, NDArray) bisa pakai CDN
- ✅ Struktur code bisa langsung diadaptasi

Yang perlu diubah hanya:
- React state → JavaScript objects
- useEffect → event listeners & init functions
- JSX → HTML templates
- React components → JavaScript modules


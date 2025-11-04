/**
 * Main Application
 * Coordinates all components and handles user interactions
 */

// Application State
const appState = {
  inferenceTime: 0,
  totalTime: 0,
  liveDetection: false,
  liveDetectionFrame: null,
  focalLength: (typeof DEFAULT_FOCAL_LENGTH !== 'undefined' ? DEFAULT_FOCAL_LENGTH : 600)
};

// DOM Elements (will be initialized in init)
let elements = {};

/**
 * Initialize DOM elements
 */
function initElements() {
  elements = {
    // Camera elements
    video: document.getElementById('video-element'),
    img: document.getElementById('esp32-img'),
    canvas: document.getElementById('canvas-overlay'),
    
    // Control buttons
    captureBtn: document.getElementById('capture-btn'),
    switchBtn: document.getElementById('switch-camera-btn'),
    resetBtn: document.getElementById('reset-btn'),
    modelBtn: document.getElementById('model-btn'),
    webcamBtn: document.getElementById('webcam-btn'),
    esp32Btn: document.getElementById('esp32-btn'),
    esp32StreamBtn: document.getElementById('esp32-stream-btn'),
    esp32CaptureBtn: document.getElementById('esp32-capture-btn'),
    
    // Display elements
    modelName: document.getElementById('model-name'),
    modelResolution: document.getElementById('model-resolution'),
    inferenceTime: document.getElementById('inference-time'),
    totalTime: document.getElementById('total-time'),
    fps: document.getElementById('fps'),
    modelFps: document.getElementById('model-fps'),
    efficiency: document.getElementById('efficiency'),
    overhead: document.getElementById('overhead')
  };
}

/**
 * Run single detection
 * Handles the complete detection pipeline: capture, preprocess, infer, postprocess
 */
async function runDetection() {
  // Check if model is loaded
  if (!currentSession) {
    console.warn('❌ Model not loaded yet');
    showError('Model not loaded. Please wait for model to initialize...');
    return;
  }

  // Check if camera is ready
  if (!cameraState.isStreamReady) {
    console.warn('❌ Camera not ready');
    const errorMsg = cameraState.source === 'webcam' 
      ? 'Camera not ready. Please allow camera permission or check camera connection.'
      : 'ESP32-CAM not ready. Please check connection or switch to webcam.';
    showError(errorMsg);
    return;
  }

  const startTime = Date.now();
  
  // Capture frame from camera
  const ctx = captureFrame();
  if (!ctx) {
    console.warn('❌ Failed to capture frame');
    const errorMsg = cameraState.source === 'webcam'
      ? 'Failed to capture from webcam. Make sure video is playing.'
      : 'Failed to capture from ESP32-CAM. Check connection or try capture mode.';
    showError(errorMsg);
    return;
  }

  try {
    // Get current model configuration
    const model = getCurrentModel();
    if (!model) {
      throw new Error('No model selected');
    }
    console.log(`🔍 Running detection with model: ${model.name} (${model.resolution[0]}×${model.resolution[1]})`);

    // Preprocess: Convert canvas frame to tensor
    let inputTensor;
    try {
      inputTensor = preprocess(ctx, model.resolution);
      console.log('✅ Preprocessing completed');
    } catch (preprocessError) {
      console.error('❌ Preprocessing failed:', preprocessError);
      throw new Error(`Preprocessing failed: ${preprocessError.message}`);
    }

    // Inference: Run model inference
    let outputTensor, inferenceTime;
    try {
      [outputTensor, inferenceTime] = await runInference(currentSession, inputTensor);
      console.log(`✅ Inference completed in ${inferenceTime.toFixed(1)}ms`);
    } catch (inferenceError) {
      console.error('❌ Inference failed:', inferenceError);
      throw new Error(`Inference failed: ${inferenceError.message}`);
    }

    // Postprocess: Draw bounding boxes and labels
    try {
      postprocess(
        model.name,
        ctx,
        model.resolution,
        outputTensor,
        inferenceTime,
        appState.focalLength
      );
      console.log('✅ Postprocessing completed - detections drawn');
    } catch (postprocessError) {
      console.error('❌ Postprocessing failed:', postprocessError);
      throw new Error(`Postprocessing failed: ${postprocessError.message}`);
    }

    // Update performance statistics
    appState.inferenceTime = inferenceTime;
    appState.totalTime = Date.now() - startTime;
    updateStats();

    // Clear any previous errors
    hideError();
    
    console.log(`✅ Detection completed successfully (Total: ${appState.totalTime.toFixed(1)}ms)`);
  } catch (error) {
    console.error('❌ Detection error:', error);
    console.error('Error stack:', error.stack);
    showError(`Detection failed: ${error.message}`);
    
    // Log additional diagnostic information
    console.log('Diagnostic info:', {
      modelLoaded: !!currentSession,
      cameraReady: cameraState.isStreamReady,
      cameraSource: cameraState.source,
      canvasExists: !!elements.canvas,
      currentModel: getCurrentModel()?.name || 'none'
    });
  }
}

/**
 * Start live detection loop
 * Live detection is now always active and cannot be stopped
 */
function startLiveDetection() {
  // Prevent multiple detection loops from running
  if (appState.liveDetection) {
    return;
  }

  appState.liveDetection = true;

  function loop() {
    if (!appState.liveDetection) return;

    // For ESP32 mode, ensure we wait a bit for frame to be ready
    // This prevents race conditions where detection runs before frame is loaded
    if (cameraState.source !== 'webcam' && typeof isESP32FrameReady === 'function' && !isESP32FrameReady()) {
      // Wait a bit and retry if frame not ready
      setTimeout(() => {
        if (appState.liveDetection) {
          appState.liveDetectionFrame = requestAnimationFrame(loop);
        }
      }, 50);
      return;
    }

    runDetection().then(() => {
      if (appState.liveDetection) {
        appState.liveDetectionFrame = requestAnimationFrame(loop);
      }
    }).catch((error) => {
      // Handle errors gracefully and continue loop
      console.warn('Detection error in loop, continuing...', error);
      if (appState.liveDetection) {
        // Add small delay before retry to avoid overwhelming ESP32
        const retryDelay = cameraState.source === 'webcam' ? 0 : 100;
        setTimeout(() => {
          if (appState.liveDetection) {
            appState.liveDetectionFrame = requestAnimationFrame(loop);
          }
        }, retryDelay);
      }
    });
  }

  loop();
}

/**
 * Stop live detection
 * Note: This function is kept for cleanup purposes only (e.g., page unload)
 * Live detection cannot be stopped during normal operation
 */
function stopLiveDetection() {
  appState.liveDetection = false;
  if (appState.liveDetectionFrame) {
    cancelAnimationFrame(appState.liveDetectionFrame);
    appState.liveDetectionFrame = null;
  }
}

/**
 * Reset canvas and stats
 * Note: Live detection continues running - only clears canvas and stats
 */
function reset() {
  // Don't stop live detection - it should always be running
  const ctx = elements.canvas?.getContext('2d');
  if (ctx && elements.canvas) {
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  }
  appState.inferenceTime = 0;
  appState.totalTime = 0;
  updateStats();
  hideError();
}

/**
 * Change model handler
 * This function handles user interaction to switch to the next model.
 * It directly accesses MODELS and currentModelIndex from model.js (global scope)
 * to avoid calling itself recursively.
 */
async function changeModel() {
  // Get the next model by directly accessing model.js globals
  // Since model.js loads before main.js, MODELS and currentModelIndex are available
  if (typeof MODELS === 'undefined' || typeof currentModelIndex === 'undefined') {
    showError('Model management not initialized');
    return;
  }
  
  // Safety check: ensure MODELS array is not empty
  if (!MODELS || MODELS.length === 0) {
    showError('No models available');
    return;
  }
  
  // Advance to next model (same logic as model.js changeModel function)
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  const newModel = MODELS[currentModelIndex];
  
  // Safety check: ensure newModel is valid before accessing properties
  if (!newModel || !newModel.name) {
    console.error('Invalid model at index:', currentModelIndex);
    showError('Invalid model selected');
    return;
  }
  
  console.log(`Changing to model: ${newModel.name}`);
  
  try {
    showLoading(`Loading model: ${newModel.name}...`);
    await loadModel(newModel.name);
    updateModelInfo();
    hideLoading();
    reset();
  } catch (error) {
    console.error('Failed to change model:', error);
    showError(`Failed to load model: ${error.message}`);
    hideLoading();
  }
}

/**
 * Update performance stats display
 */
function updateStats() {
  if (elements.inferenceTime) {
    elements.inferenceTime.textContent = appState.inferenceTime.toFixed(0);
  }
  if (elements.totalTime) {
    elements.totalTime.textContent = appState.totalTime.toFixed(0);
  }
  if (elements.fps) {
    const fps = appState.totalTime > 0 ? (1000 / appState.totalTime).toFixed(1) : '0';
    elements.fps.textContent = fps;
  }
  if (elements.modelFps) {
    const modelFps = appState.inferenceTime > 0 ? (1000 / appState.inferenceTime).toFixed(1) : '0';
    elements.modelFps.textContent = modelFps;
  }
  if (elements.efficiency) {
    const efficiency = appState.totalTime > 0 
      ? ((appState.inferenceTime / appState.totalTime) * 100).toFixed(0) 
      : '0';
    elements.efficiency.textContent = efficiency;
  }
  if (elements.overhead) {
    const overhead = (appState.totalTime - appState.inferenceTime).toFixed(1);
    elements.overhead.textContent = overhead;
  }
}

/**
 * Update model information display
 */
function updateModelInfo() {
  const model = getCurrentModel();
  if (elements.modelName) {
    elements.modelName.textContent = model.name.replace('.onnx', '');
  }
  if (elements.modelResolution) {
    elements.modelResolution.textContent = `${model.resolution[0]}×${model.resolution[1]}`;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Capture button
  if (elements.captureBtn) {
    elements.captureBtn.addEventListener('click', async () => {
      await runDetection();
    });
  }

  // Live detection is now always active - no button needed

  // Switch camera button
  if (elements.switchBtn) {
    elements.switchBtn.addEventListener('click', () => {
      switchCamera();
    });
  }

  // Reset button
  if (elements.resetBtn) {
    elements.resetBtn.addEventListener('click', () => {
      reset();
    });
  }

  // Model button
  if (elements.modelBtn) {
    elements.modelBtn.addEventListener('click', () => {
      changeModel();
    });
  }

  // Camera source buttons
  if (elements.webcamBtn) {
    elements.webcamBtn.addEventListener('click', () => {
      setCameraSource('webcam');
    });
  }

  if (elements.esp32Btn) {
    elements.esp32Btn.addEventListener('click', () => {
      setCameraSource('esp32');
    });
  }

  // ESP32 mode buttons
  if (elements.esp32StreamBtn) {
    elements.esp32StreamBtn.addEventListener('click', () => {
      setESP32Mode('stream');
    });
  }

  if (elements.esp32CaptureBtn) {
    elements.esp32CaptureBtn.addEventListener('click', () => {
      setESP32Mode('capture');
    });
  }

  // Page visibility change (pause detection when tab is hidden for performance)
  // Restart when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pause when tab is hidden to save resources
      stopLiveDetection();
    } else {
      // Restart when tab becomes visible again
      // Live detection should always be active when tab is visible
      if (cameraState.isStreamReady) {
        startLiveDetection();
      }
    }
  });

  // Page unload cleanup
  window.addEventListener('beforeunload', () => {
    cleanupCamera();
    stopLiveDetection();
  });
}

/**
 * Initialize application
 */
async function init() {
  console.log('🚀 Initializing application...');

  // Initialize DOM elements
  initElements();

  // Configure ONNX Runtime
  if (!configureONNXRuntime()) {
    showError('ONNX Runtime not loaded! Check console for details.');
    return;
  }

  // Setup event listeners
  setupEventListeners();

  // Load initial model
  const initialModel = getCurrentModel();
  try {
    showLoading(`Loading model: ${initialModel.name}...`);
    await loadModel(initialModel.name);
    updateModelInfo();
    hideLoading();
    console.log('✅ Model loaded');
  } catch (error) {
    console.error('Failed to load initial model:', error);
    showError(`Failed to load model: ${error.message}`);
    hideLoading();
  }

  // Initialize camera
  // Live detection will auto-start when camera becomes ready
  updateCameraButtons();
  updateESP32Buttons();
  initCamera();

  console.log('✅ Application initialized');
  console.log('✅ Live detection will start automatically when camera is ready');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


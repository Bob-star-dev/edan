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
    liveBtn: document.getElementById('live-detection-btn'),
    switchBtn: document.getElementById('switch-camera-btn'),
    resetBtn: document.getElementById('reset-btn'),
    modelBtn: document.getElementById('model-btn'),
    webcamBtn: document.getElementById('webcam-btn'),
    esp32Btn: document.getElementById('esp32-btn'),
    esp32StreamBtn: document.getElementById('esp32-stream-btn'),
    esp32CaptureBtn: document.getElementById('esp32-capture-btn'),
    helpBtn: document.getElementById('help-btn'),
    helpModal: document.getElementById('help-modal'),
    closeHelpBtn: document.getElementById('close-help-btn'),
    closeHelpBtnFooter: document.getElementById('close-help-btn-footer'),
    
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
    showError('⏳ Model belum dimuat. Silakan tunggu hingga model selesai dimuat...');
    return;
  }

  // Check if camera is ready
  if (!cameraState.isStreamReady) {
    console.warn('❌ Camera not ready');
    const errorMsg = cameraState.source === 'webcam' 
      ? '⏳ Kamera belum siap. Silakan izinkan akses kamera atau periksa koneksi kamera.'
      : '⏳ ESP32-CAM belum siap. Periksa koneksi atau beralih ke webcam.';
    showError(errorMsg);
    return;
  }

  const startTime = Date.now();
  
  // Capture frame from camera
  const ctx = captureFrame();
  if (!ctx) {
    console.warn('❌ Failed to capture frame');
    const errorMsg = cameraState.source === 'webcam'
      ? '❌ Gagal mengambil frame dari webcam. Pastikan video sedang berjalan.'
      : '❌ Gagal mengambil frame dari ESP32-CAM. Periksa koneksi atau coba mode capture.';
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
    
    // User-friendly error messages
    let errorMessage = 'Gagal melakukan deteksi. ';
    if (!currentSession) {
      errorMessage += 'Model belum dimuat.';
    } else if (!cameraState.isStreamReady) {
      errorMessage += 'Kamera belum siap.';
    } else {
      errorMessage += error.message || 'Terjadi kesalahan.';
    }
    
    showError(errorMessage);
    
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
 */
function startLiveDetection() {
  if (appState.liveDetection) {
    stopLiveDetection();
    return;
  }

  appState.liveDetection = true;
  if (elements.liveBtn) {
    elements.liveBtn.innerHTML = '<span class="btn-icon">⏸️</span><span>Stop Detection</span>';
  }
  updateStatusIndicators();

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
 */
function stopLiveDetection() {
  appState.liveDetection = false;
  if (appState.liveDetectionFrame) {
    cancelAnimationFrame(appState.liveDetectionFrame);
    appState.liveDetectionFrame = null;
  }
  if (elements.liveBtn) {
    elements.liveBtn.innerHTML = '<span class="btn-icon">▶️</span><span>Live Detection</span>';
  }
  updateStatusIndicators();
}

/**
 * Reset canvas and stats
 */
function reset() {
  stopLiveDetection();
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
    showLoading(`Memuat model: ${newModel.name}...`);
    updateStatusIndicators(); // Update to loading state
    
    // Stop live detection during model change
    const wasLive = appState.liveDetection;
    if (wasLive) {
      stopLiveDetection();
    }
    
    await loadModel(newModel.name);
    updateModelInfo();
    updateStatusIndicators(); // Update to ready state
    hideLoading();
    reset();
    
    // Restart live detection if it was running
    if (wasLive) {
      setTimeout(() => {
        startLiveDetection();
      }, 500);
    }
  } catch (error) {
    console.error('Failed to change model:', error);
    showError(`❌ Gagal memuat model: ${error.message}`);
    updateStatusIndicators(); // Update status even on error
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
 * Update status indicators
 */
function updateStatusIndicators() {
  // Model status
  const modelStatusDot = document.getElementById('model-status-dot');
  const modelStatusText = document.getElementById('model-status-text');
  if (modelStatusDot && modelStatusText) {
    if (currentSession) {
      modelStatusDot.className = 'status-dot active';
      modelStatusText.textContent = 'Siap';
    } else {
      modelStatusDot.className = 'status-dot loading';
      modelStatusText.textContent = 'Memuat...';
    }
  }

  // Camera status
  const cameraStatusDot = document.getElementById('camera-status-dot');
  const cameraStatusText = document.getElementById('camera-status-text');
  if (cameraStatusDot && cameraStatusText) {
    if (cameraState.isStreamReady) {
      cameraStatusDot.className = 'status-dot active';
      cameraStatusText.textContent = cameraState.source === 'webcam' ? 'Webcam Aktif' : 'ESP32-CAM Aktif';
    } else {
      cameraStatusDot.className = 'status-dot loading';
      cameraStatusText.textContent = 'Menunggu...';
    }
  }

  // Detection status
  const detectionStatusDot = document.getElementById('detection-status-dot');
  const detectionStatusText = document.getElementById('detection-status-text');
  if (detectionStatusDot && detectionStatusText) {
    if (appState.liveDetection) {
      detectionStatusDot.className = 'status-dot active';
      detectionStatusText.textContent = 'Live Detection Aktif';
    } else {
      detectionStatusDot.className = 'status-dot';
      detectionStatusText.textContent = 'Tidak Aktif';
    }
  }

  // Voice navigation status
  const voiceStatusDot = document.getElementById('voice-status-dot');
  const voiceStatusText = document.getElementById('voice-status-text');
  if (voiceStatusDot && voiceStatusText) {
    if (typeof voiceNavigationState !== 'undefined' && voiceNavigationState.enabled) {
      voiceStatusDot.className = 'status-dot active';
      voiceStatusText.textContent = 'Aktif';
    } else {
      voiceStatusDot.className = 'status-dot';
      voiceStatusText.textContent = 'Nonaktif';
    }
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

  // Live detection button
  if (elements.liveBtn) {
    elements.liveBtn.addEventListener('click', () => {
      startLiveDetection();
    });
  }

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

  // Page visibility change (pause detection when tab is hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLiveDetection();
    }
  });

  // Page unload cleanup
  window.addEventListener('beforeunload', () => {
    cleanupCamera();
    stopLiveDetection();
  });

  // Help/Guide modal
  if (elements.helpBtn) {
    elements.helpBtn.addEventListener('click', () => {
      if (elements.helpModal) {
        elements.helpModal.style.display = 'flex';
      }
    });
  }

  if (elements.closeHelpBtn) {
    elements.closeHelpBtn.addEventListener('click', () => {
      if (elements.helpModal) {
        elements.helpModal.style.display = 'none';
      }
    });
  }

  if (elements.closeHelpBtnFooter) {
    elements.closeHelpBtnFooter.addEventListener('click', () => {
      if (elements.helpModal) {
        elements.helpModal.style.display = 'none';
      }
    });
  }

  // Close modal when clicking outside
  if (elements.helpModal) {
    elements.helpModal.addEventListener('click', (e) => {
      if (e.target === elements.helpModal) {
        elements.helpModal.style.display = 'none';
      }
    });
  }

  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.helpModal && elements.helpModal.style.display === 'flex') {
      elements.helpModal.style.display = 'none';
    }
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
  updateStatusIndicators(); // Initial status update
  try {
    showLoading(`Memuat model: ${initialModel.name}...`);
    updateStatusIndicators(); // Show loading state
    await loadModel(initialModel.name);
    updateModelInfo();
    updateStatusIndicators(); // Update after model loaded
    hideLoading();
    console.log('✅ Model loaded');
  } catch (error) {
    console.error('Failed to load initial model:', error);
    showError(`❌ Gagal memuat model: ${error.message}. Silakan refresh halaman.`);
    hideLoading();
    updateStatusIndicators(); // Update status even on error
  }

  // Initialize camera
  updateCameraButtons();
  updateESP32Buttons();
  initCamera();
  
  // Update status indicators periodically
  setInterval(() => {
    updateStatusIndicators();
  }, 1000); // Update every second

  console.log('✅ Application initialized');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


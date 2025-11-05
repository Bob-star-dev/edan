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
    testVibrationBtn: document.getElementById('test-vibration-btn'),
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
// Track last time we logged "model not loaded" to avoid spam
let lastModelNotLoadedLog = 0;
const MODEL_NOT_LOADED_LOG_INTERVAL = 2000; // Log max once per 2 seconds

async function runDetection() {
  // Check if model is loaded
  if (!currentSession) {
    // Throttle log to avoid spam (only log once every 2 seconds)
    const now = Date.now();
    if (now - lastModelNotLoadedLog > MODEL_NOT_LOADED_LOG_INTERVAL) {
      console.warn('❌ Model not loaded yet - waiting for model to load...');
      lastModelNotLoadedLog = now;
    }
    // Don't show error repeatedly - just wait
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
 * Live detection is now always active and cannot be stopped
 */
function startLiveDetection() {
  // Prevent multiple detection loops from running
  if (appState.liveDetection) {
    return;
  }

  // Don't start detection loop if model is not loaded yet
  // Wait for model to be ready first
  if (!currentSession) {
    console.log('[Detection] ⏳ Waiting for model to load before starting detection loop...');
    // Check again after a short delay
    setTimeout(() => {
      if (typeof startLiveDetection === 'function') {
        startLiveDetection();
      }
    }, 500);
    return;
  }

  appState.liveDetection = true;
  console.log('[Detection] ✅ Starting live detection loop (model ready)');

  function loop() {
    if (!appState.liveDetection) return;
    
    // Double-check model is still loaded (shouldn't happen, but safety check)
    if (!currentSession) {
      console.warn('[Detection] ⚠️ Model unloaded during detection loop - pausing...');
      // Wait a bit and retry
      setTimeout(() => {
        if (appState.liveDetection) {
          appState.liveDetectionFrame = requestAnimationFrame(loop);
        }
      }, 500);
      return;
    }

    // For ESP32 mode, ensure we wait a bit for frame to be ready
    // This prevents race conditions where detection runs before frame is loaded
    // But don't wait too long - allow detection to proceed even if frame check fails
    // (captureFrame() will handle the actual frame availability check)
    if (cameraState.source !== 'webcam' && typeof isESP32FrameReady === 'function' && !isESP32FrameReady()) {
      // Only wait if camera state says it's ready (frame should be loading)
      // If camera not ready at all, wait longer
      if (cameraState.isStreamReady) {
        // Camera ready but frame not yet loaded - wait a bit (short delay)
        setTimeout(() => {
          if (appState.liveDetection) {
            appState.liveDetectionFrame = requestAnimationFrame(loop);
          }
        }, 30);
        return;
      } else {
        // Camera not ready yet - wait longer
        setTimeout(() => {
          if (appState.liveDetection) {
            appState.liveDetectionFrame = requestAnimationFrame(loop);
          }
        }, 100);
        return;
      }
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
 * Test vibration function
 * Mengirim sinyal test ke ESP32-CAM untuk mengaktifkan KEDUA vibration motor secara bersamaan
 * Tests all vibration patterns via HTTP request to ESP32-CAM
 * ESP32-CAM akan mengaktifkan MOTOR_R (GPIO 14) dan MOTOR_L (GPIO 15) secara bersamaan
 */
async function testVibration() {
  console.log('[Test Vibration] 🔔 Starting ESP32-CAM vibration motor test...');
  console.log('[Test Vibration] 📳 ========================================');
  console.log('[Test Vibration] 📳 TESTING KEDUA VIBRATION MOTOR');
  console.log('[Test Vibration] 📳 MOTOR_R (GPIO 14) + MOTOR_L (GPIO 15)');
  console.log('[Test Vibration] 📳 Kedua motor akan bergetar SECARA BERSAMAAN');
  console.log('[Test Vibration] 📳 ========================================');
  
  // Check if ESP32 vibration functions are available
  if (typeof vibrateESP32 === 'undefined' && typeof vibrateESP32Pattern === 'undefined') {
    showError('❌ Fungsi ESP32 vibration tidak tersedia. Pastikan vibration.js sudah dimuat.');
    return;
  }
  
  // Get ESP32 DNS/IP (from camera.js or vibration.js)
  const esp32Dns = (typeof window !== 'undefined' && window.ESP32_DNS) || 'esp32cam.local';
  const esp32Ip = (typeof window !== 'undefined' && window.ESP32_IP) || null;
  const esp32Base = esp32Ip || esp32Dns;
  const esp32VibrateUrl = `http://${esp32Base}/vibrate`;
  
  console.log('[Test Vibration] 📊 ESP32-CAM Configuration:');
  console.log('[Test Vibration] 📊   DNS:', esp32Dns);
  console.log('[Test Vibration] 📊   IP:', esp32Ip || '(not set - using DNS)');
  console.log('[Test Vibration] 📊   Base URL:', esp32Base);
  console.log('[Test Vibration] 📊   Vibration URL:', esp32VibrateUrl);
  console.log('[Test Vibration] 📊   Method: ESP32-CAM HTTP API');
  console.log('[Test Vibration] 📊   Target: BOTH motors (MOTOR_R + MOTOR_L) simultaneously');
  console.log('[Test Vibration] 📊   Motor Pins: GPIO 14 (MOTOR_R), GPIO 15 (MOTOR_L)');
  
  // Show loading/feedback
  const testBtn = elements.testVibrationBtn;
  const originalText = testBtn?.querySelector('span:last-child')?.textContent || 'Test Getar';
  if (testBtn) {
    testBtn.disabled = true;
    const btnIcon = testBtn.querySelector('.btn-icon');
    if (btnIcon) btnIcon.textContent = '⏳';
    const btnText = testBtn.querySelector('span:last-child');
    if (btnText) btnText.textContent = 'Testing...';
  }
  
  // Test sequence: Simple durations -> Pattern -> Mario
  let testIndex = 0;
  let successCount = 0;
  const tests = [
    { name: 'Short Vibration (200ms)', pattern: 200, duration: 800 },
    { name: 'Medium Vibration (500ms)', pattern: 500, duration: 1000 },
    { name: 'Long Vibration (1000ms)', pattern: 1000, duration: 1500 },
    { name: 'Pattern Vibration [300,400,300,400]', pattern: [300, 400, 300, 400], duration: 2500 },
    { name: 'Mario Pattern', pattern: [125, 75, 125, 275, 200, 275, 125, 75, 125, 275, 200, 600, 200, 600], duration: 4000 }
  ];
  
  async function runNextTest() {
    if (testIndex >= tests.length) {
      // All tests completed
      if (testBtn) {
        testBtn.disabled = false;
        const btnIcon = testBtn.querySelector('.btn-icon');
        if (btnIcon) btnIcon.textContent = '📳';
        const btnText = testBtn.querySelector('span:last-child');
        if (btnText) btnText.textContent = originalText;
      }
      
      console.log(`[Test Vibration] ✅ ========================================`);
      console.log(`[Test Vibration] ✅ SEMUA TEST SELESAI!`);
      console.log(`[Test Vibration] ✅ Hasil: ${successCount}/${tests.length} test berhasil dikirim`);
      console.log(`[Test Vibration] ✅ ========================================`);
      
      if (successCount > 0) {
        hideError();
        showError(`✅ Test vibration motor ESP32-CAM selesai!\n\n📊 Hasil: ${successCount}/${tests.length} test berhasil dikirim\n\n✅ Sinyal vibration telah dikirim ke ESP32-CAM\n\n📳 ========================================\n📳 KEDUA VIBRATION MOTOR SEHARUSNYA BERGETAR\n📳 ========================================\n\n✓ MOTOR_R (GPIO 14) = Bergetar\n✓ MOTOR_L (GPIO 15) = Bergetar\n✓ Kedua motor bergetar BERSAMAAN\n\n💡 Jika vibration motor TIDAK bergetar:\n\n1. Periksa Koneksi ESP32-CAM\n   → Pastikan ESP32-CAM terhubung ke WiFi\n   → Pastikan DNS/IP benar: ${esp32Base}\n   → Coba akses: ${esp32VibrateUrl}\n\n2. Periksa Endpoint Vibration\n   → Pastikan ESP32-CAM memiliki endpoint /vibrate\n   → Endpoint harus menerima parameter: ?duration=200\n   → Atau pattern: ?pattern=200,100,200,100\n\n3. Periksa Koneksi Vibration Motor\n   → Pastikan MOTOR_R terhubung ke GPIO 14\n   → Pastikan MOTOR_L terhubung ke GPIO 15\n   → Pastikan kode ESP32-CAM mendukung kontrol vibration\n   → Cek kode Arduino untuk endpoint /vibrate\n   → Upload ESP32_CAM_VIBRATION.ino jika belum\n\n4. Periksa Console Log\n   → Lihat pesan di console browser\n   → Cek apakah HTTP request berhasil dikirim\n   → Cek error message jika ada`);
      } else {
        showError(`⚠️ Test vibration motor ESP32-CAM gagal!\n\n📊 Hasil: ${successCount}/${tests.length} test berhasil\n\n❌ Tidak ada sinyal yang berhasil dikirim ke ESP32-CAM\n\n💡 Periksa:\n\n1. Koneksi ESP32-CAM\n   → Pastikan ESP32-CAM terhubung ke WiFi yang sama\n   → Pastikan DNS/IP benar: ${esp32Base}\n   → Coba akses: ${esp32VibrateUrl}\n\n2. Endpoint Vibration\n   → Pastikan ESP32-CAM memiliki endpoint /vibrate\n   → Cek kode ESP32-CAM untuk endpoint vibration\n   → Upload kode ESP32_CAM_VIBRATION.ino jika belum\n\n3. Console Log\n   → Lihat error message di console browser\n   → Cek network tab untuk melihat HTTP request`);
      }
      
      setTimeout(() => {
        hideError();
      }, 8000);
      return;
    }
    
    const test = tests[testIndex];
    console.log(`[Test Vibration] 🔔 ========================================`);
    console.log(`[Test Vibration] 🔔 Test ${testIndex + 1}/${tests.length}: ${test.name}`);
    console.log(`[Test Vibration] 📳 Target: KEDUA VIBRATION MOTOR (MOTOR_R + MOTOR_L)`);
    console.log(`[Test Vibration] 📳 GPIO 14 (MOTOR_R) dan GPIO 15 (MOTOR_L) akan bergetar BERSAMAAN`);
    
    try {
      let success = false;
      
      // Check if pattern is array (pattern) or number (simple duration)
      if (Array.isArray(test.pattern)) {
        // Send pattern array to ESP32-CAM
        // Pattern akan mengaktifkan kedua motor secara bersamaan
        console.log(`[Test Vibration] 📡 Mengirim pattern ke ESP32-CAM:`, test.pattern);
        console.log(`[Test Vibration] 📡 Endpoint: ${esp32VibrateUrl}?pattern=${test.pattern.join(',')}`);
        console.log(`[Test Vibration] 📡 ESP32-CAM akan mengaktifkan:`);
        console.log(`[Test Vibration] 📡   - MOTOR_R (GPIO 14) = HIGH`);
        console.log(`[Test Vibration] 📡   - MOTOR_L (GPIO 15) = HIGH`);
        console.log(`[Test Vibration] 📡   - Kedua motor bergetar BERSAMAAN sesuai pattern`);
        if (typeof vibrateESP32Pattern === 'function') {
          success = await vibrateESP32Pattern(test.pattern);
        } else {
          console.error('[Test Vibration] ❌ vibrateESP32Pattern function not available');
        }
      } else {
        // Send simple duration to ESP32-CAM
        // Duration akan mengaktifkan kedua motor secara bersamaan
        console.log(`[Test Vibration] 📡 Mengirim duration ke ESP32-CAM: ${test.pattern}ms`);
        console.log(`[Test Vibration] 📡 Endpoint: ${esp32VibrateUrl}?duration=${test.pattern}`);
        console.log(`[Test Vibration] 📡 ESP32-CAM akan mengaktifkan:`);
        console.log(`[Test Vibration] 📡   - MOTOR_R (GPIO 14) = HIGH`);
        console.log(`[Test Vibration] 📡   - MOTOR_L (GPIO 15) = HIGH`);
        console.log(`[Test Vibration] 📡   - Kedua motor bergetar BERSAMAAN selama ${test.pattern}ms`);
        if (typeof vibrateESP32 === 'function') {
          success = await vibrateESP32(test.pattern);
        } else {
          console.error('[Test Vibration] ❌ vibrateESP32 function not available');
        }
      }
      
      if (success) {
        successCount++;
        console.log(`[Test Vibration] ✅ ========================================`);
        console.log(`[Test Vibration] ✅ ${test.name} BERHASIL dikirim ke ESP32-CAM!`);
        console.log(`[Test Vibration] ✅ ESP32-CAM seharusnya sekarang mengaktifkan:`);
        console.log(`[Test Vibration] ✅   ✓ MOTOR_R (GPIO 14) = BERGETAR`);
        console.log(`[Test Vibration] ✅   ✓ MOTOR_L (GPIO 15) = BERGETAR`);
        console.log(`[Test Vibration] ✅   ✓ KEDUA MOTOR bergetar BERSAMAAN`);
        console.log(`[Test Vibration] ✅ ========================================`);
      } else {
        console.warn(`[Test Vibration] ⚠️ ========================================`);
        console.warn(`[Test Vibration] ⚠️ ${test.name} GAGAL dikirim`);
        console.warn(`[Test Vibration] ⚠️ ESP32-CAM mungkin tidak terhubung atau endpoint tidak tersedia`);
        console.warn(`[Test Vibration] 💡 Periksa:`);
        console.warn(`[Test Vibration] 💡   1. ESP32-CAM endpoint /vibrate harus ada`);
        console.warn(`[Test Vibration] 💡   2. ESP32-CAM harus terhubung ke WiFi`);
        console.warn(`[Test Vibration] 💡   3. DNS/IP harus benar: ${esp32Base}`);
        console.warn(`[Test Vibration] 💡   4. Pastikan kode ESP32_CAM_VIBRATION.ino sudah di-upload`);
        console.warn(`[Test Vibration] ⚠️ ========================================`);
      }
    } catch (error) {
      console.error(`[Test Vibration] ❌ ${test.name} error:`, error);
      console.error(`[Test Vibration] ❌ Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    
    testIndex++;
    
    // Wait before next test (allow time for vibration to complete)
    setTimeout(runNextTest, test.duration + 500);
  }
  
  // Start first test
  runNextTest();
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

  // Test vibration button
  if (elements.testVibrationBtn) {
    elements.testVibrationBtn.addEventListener('click', () => {
      testVibration();
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
    
    // If camera is already ready, start detection loop now
    // (Camera might have been ready before model finished loading)
    if (cameraState.isStreamReady && typeof startLiveDetection === 'function') {
      console.log('[Detection] ✅ Model loaded, starting detection loop (camera already ready)');
      startLiveDetection();
    }
  } catch (error) {
    console.error('Failed to load initial model:', error);
    showError(`❌ Gagal memuat model: ${error.message}. Silakan refresh halaman.`);
    hideLoading();
    updateStatusIndicators(); // Update status even on error
  }

  // Initialize camera
  // Live detection will auto-start when camera becomes ready (if model is already loaded)
  updateCameraButtons();
  updateESP32Buttons();
  initCamera();
  
  // Update status indicators periodically
  setInterval(() => {
    updateStatusIndicators();
  }, 1000); // Update every second

  console.log('✅ Application initialized');
  console.log('✅ Live detection will start automatically when both model and camera are ready');
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


/**
 * Mode-Detector Integration
 * Memungkinkan mode-detector berjalan di background tanpa membuka halaman baru
 * 
 * Script ini memuat dan menginisialisasi mode-detector di dalam aplikasi map
 * sehingga user bisa menggunakan deteksi objek sambil navigasi aktif
 */

// State management untuk mode-detector
const modeDetectorState = {
    isActive: false,
    isInitialized: false,
    scriptsLoaded: false,
    onnxLoaded: false,
    modelLoaded: false,
    cameraReady: false,
    detectionLoop: null
};

// Namespace untuk mode-detector functions (untuk avoid conflicts)
const ModeDetector = {
    state: modeDetectorState,
    
    /**
     * Override getStaticBasePath early (before any scripts load)
     * This must be called BEFORE loadModeDetectorScripts
     */
    setupPathOverride() {
        // Override getStaticBasePath BEFORE model.js loads
        // We'll override it globally so model.js uses correct path
        const originalGetStaticBasePath = window.getStaticBasePath;
        
        window.getStaticBasePath = function() {
            // Check if we're in map directory
            const path = window.location.pathname;
            const href = window.location.href;
            
            // Check multiple conditions to detect if we're in map directory
            if (path.includes('/map/') || path.endsWith('/map') || 
                href.includes('/map/') || href.includes('/map.html') ||
                path.includes('map.html') || document.URL.includes('/map')) {
                const basePath = '../mode-detector/static';
                console.log('[ModeDetector] getStaticBasePath: Using path for map directory:', basePath);
                return basePath;
            }
            
            // Otherwise use original function if it exists
            if (typeof originalGetStaticBasePath === 'function') {
                return originalGetStaticBasePath();
            }
            return 'static';
        };
        
        console.log('[ModeDetector] ✅ getStaticBasePath override setup (will apply when model.js loads)');
    },
    
    /**
     * Initialize mode-detector (load scripts, setup elements)
     * Call once when page loads
     */
    async init() {
        if (modeDetectorState.isInitialized) {
            console.log('[ModeDetector] Already initialized');
            return true;
        }
        
        console.log('[ModeDetector] Initializing...');
        
        try {
            // Setup path override FIRST (before any scripts load)
            this.setupPathOverride();
            
            // Setup hidden canvas elements
            this.setupHiddenCanvas();
            
            // Load ONNX Runtime first
            await this.loadONNXRuntime();
            
            // Load mode-detector scripts (getStaticBasePath override is already set)
            await this.loadModeDetectorScripts();
            
            // Initialize components
            await this.initComponents();
            
            // Override UI update functions to prevent errors when elements don't exist
            // These functions are called by mode-detector but UI elements don't exist in map.html
            this.overrideUIFunctions();
            
            modeDetectorState.isInitialized = true;
            console.log('[ModeDetector] ✅ Initialized successfully');
            return true;
        } catch (error) {
            console.error('[ModeDetector] ❌ Initialization failed:', error);
            return false;
        }
    },
    
    /**
     * Load ONNX Runtime Web library
     */
    async loadONNXRuntime() {
        if (modeDetectorState.onnxLoaded) {
            console.log('[ModeDetector] ONNX Runtime already loaded');
            return true;
        }
        
        if (typeof ort !== 'undefined') {
            console.log('[ModeDetector] ONNX Runtime already available');
            modeDetectorState.onnxLoaded = true;
            return true;
        }
        
        console.log('[ModeDetector] Loading ONNX Runtime...');
        
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (typeof ort !== 'undefined') {
                modeDetectorState.onnxLoaded = true;
                resolve(true);
                return;
            }
            
            // Create script element
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.0/dist/ort.min.js';
            script.async = true;
            
            script.onload = () => {
                console.log('[ModeDetector] ✅ ONNX Runtime loaded');
                
                // Configure ONNX Runtime
                if (typeof ort !== 'undefined') {
                    ort.env.wasm.simd = false;
                    ort.env.wasm.numThreads = 1;
                    ort.env.wasm.proxy = false;
                    if (typeof ort.env.wasm.threaded !== 'undefined') {
                        ort.env.wasm.threaded = false;
                    }
                    console.log('[ModeDetector] ✅ ONNX Runtime configured');
                }
                
                modeDetectorState.onnxLoaded = true;
                resolve(true);
            };
            
            script.onerror = () => {
                console.error('[ModeDetector] ❌ Failed to load ONNX Runtime');
                reject(new Error('Failed to load ONNX Runtime'));
            };
            
            document.head.appendChild(script);
        });
    },
    
    /**
     * Load all mode-detector JavaScript files
     */
    async loadModeDetectorScripts() {
        if (modeDetectorState.scriptsLoaded) {
            console.log('[ModeDetector] Scripts already loaded');
            return true;
        }
        
        console.log('[ModeDetector] Loading mode-detector scripts...');
        
        // Prevent main.js from auto-initializing
        // We'll set a flag to prevent auto-init, and override init() temporarily
        window.MODE_DETECTOR_BACKGROUND_MODE = true;
        const originalInit = window.init;
        window.init = function() {
            if (window.MODE_DETECTOR_BACKGROUND_MODE) {
                console.log('[ModeDetector] init() prevented (background mode)');
                return Promise.resolve(); // Return resolved promise to prevent errors
            }
            // If not in background mode, call original
            if (originalInit) {
                return originalInit();
            }
        };
        
        // List of scripts to load (in order)
        const scripts = [
            '../mode-detector/js/yoloClasses.js',
            '../mode-detector/js/utils.js',
            '../mode-detector/js/distance.js',
            '../mode-detector/js/voiceNavigation.js',
            '../mode-detector/js/vibration.js',
            '../mode-detector/js/preprocessing.js',
            '../mode-detector/js/postprocessing.js',
            '../mode-detector/js/model.js',
            '../mode-detector/js/camera.js',
            '../mode-detector/js/main.js'
        ];
        
        // Also load NDArray if not available
        if (typeof ndarray === 'undefined') {
            const ndarrayScript = document.createElement('script');
            ndarrayScript.src = 'https://cdn.jsdelivr.net/npm/ndarray@1/dist/ndarray.js';
            document.head.appendChild(ndarrayScript);
            
            const ndarrayOpsScript = document.createElement('script');
            ndarrayOpsScript.src = 'https://cdn.jsdelivr.net/npm/ndarray-ops@1/dist/ndarray-ops.js';
            document.head.appendChild(ndarrayOpsScript);
            
            // Wait a bit for NDArray to load
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Load each script sequentially
        for (const scriptPath of scripts) {
            await new Promise((resolve, reject) => {
                // Check if script already loaded (by checking for global functions)
                const scriptName = scriptPath.split('/').pop().replace('.js', '');
                if (window[scriptName] || (scriptName === 'yoloClasses' && typeof YOLO_CLASSES !== 'undefined')) {
                    console.log(`[ModeDetector] Script ${scriptName} already loaded, skipping`);
                    resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = scriptPath;
                script.async = false; // Load sequentially
                
                script.onload = () => {
                    console.log(`[ModeDetector] ✅ Loaded ${scriptName}`);
                    
                    // After model.js loads, override getStaticBasePath if it exists
                    if (scriptName === 'model' && typeof getStaticBasePath === 'function') {
                        const originalGetStaticBasePath = getStaticBasePath;
                        window.getStaticBasePath = function() {
                            // Check if we're in map directory
                            const path = window.location.pathname;
                            const href = window.location.href;
                            
                            if (path.includes('/map/') || path.endsWith('/map') || 
                                href.includes('/map/') || href.includes('/map.html') ||
                                path.includes('map.html') || document.URL.includes('/map')) {
                                const basePath = '../mode-detector/static';
                                console.log('[ModeDetector] getStaticBasePath override: Using path:', basePath);
                                return basePath;
                            }
                            
                            // Use original function
                            return originalGetStaticBasePath();
                        };
                        console.log('[ModeDetector] ✅ getStaticBasePath overridden after model.js load');
                    }
                    
                    // After main.js loads, restore original init function
                    if (scriptName === 'main') {
                        // main.js will try to call init() automatically, but we've already overridden it
                        // Now we need to store the real init function
                        if (typeof window.mainInit_original === 'undefined') {
                            // Find the real init function from main.js
                            // It should be available in global scope now
                            const realInit = window.init;
                            if (realInit && realInit.toString().includes('async function init')) {
                                window.mainInit_original = realInit;
                                console.log('[ModeDetector] ✅ Stored original init function from main.js');
                            }
                        }
                    }
                    
                    resolve();
                };
                
                script.onerror = () => {
                    console.error(`[ModeDetector] ❌ Failed to load ${scriptName}`);
                    reject(new Error(`Failed to load ${scriptName}`));
                };
                
                document.head.appendChild(script);
            });
        }
        
        modeDetectorState.scriptsLoaded = true;
        console.log('[ModeDetector] ✅ All scripts loaded');
        return true;
    },
    
    /**
     * Setup hidden canvas elements for mode-detector
     * These elements are used for camera capture and detection rendering
     */
    setupHiddenCanvas() {
        // Check if container already exists
        let container = document.getElementById('mode-detector-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'mode-detector-container';
            container.style.cssText = 'display: none; position: absolute; top: -9999px; left: -9999px; width: 1px; height: 1px; overflow: hidden;';
            document.body.appendChild(container);
        }
        
        // Create video element if not exists
        let video = document.getElementById('video-element');
        if (!video) {
            video = document.createElement('video');
            video.id = 'video-element';
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.style.cssText = 'display: none; width: 320px; height: 240px;';
            container.appendChild(video);
        }
        
        // Create image element for ESP32-CAM if not exists
        let img = document.getElementById('esp32-img');
        if (!img) {
            img = document.createElement('img');
            img.id = 'esp32-img';
            img.crossOrigin = 'anonymous';
            img.style.cssText = 'display: none; width: 320px; height: 240px;';
            container.appendChild(img);
        }
        
        // Create canvas element if not exists
        let canvas = document.getElementById('canvas-overlay');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'canvas-overlay';
            canvas.width = 320;
            canvas.height = 240;
            canvas.style.cssText = 'display: none; width: 320px; height: 240px;';
            container.appendChild(canvas);
        }
        
        console.log('[ModeDetector] ✅ Hidden canvas elements setup complete');
    },
    
    /**
     * Override UI functions to prevent errors when elements don't exist
     */
    overrideUIFunctions() {
        console.log('[ModeDetector] Overriding UI functions for background mode...');
        
        // Override updateCameraButtons to handle missing elements
        if (typeof updateCameraButtons === 'function') {
            window.updateCameraButtons_original = updateCameraButtons;
            window.updateCameraButtons = function() {
                try {
                    const webcamBtn = document.getElementById('webcam-btn');
                    const esp32Btn = document.getElementById('esp32-btn');
                    const esp32Info = document.getElementById('esp32-info');
                    const switchBtn = document.getElementById('switch-camera-btn');
                    
                    // Only update if elements exist (they won't in map.html)
                    if (webcamBtn && esp32Btn && esp32Info && switchBtn) {
                        return window.updateCameraButtons_original();
                    } else {
                        // Silently skip UI update in background mode
                        console.log('[ModeDetector] UI elements not found, skipping camera button update');
                    }
                } catch (error) {
                    console.warn('[ModeDetector] Error in updateCameraButtons (ignored):', error);
                }
            };
        }
        
        // Override updateESP32Buttons
        if (typeof updateESP32Buttons === 'function') {
            window.updateESP32Buttons_original = updateESP32Buttons;
            window.updateESP32Buttons = function() {
                try {
                    const esp32StreamBtn = document.getElementById('esp32-stream-btn');
                    const esp32CaptureBtn = document.getElementById('esp32-capture-btn');
                    
                    if (esp32StreamBtn && esp32CaptureBtn) {
                        return window.updateESP32Buttons_original();
                    } else {
                        console.log('[ModeDetector] UI elements not found, skipping ESP32 button update');
                    }
                } catch (error) {
                    console.warn('[ModeDetector] Error in updateESP32Buttons (ignored):', error);
                }
            };
        }
        
        // Override showError and showLoading to prevent UI errors
        if (typeof showError === 'function') {
            window.showError_original = showError;
            window.showError = function(msg) {
                // Log error but don't try to show in UI if elements don't exist
                console.error('[ModeDetector] Error:', msg);
                try {
                    return window.showError_original(msg);
                } catch (error) {
                    // Ignore UI errors
                }
            };
        }
        
        if (typeof showLoading === 'function') {
            window.showLoading_original = showLoading;
            window.showLoading = function(msg) {
                console.log('[ModeDetector] Loading:', msg);
                try {
                    return window.showLoading_original(msg);
                } catch (error) {
                    // Ignore UI errors
                }
            };
        }
        
        if (typeof hideLoading === 'function') {
            window.hideLoading_original = hideLoading;
            window.hideLoading = function() {
                try {
                    return window.hideLoading_original();
                } catch (error) {
                    // Ignore UI errors
                }
            };
        }
        
        console.log('[ModeDetector] ✅ UI functions overridden');
    },
    
    /**
     * Initialize mode-detector components
     */
    async initComponents() {
        console.log('[ModeDetector] Initializing components...');
        
        try {
            // Initialize elements (from main.js)
            if (typeof initElements === 'function') {
                initElements();
                console.log('[ModeDetector] ✅ Elements initialized');
            }
            
            // Initialize voice navigation
            if (typeof initVoiceNavigation === 'function') {
                initVoiceNavigation();
                console.log('[ModeDetector] ✅ Voice navigation initialized');
            }
            
            // Initialize vibration
            if (typeof initVibration === 'function') {
                initVibration();
                console.log('[ModeDetector] ✅ Vibration initialized');
            }
            
            // Configure ONNX Runtime if available
            if (typeof configureONNXRuntime === 'function') {
                configureONNXRuntime();
                console.log('[ModeDetector] ✅ ONNX Runtime configured');
            }
            
            console.log('[ModeDetector] ✅ All components initialized');
            return true;
        } catch (error) {
            console.error('[ModeDetector] ❌ Component initialization failed:', error);
            throw error;
        }
    },
    
    /**
     * Activate mode-detector (start detection)
     */
    async activate() {
        if (modeDetectorState.isActive) {
            console.log('[ModeDetector] Already active');
            return true;
        }
        
        console.log('[ModeDetector] Activating...');
        
        try {
            // Ensure initialized first
            if (!modeDetectorState.isInitialized) {
                const initSuccess = await this.init();
                if (!initSuccess) {
                    throw new Error('Initialization failed');
                }
            }
            
            // Load model if not loaded
            if (!modeDetectorState.modelLoaded) {
                await this.loadModel();
            }
            
            // Activate camera
            await this.activateCamera();
            
            // Start detection loop
            this.startDetectionLoop();
            
            modeDetectorState.isActive = true;
            console.log('[ModeDetector] ✅ Activated successfully');
            return true;
        } catch (error) {
            console.error('[ModeDetector] ❌ Activation failed:', error);
            return false;
        }
    },
    
    /**
     * Deactivate mode-detector (stop detection)
     */
    deactivate() {
        if (!modeDetectorState.isActive) {
            console.log('[ModeDetector] Already inactive');
            return;
        }
        
        console.log('[ModeDetector] Deactivating...');
        
        // Stop detection loop
        this.stopDetectionLoop();
        
        // Deactivate camera
        this.deactivateCamera();
        
        modeDetectorState.isActive = false;
        console.log('[ModeDetector] ✅ Deactivated');
    },
    
    /**
     * Get current state
     */
    getState() {
        return {
            isActive: modeDetectorState.isActive,
            isInitialized: modeDetectorState.isInitialized,
            scriptsLoaded: modeDetectorState.scriptsLoaded,
            onnxLoaded: modeDetectorState.onnxLoaded,
            modelLoaded: modeDetectorState.modelLoaded,
            cameraReady: modeDetectorState.cameraReady
        };
    },
    
    /**
     * Activate camera (webcam or ESP32-CAM)
     */
    async activateCamera() {
        console.log('[ModeDetector] Activating camera...');
        
        try {
            // Try ESP32-CAM first (preferred for mobile)
            // Check if setCameraSource function exists
            if (typeof setCameraSource === 'function') {
                console.log('[ModeDetector] Trying ESP32-CAM...');
                // Set to ESP32-CAM first
                setCameraSource('esp32');
                // Wait for camera to initialize
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if ESP32 is ready
                if (typeof cameraState !== 'undefined' && cameraState.isStreamReady && cameraState.source === 'esp32') {
                    modeDetectorState.cameraReady = true;
                    console.log('[ModeDetector] ✅ ESP32-CAM activated');
                    return;
                } else {
                    console.log('[ModeDetector] ESP32-CAM not ready, trying webcam...');
                }
            }
            
            // Fallback to webcam
            if (typeof setCameraSource === 'function') {
                console.log('[ModeDetector] Switching to webcam...');
                setCameraSource('webcam');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (typeof cameraState !== 'undefined' && cameraState.isStreamReady && cameraState.source === 'webcam') {
                    modeDetectorState.cameraReady = true;
                    console.log('[ModeDetector] ✅ Webcam activated');
                    return;
                }
            } else if (typeof initWebcam === 'function') {
                console.log('[ModeDetector] Initializing webcam directly...');
                await initWebcam();
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                if (typeof cameraState !== 'undefined' && cameraState.isStreamReady) {
                    modeDetectorState.cameraReady = true;
                    console.log('[ModeDetector] ✅ Webcam activated (direct)');
                    return;
                }
            }
            
            throw new Error('Camera activation failed - no camera available');
        } catch (error) {
            console.error('[ModeDetector] ❌ Camera activation failed:', error);
            // Don't throw error - allow detection to continue even if camera fails
            // User might have camera permission issues
            console.warn('[ModeDetector] ⚠️ Continuing without camera - detection may not work');
            modeDetectorState.cameraReady = false;
        }
    },
    
    /**
     * Deactivate camera
     */
    deactivateCamera() {
        console.log('[ModeDetector] Deactivating camera...');
        
        try {
            // Stop webcam stream
            if (typeof stopWebcam === 'function') {
                stopWebcam();
            }
            
            // Stop ESP32 stream
            if (typeof stopESP32Stream === 'function') {
                stopESP32Stream();
            }
            
            modeDetectorState.cameraReady = false;
            console.log('[ModeDetector] ✅ Camera deactivated');
        } catch (error) {
            console.error('[ModeDetector] ❌ Camera deactivation failed:', error);
        }
    },
    
    /**
     * Load YOLO model
     */
    async loadModel() {
        if (modeDetectorState.modelLoaded) {
            console.log('[ModeDetector] Model already loaded');
            return true;
        }
        
        console.log('[ModeDetector] Loading model...');
        
        try {
            // Use smallest model for better performance
            const modelName = 'yolov7-tiny_256x256.onnx';
            
            // Reset loadAttempts to allow retry if model failed before
            // This is safe because we're in a controlled activation context
            if (typeof loadAttempts !== 'undefined' && loadAttempts instanceof Set) {
                console.log('[ModeDetector] Resetting loadAttempts to allow model reload');
                loadAttempts.clear();
            }
            
            // Check if model.js's loadModel function is available
            if (typeof loadModel === 'function') {
                // Call the global loadModel function from model.js
                await loadModel(modelName);
            } else {
                // Try to find it in the model.js module context
                console.warn('[ModeDetector] loadModel function not found, checking currentSession...');
                // If model.js loaded the model automatically, check currentSession
                if (typeof currentSession !== 'undefined' && currentSession !== null) {
                    console.log('[ModeDetector] Model already loaded via model.js auto-load');
                    modeDetectorState.modelLoaded = true;
                    return true;
                }
                throw new Error('loadModel function not available');
            }
            
            // Wait a bit for model to be fully loaded
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Verify model is loaded
            if (typeof currentSession !== 'undefined' && currentSession !== null) {
                modeDetectorState.modelLoaded = true;
                console.log('[ModeDetector] ✅ Model loaded');
                return true;
            } else {
                throw new Error('Model loading verification failed - currentSession is null');
            }
        } catch (error) {
            console.error('[ModeDetector] ❌ Model loading failed:', error);
            // Reset modelLoaded flag on error
            modeDetectorState.modelLoaded = false;
            throw error;
        }
    },
    
    /**
     * Start detection loop
     */
    startDetectionLoop() {
        if (modeDetectorState.detectionLoop) {
            console.log('[ModeDetector] Detection loop already running');
            return;
        }
        
        console.log('[ModeDetector] Starting detection loop...');
        
        // Use startLiveDetection from main.js if available
        if (typeof startLiveDetection === 'function') {
            startLiveDetection();
            console.log('[ModeDetector] ✅ Detection loop started via startLiveDetection');
        } else {
            // Fallback: manual detection loop
            const loop = () => {
                if (!modeDetectorState.isActive) return;
                
                if (typeof runDetection === 'function') {
                    runDetection().then(() => {
                        if (modeDetectorState.isActive) {
                            modeDetectorState.detectionLoop = setTimeout(loop, 500); // Run every 500ms
                        }
                    }).catch(error => {
                        console.warn('[ModeDetector] Detection error:', error);
                        if (modeDetectorState.isActive) {
                            modeDetectorState.detectionLoop = setTimeout(loop, 1000); // Retry after 1s
                        }
                    });
                }
            };
            
            loop();
            console.log('[ModeDetector] ✅ Detection loop started (manual)');
        }
    },
    
    /**
     * Stop detection loop
     */
    stopDetectionLoop() {
        if (modeDetectorState.detectionLoop) {
            clearTimeout(modeDetectorState.detectionLoop);
            modeDetectorState.detectionLoop = null;
        }
        
        // Also stop live detection if available
        if (typeof stopLiveDetection === 'function') {
            stopLiveDetection();
        }
        
        console.log('[ModeDetector] ✅ Detection loop stopped');
    }
};

// Expose globally
window.ModeDetector = ModeDetector;

console.log('[ModeDetector] Integration script loaded');


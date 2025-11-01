/**
 * Model Management
 * Handles ONNX model loading and inference
 */

// Model configurations
const MODELS = [
  { name: 'yolov7-tiny_256x256.onnx', resolution: [256, 256] },
  { name: 'yolov7-tiny_320x320.onnx', resolution: [320, 320] },
  { name: 'yolov7-tiny_640x640.onnx', resolution: [640, 640] },
  { name: 'yolov10n.onnx', resolution: [256, 256] },
  { name: 'yolo11n.onnx', resolution: [256, 256] },
  { name: 'yolo12n.onnx', resolution: [256, 256] },
];

let currentModelIndex = 0;
let currentSession = null;
let loadAttempts = new Set(); // Track model load attempts to prevent infinite loops

/**
 * Get base path for static files
 * Detects if we're running from Firebase hosting (mode-detector subdirectory)
 * or from local server (current directory)
 * @returns {string} Base path for static files
 */
function getStaticBasePath() {
  // Check if we're in mode-detector subdirectory (Firebase hosting)
  const path = window.location.pathname;
  if (path.startsWith('/mode-detector/') || path.startsWith('/mode-detector')) {
    return '/mode-detector/static';
  }
  // Otherwise, use relative path (local development)
  return 'static';
}

/**
 * Configure ONNX Runtime Web
 * Note: Configuration should already be applied in index.html inline script
 * This function just verifies and re-applies the configuration
 */
function configureONNXRuntime() {
  if (typeof ort === 'undefined') {
    console.error('ONNX Runtime not loaded!');
    return false;
  }

  try {
    // Re-apply configuration to ensure it's set correctly
    // (in case inline script didn't run or was overridden)
    ort.env.wasm.simd = false;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    
    // Try to disable threaded if property exists
    try {
      if (ort.env.wasm && typeof ort.env.wasm.threaded !== 'undefined') {
        ort.env.wasm.threaded = false;
      }
    } catch (e) {
      // Property might not exist
    }

    console.log('✅ ONNX Runtime configuration verified:', {
      simd: ort.env.wasm.simd,
      numThreads: ort.env.wasm.numThreads,
      proxy: ort.env.wasm.proxy,
      wasmPaths: ort.env.wasm.wasmPaths || '(not set - will use CDN)'
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error configuring ONNX Runtime:', error);
    return false;
  }
}

/**
 * Load ONNX model
 * @param {string} modelName - Name of the model file
 * @param {boolean} isFallback - Whether this is a fallback attempt
 * @returns {Promise<ort.InferenceSession>} Inference session
 */
async function loadModel(modelName, isFallback = false) {
  // Prevent infinite loops - if we've tried this model before, don't retry
  if (loadAttempts.has(modelName)) {
    throw new Error(`Model ${modelName} already attempted. Skipping to prevent infinite loop.`);
  }
  loadAttempts.add(modelName);
  
  try {
    // Get correct base path based on deployment context
    const staticBase = getStaticBasePath();
    const modelUrl = `${staticBase}/models/${modelName}`;
    console.log(`Loading model: ${modelUrl}`);
    
    // Verify model URL is accessible
    try {
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`Model URL returned ${response.status}: ${response.statusText}`);
      }
      console.log('Model URL is accessible');
    } catch (fetchError) {
      console.error('Failed to fetch model:', fetchError);
      throw fetchError;
    }

    // Create session with basic WASM backend ONLY
    // CRITICAL: Use ONLY 'wasm' provider - no webgl, no cpu
    // ONNX Runtime will use basic WASM (not SIMD-threaded) based on our config
    const sessionOptions = {
      executionProviders: ['wasm'], // Only WASM, no WebGL
      graphOptimizationLevel: 'all'
    };
    
    console.log('Creating ONNX session with options:', sessionOptions);
    console.log('ONNX Runtime env state:', {
      simd: ort.env.wasm.simd,
      numThreads: ort.env.wasm.numThreads,
      proxy: ort.env.wasm.proxy
    });
    
    // Create session - ONNX Runtime should respect our config and use basic WASM
    const session = await ort.InferenceSession.create(modelUrl, sessionOptions);

    console.log('✅ Model loaded successfully');
    console.log('Input names:', session.inputNames);
    console.log('Output names:', session.outputNames);

    currentSession = session;
    loadAttempts.clear(); // Clear attempts on success
    return session;
  } catch (error) {
    console.error(`❌ Error loading model ${modelName}:`, error);
    
    // Only try fallback if this is the first attempt (not recursive fallback)
    if (!isFallback) {
      // Try ONE fallback model only - prevent infinite recursion
      const yolo7Models = MODELS.filter(m => m.name.includes('yolov7'));
      for (const model of yolo7Models) {
        if (model.name !== modelName && !loadAttempts.has(model.name)) {
          try {
            console.log(`Trying fallback model: ${model.name}`);
            const session = await loadModel(model.name, true);
            currentModelIndex = MODELS.findIndex(m => m.name === model.name);
            return session;
          } catch (altError) {
            console.error(`Fallback model ${model.name} also failed:`, altError);
            // Continue to next fallback or throw
          }
        }
      }
    }
    
    throw error;
  }
}

/**
 * Run model inference
 * @param {ort.InferenceSession} session - Inference session
 * @param {ort.Tensor} inputTensor - Preprocessed input tensor
 * @returns {Promise<[ort.Tensor, number]>} [outputTensor, inferenceTime]
 */
async function runInference(session, inputTensor) {
  try {
    if (!session) {
      throw new Error('Model session is null or undefined');
    }

    if (!session.inputNames || session.inputNames.length === 0) {
      throw new Error('Model has no input names defined');
    }

    const feeds = {};
    feeds[session.inputNames[0]] = inputTensor;

    const start = Date.now();
    const outputData = await session.run(feeds);
    const end = Date.now();
    const inferenceTime = end - start;

    const outputTensor = outputData[session.outputNames[0]];
    return [outputTensor, inferenceTime];
  } catch (error) {
    console.error('Error running inference:', error);
    throw new Error(`Model inference failed: ${error.message}`);
  }
}

/**
 * Get current model
 * @returns {{name: string, resolution: number[]}} Current model info
 */
function getCurrentModel() {
  return MODELS[currentModelIndex];
}

/**
 * Change to next model
 * @returns {{name: string, resolution: number[]}} New model info
 */
function changeModel() {
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  return MODELS[currentModelIndex];
}

/**
 * Get model by name
 * @param {string} modelName - Model name
 * @returns {{name: string, resolution: number[]}|null} Model info or null
 */
function getModelByName(modelName) {
  return MODELS.find(m => m.name === modelName) || null;
}


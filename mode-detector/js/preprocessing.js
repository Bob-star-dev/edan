/**
 * Image Preprocessing for YOLO Model
 * Converts canvas image to ONNX tensor format
 */

/**
 * Preprocess image for YOLO model
 * @param {CanvasRenderingContext2D} ctx - Canvas context with image
 * @param {number[]} modelResolution - [width, height] of model input
 * @returns {ort.Tensor} Preprocessed tensor ready for inference
 */
function preprocess(ctx, modelResolution) {
  // Check if ndarray is available
  if (typeof ndarray === 'undefined' || typeof ops === 'undefined') {
    // Only log once to avoid console spam
    if (!window._ndarrayFallbackLogged) {
      console.warn('[Preprocessing] ⚠️ ndarray library not loaded, using fallback preprocessing (slower but functional)');
      console.warn('[Preprocessing] 💡 This is not an error - fallback preprocessing works correctly');
      window._ndarrayFallbackLogged = true;
    }
    return preprocessFallback(ctx, modelResolution);
  }

  // ESP32-CAM: Try to use buffer canvas directly to avoid tainted canvas issues
  // The buffer canvas is created in camera.js and should be non-tainted
  let sourceCtx = ctx;
  if (typeof window !== 'undefined' && typeof window.getESP32BufferCanvas === 'function') {
    const bufferCanvas = window.getESP32BufferCanvas();
    if (bufferCanvas && bufferCanvas.width > 0 && bufferCanvas.height > 0) {
      // Create a temporary canvas context from the buffer canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bufferCanvas.width;
      tempCanvas.height = bufferCanvas.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (tempCtx) {
        try {
          // Draw from buffer canvas to temp canvas
          tempCtx.drawImage(bufferCanvas, 0, 0);
          // Test if temp canvas is not tainted by trying to read a pixel
          tempCtx.getImageData(0, 0, 1, 1);
          // If successful, use temp canvas as source
          sourceCtx = tempCtx;
        } catch (bufferError) {
          // Buffer canvas is also tainted, fall back to original ctx
          // This will be handled by the tainted canvas error below
        }
      }
    }
  }

  // Resize canvas to model resolution (not in place to avoid affecting original)
  const resizedCtx = resizeCanvasCtx(
    sourceCtx,
    modelResolution[0],
    modelResolution[1],
    false
  );

  // Get image data
  // Handle tainted canvas error (CORS issue with ESP32-CAM)
  let imageData;
  try {
    imageData = resizedCtx.getImageData(
      0,
      0,
      modelResolution[0],
      modelResolution[1]
    );
  } catch (taintedError) {
    // Canvas is tainted (CORS issue) - cannot read pixel data
    const now = Date.now();
    if (!window._lastTaintedCanvasErrorLog || now - window._lastTaintedCanvasErrorLog > 5000) {
      console.error('❌ Tainted canvas error - cannot read pixel data:', taintedError);
      console.error('💡 This happens when ESP32-CAM image is from different origin without CORS headers');
      console.error('💡 SOLUSI: Aktifkan CORS di ESP32-CAM firmware (Access-Control-Allow-Origin: *)');
      console.error('💡 Atau host aplikasi di domain yang sama dengan ESP32-CAM');
      if (typeof showError === 'function') {
        showError('❌ Canvas is tainted - cannot process frame for YOLO.\n\n💡 SOLUSI:\n1. Aktifkan CORS di ESP32-CAM firmware\n2. Atau host aplikasi di domain yang sama dengan ESP32-CAM');
      }
      window._lastTaintedCanvasErrorLog = now;
    }
    throw new Error('Canvas is tainted - cannot process frame for YOLO. Please check ESP32-CAM CORS settings or use buffer canvas.');
  }
  
  const { data, width, height } = imageData;

  // Convert to ndarray format [width, height, 4] (RGBA)
  const dataTensor = ndarray(new Float32Array(data), [width, height, 4]);
  
  // Create processed tensor [1, 3, height, width] (batch, channels, height, width)
  const dataProcessedTensor = ndarray(new Float32Array(width * height * 3), [
    1,
    3,
    height,
    width,
  ]);

  // Extract RGB channels (skip alpha channel)
  ops.assign(
    dataProcessedTensor.pick(0, 0, null, null),  // Red channel
    dataTensor.pick(null, null, 0)
  );
  ops.assign(
    dataProcessedTensor.pick(0, 1, null, null),  // Green channel
    dataTensor.pick(null, null, 1)
  );
  ops.assign(
    dataProcessedTensor.pick(0, 2, null, null),  // Blue channel
    dataTensor.pick(null, null, 2)
  );

  // Normalize pixel values from [0-255] to [0-1]
  ops.divseq(dataProcessedTensor, 255);

  // Convert to ONNX Tensor
  const tensor = new ort.Tensor('float32', new Float32Array(width * height * 3), [
    1,
    3,
    height,
    width,
  ]);

  // Copy data to tensor
  tensor.data.set(dataProcessedTensor.data);
  
  return tensor;
}

/**
 * Fallback preprocessing without ndarray library
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number[]} modelResolution - [width, height]
 * @returns {ort.Tensor} Preprocessed tensor
 */
function preprocessFallback(ctx, modelResolution) {
  // ESP32-CAM: Try to use buffer canvas directly to avoid tainted canvas issues
  let sourceCanvas = ctx.canvas;
  if (typeof window !== 'undefined' && typeof window.getESP32BufferCanvas === 'function') {
    const bufferCanvas = window.getESP32BufferCanvas();
    if (bufferCanvas && bufferCanvas.width > 0 && bufferCanvas.height > 0) {
      try {
        // Test if buffer canvas is not tainted
        const testCtx = bufferCanvas.getContext('2d', { willReadFrequently: true });
        testCtx.getImageData(0, 0, 1, 1);
        // If successful, use buffer canvas as source
        sourceCanvas = bufferCanvas;
      } catch (bufferError) {
        // Buffer canvas is also tainted, fall back to original canvas
        // This will be handled by the tainted canvas error below
      }
    }
  }

  // Create temporary canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = modelResolution[0];
  tempCanvas.height = modelResolution[1];
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  
  // Draw and scale image
  tempCtx.drawImage(sourceCanvas, 0, 0, modelResolution[0], modelResolution[1]);
  
  // Get image data
  // Handle tainted canvas error (CORS issue with ESP32-CAM)
  let imageData;
  try {
    imageData = tempCtx.getImageData(0, 0, modelResolution[0], modelResolution[1]);
  } catch (taintedError) {
    // Canvas is tainted (CORS issue) - cannot read pixel data
    const now = Date.now();
    if (!window._lastTaintedCanvasErrorLog || now - window._lastTaintedCanvasErrorLog > 5000) {
      console.error('❌ Tainted canvas error in fallback preprocessing:', taintedError);
      console.error('💡 This happens when ESP32-CAM image is from different origin without CORS headers');
      console.error('💡 SOLUSI: Aktifkan CORS di ESP32-CAM firmware (Access-Control-Allow-Origin: *)');
      console.error('💡 Atau host aplikasi di domain yang sama dengan ESP32-CAM');
      if (typeof showError === 'function') {
        showError('❌ Canvas is tainted - cannot process frame for YOLO.\n\n💡 SOLUSI:\n1. Aktifkan CORS di ESP32-CAM firmware\n2. Atau host aplikasi di domain yang sama dengan ESP32-CAM');
      }
      window._lastTaintedCanvasErrorLog = now;
    }
    throw new Error('Canvas is tainted - cannot process frame for YOLO. Please check ESP32-CAM CORS settings or use buffer canvas.');
  }
  
  const { data, width, height } = imageData;
  
  // Convert to tensor format [1, 3, height, width]
  // Normalize pixel values from [0-255] to [0-1]
  const tensorData = new Float32Array(width * height * 3);
  
  for (let i = 0; i < width * height; i++) {
    tensorData[i] = data[i * 4] / 255.0;                           // R
    tensorData[i + width * height] = data[i * 4 + 1] / 255.0;      // G
    tensorData[i + width * height * 2] = data[i * 4 + 2] / 255.0; // B
    // Skip alpha channel (data[i * 4 + 3])
  }
  
  return new ort.Tensor('float32', tensorData, [1, 3, height, width]);
}


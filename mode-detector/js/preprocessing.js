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
    console.warn('ndarray library not loaded, using fallback preprocessing');
    return preprocessFallback(ctx, modelResolution);
  }

  // Resize canvas to model resolution (not in place to avoid affecting original)
  const resizedCtx = resizeCanvasCtx(
    ctx,
    modelResolution[0],
    modelResolution[1],
    false
  );

  // Get image data
  const imageData = resizedCtx.getImageData(
    0,
    0,
    modelResolution[0],
    modelResolution[1]
  );
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
  // Create temporary canvas
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
    tensorData[i] = data[i * 4] / 255.0;                           // R
    tensorData[i + width * height] = data[i * 4 + 1] / 255.0;      // G
    tensorData[i + width * height * 2] = data[i * 4 + 2] / 255.0; // B
    // Skip alpha channel (data[i * 4 + 3])
  }
  
  return new ort.Tensor('float32', tensorData, [1, 3, height, width]);
}


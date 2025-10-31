import * as ort from 'onnxruntime-web';
import { InferenceSession, Tensor, env } from 'onnxruntime-web';

// Configure ONNX Runtime Web to use the correct WASM paths
// This must be set before creating any inference sessions
if (typeof window !== 'undefined') {
  // Point to where the WASM files are located in the public directory
  // Next.js serves files from /public/ under the root URL
  ort.env.wasm.wasmPaths = '/static/wasm/';
  
  // Use basic WASM (non-SIMD, non-threaded) for maximum compatibility
  ort.env.wasm.simd = false;
  ort.env.wasm.numThreads = 1;
  
  // Set base path for worker files
  ort.env.wasm.proxy = false;
  
  console.log('ONNX Runtime environment configured:', {
    wasmPaths: ort.env.wasm.wasmPaths,
    simd: ort.env.wasm.simd,
    numThreads: ort.env.wasm.numThreads
  });
}

export async function createModelCpu(url: string): Promise<InferenceSession> {
  try {
    console.log('Creating ONNX Runtime session with URL:', url);
    console.log('ONNX Runtime env:', {
      wasmPaths: ort.env.wasm.wasmPaths,
      simd: ort.env.wasm.simd,
      numThreads: ort.env.wasm.numThreads
    });
    
    // First, let's try to verify the model URL is accessible
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Model URL returned ${response.status}: ${response.statusText}`);
      }
      console.log('Model URL is accessible:', response.status);
    } catch (fetchError) {
      console.error('Failed to fetch model:', fetchError);
      throw fetchError;
    }
    
    // Create session with WASM provider
    const session = await ort.InferenceSession.create(url, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    
    console.log('Session created successfully');
    return session;
  } catch (error) {
    console.error('Failed to create ONNX Runtime session:', error);
    console.error('ONNX Runtime env:', {
      wasmPaths: ort.env.wasm.wasmPaths,
      simd: ort.env.wasm.simd,
      numThreads: ort.env.wasm.numThreads
    });
    
    // Provide more helpful error messages
    if (error instanceof Error) {
      if (error.message.includes('30004848') || error.message.includes('41548256')) {
        console.error('This is an ONNX model parsing error. The model file may be corrupted or incompatible.');
        console.error('Please verify the model files in public/static/models/ are valid ONNX files.');
      }
    }
    
    throw error;
  }
}

export async function runModel(
  model: InferenceSession,
  preprocessedData: Tensor
): Promise<[Tensor, number]> {
  try {
    // Check if model is null or undefined
    if (!model) {
      throw new Error('Model session is null or undefined. Model may not have loaded yet.');
    }
    
    // Check if model has input names
    if (!model.inputNames || model.inputNames.length === 0) {
      throw new Error('Model has no input names defined.');
    }
    
    const feeds: Record<string, Tensor> = {};
    feeds[model.inputNames[0]] = preprocessedData;
    const start = Date.now();
    const outputData = await model.run(feeds);
    const end = Date.now();
    const inferenceTime = end - start;
    const output = outputData[model.outputNames[0]];
    return [output, inferenceTime];
  } catch (e) {
    console.error('Error running model:', e);
    console.error('Model details:', {
      hasModel: !!model,
      inputNames: model?.inputNames,
      outputNames: model?.outputNames
    });
    throw new Error(`Model inference failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

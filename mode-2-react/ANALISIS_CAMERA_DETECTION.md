# Analisis Cara Kerja Camera Detection System

## 📋 Ringkasan

Sistem camera detection ini adalah aplikasi web berbasis React yang menggunakan **YOLO (You Only Look Once)** model untuk melakukan object detection real-time dari berbagai sumber kamera (webcam atau ESP32-CAM).

---

## 🏗️ Arsitektur Sistem

### Komponen Utama

1. **ObjectDetectionCamera.tsx** - Komponen utama yang menangani:
   - Capture frame dari kamera
   - Mengelola loop deteksi real-time
   - Menampilkan hasil deteksi

2. **Yolo.tsx** - Wrapper komponen yang menangani:
   - Loading model ONNX
   - Preprocessing gambar
   - Postprocessing hasil inference
   - Drawing bounding box dan label

3. **runModel.ts** - Utility untuk:
   - Membuat ONNX Runtime session
   - Menjalankan inference model
   - Mengukur waktu inference

4. **triangle_similarity_distance.ts** - Estimasi jarak menggunakan:
   - Triangle similarity algorithm
   - Database ukuran objek
   - Focal length calibration

---

## 🔄 Alur Kerja Sistem

### 1. Inisialisasi Komponen

```
Yolo.tsx (Parent)
  └─> Load Model ONNX dari /static/models/
      └─> Create InferenceSession menggunakan ONNX Runtime Web
          └─> Pass session ke ObjectDetectionCamera
```

**Lokasi kode:**
```37:80:mode-2-react/components/models/Yolo.tsx
useEffect(() => {
  const getSession = async () => {
    try {
      // Load model from the public/static directory
      console.log(`Loading model: /static/models/${modelName}`);
      const session = await runModelUtils.createModelCpu(
        `/static/models/${modelName}`
      );
      console.log('Model loaded successfully:', session);
      console.log('Model input names:', session.inputNames);
      console.log('Model output names:', session.outputNames);
      setSession(session);
    } catch (error) {
      // Error handling dengan fallback ke model alternatif
      // ...
    }
  };
  getSession();
}, [modelName, modelResolution]);
```

### 2. Inisialisasi Kamera

Sistem mendukung **2 sumber kamera**:

#### A. Webcam (MediaDevices API)

**Lokasi kode:**
```319:390:mode-2-react/components/ObjectDetectionCamera.tsx
useEffect(() => {
  if (cameraSource !== 'webcam' || !videoRef.current) return;
  
  const video = videoRef.current;
  let stream: MediaStream | null = null;

  const startWebcam = async () => {
    try {
      console.log('📹 Starting webcam...');
      setIsStreamReady(false);

      // Request webcam access
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (video) {
        video.srcObject = stream;
        video.play();
        
        video.onloadedmetadata = () => {
          console.log('✅ Webcam ready!');
          setIsStreamReady(true);
          setWebcamCanvasOverlaySize();
        };
      }
    } catch (error: any) {
      // Error handling untuk permission denied, no camera, dll
    }
  };

  startWebcam();
  
  return () => {
    // Cleanup: stop all tracks when component unmounts
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };
}, [cameraSource, facingMode]);
```

**Cara kerja:**
1. Request akses kamera menggunakan `navigator.mediaDevices.getUserMedia()`
2. Set stream ke `<video>` element
3. Tunggu metadata loaded untuk mendapatkan dimensi video
4. Set canvas overlay size sesuai dimensi video

#### B. ESP32-CAM

Sistem mendukung **2 mode** untuk ESP32-CAM:

**Mode Stream (MJPEG):**
- Polling cepat: 50-80ms per frame
- URL: `/api/esp32-stream`
- Menggunakan `<img>` tag dengan polling berurutan

**Mode Capture (JPEG):**
- Polling lebih lambat: 180ms per frame
- URL: `/api/esp32-capture`
- Fallback otomatis jika stream gagal

**Lokasi kode:**
```201:317:mode-2-react/components/ObjectDetectionCamera.tsx
useEffect(() => {
  if (cameraSource === 'webcam') return;
  
  // Baik stream maupun capture mode menggunakan img tag
  const isMjpegStream = espEndpointMode === 'stream';
  
  const setNextSrc = () => {
    if (isMjpegStream) {
      // Stream mode: polling cepat (50-80ms)
      if (!img) return;
      const url = `${ESP32_PROXY_STREAM_URL}?t=${Date.now()}`;
      img.src = url;
    } else {
      // Capture mode: polling lebih lama (180ms)
      if (!img) return;
      const url = `${ESP32_PROXY_CAPTURE_URL}?t=${Date.now()}`;
      img.src = url;
    }
  };

  const handleLoad = () => {
    // Update offscreen buffer dengan frame terakhir yang berhasil
    if (img.naturalWidth && img.naturalHeight) {
      const buf = espBufferCanvasRef.current;
      if (buf) {
        buf.width = img.naturalWidth;
        buf.height = img.naturalHeight;
        const bctx = buf.getContext('2d');
        if (bctx) {
          bctx.drawImage(img, 0, 0);
          espBufferHasFrameRef.current = true;
        }
      }
    }
    
    // Schedule next frame
    const delay = isMjpegStream ? 70 : 180;
    retryTimer = setTimeout(() => setNextSrc(), delay);
  };
  
  // Auto fallback ke /capture setelah beberapa kegagalan
  const handleError = (e: Event) => {
    espErrorCount.current += 1;
    if (isMjpegStream && espErrorCount.current >= 3) {
      console.warn('Switching ESP32 endpoint to /capture fallback.');
      setEspEndpointMode('capture');
    }
    if (!isMjpegStream) {
      retryTimer = setTimeout(() => setNextSrc(), 350);
    }
  };
  
  // ...
}, [cameraSource, espEndpointMode]);
```

**Fitur ESP32-CAM:**
- **Offscreen Buffer**: Menyimpan frame terakhir yang berhasil untuk menghindari gap saat loading
- **Auto Fallback**: Otomatis switch dari stream ke capture jika error
- **Error Retry**: Retry dengan delay lebih lama saat error

---

### 3. Capture Frame

Fungsi `capture()` mengambil frame dari sumber kamera dan menggambarnya ke canvas:

**Lokasi kode:**
```57:87:mode-2-react/components/ObjectDetectionCamera.tsx
const capture = () => {
  const canvas = videoCanvasRef.current!;
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  })!;

  if (cameraSource !== 'webcam') {
    // ESP32 mode: gunakan buffer dari offscreen canvas
    const buffer = espBufferCanvasRef.current;
    if (!buffer || !espBufferHasFrameRef.current) {
      return null;
    }
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  } else {
    // Capture dari webcam video
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      console.warn('Webcam video not ready');
      return null;
    }
    context.drawImage(
      videoRef.current,
      0, 0,
      canvas.width,
      canvas.height
    );
  }

  return context;
};
```

**Cara kerja:**
- **Webcam**: Menggambar frame langsung dari `<video>` element ke canvas
- **ESP32**: Menggambar dari offscreen buffer canvas (yang sudah di-update oleh img tag)

---

### 4. Preprocessing

Sebelum dijalankan ke model, gambar harus di-preprocess sesuai format yang dibutuhkan YOLO:

**Lokasi kode:**
```136:183:mode-2-react/components/models/Yolo.tsx
const preprocess = (ctx: CanvasRenderingContext2D) => {
  // 1. Resize canvas ke ukuran model (256x256, 320x320, atau 640x640)
  const resizedCtx = resizeCanvasCtx(
    ctx,
    modelResolution[0],
    modelResolution[1]
  );

  // 2. Ambil ImageData dari canvas
  const imageData = resizedCtx.getImageData(
    0, 0,
    modelResolution[0],
    modelResolution[1]
  );
  const { data, width, height } = imageData;
  
  // 3. Konversi ke tensor format [1, 3, width, height]
  // Format: Batch=1, Channels=3 (RGB), Width, Height
  const dataTensor = ndarray(new Float32Array(data), [width, height, 4]);
  const dataProcessedTensor = ndarray(new Float32Array(width * height * 3), [
    1, 3, width, height,
  ]);

  // 4. Extract RGB channels (skip alpha channel)
  ops.assign(
    dataProcessedTensor.pick(0, 0, null, null),
    dataTensor.pick(null, null, 0)  // Red channel
  );
  ops.assign(
    dataProcessedTensor.pick(0, 1, null, null),
    dataTensor.pick(null, null, 1)  // Green channel
  );
  ops.assign(
    dataProcessedTensor.pick(0, 2, null, null),
    dataTensor.pick(null, null, 2)  // Blue channel
  );

  // 5. Normalize pixel values: [0-255] -> [0-1]
  ops.divseq(dataProcessedTensor, 255);

  // 6. Convert ke ONNX Tensor format
  const tensor = new Tensor('float32', new Float32Array(width * height * 3), [
    1, 3, width, height,
  ]);

  (tensor.data as Float32Array).set(dataProcessedTensor.data);
  return tensor;
};
```

**Langkah preprocessing:**
1. **Resize** canvas ke ukuran model (256x256, 320x320, atau 640x640)
2. **Extract ImageData** dari canvas
3. **Separate RGB channels** (skip alpha channel ke-4)
4. **Normalize** nilai pixel dari 0-255 ke 0-1
5. **Convert** ke format tensor ONNX: `[1, 3, width, height]`

---

### 5. Model Inference

Model ONNX dijalankan menggunakan ONNX Runtime Web:

**Lokasi kode:**
```74:106:mode-2-react/utils/runModel.ts
export async function runModel(
  model: InferenceSession,
  preprocessedData: Tensor
): Promise<[Tensor, number]> {
  try {
    // Check if model is null or undefined
    if (!model) {
      throw new Error('Model session is null or undefined.');
    }
    
    // Check if model has input names
    if (!model.inputNames || model.inputNames.length === 0) {
      throw new Error('Model has no input names defined.');
    }
    
    // Prepare input tensor
    const feeds: Record<string, Tensor> = {};
    feeds[model.inputNames[0]] = preprocessedData;
    
    // Run inference dan ukur waktu
    const start = Date.now();
    const outputData = await model.run(feeds);
    const end = Date.now();
    const inferenceTime = end - start;
    
    // Extract output tensor
    const output = outputData[model.outputNames[0]];
    return [output, inferenceTime];
  } catch (e) {
    console.error('Error running model:', e);
    throw new Error(`Model inference failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}
```

**Cara kerja:**
1. Validasi model session
2. Siapkan input tensor sesuai input name model
3. Jalankan `model.run()` dengan input tensor
4. Ukur waktu inference (dalam milliseconds)
5. Return output tensor dan inference time

**ONNX Runtime Configuration:**
```1:23:mode-2-react/utils/runModel.ts
// Configure ONNX Runtime Web
if (typeof window !== 'undefined') {
  // Point to where the WASM files are located
  ort.env.wasm.wasmPaths = '/static/wasm/';
  
  // Use basic WASM (non-SIMD, non-threaded) for maximum compatibility
  ort.env.wasm.simd = false;
  ort.env.wasm.numThreads = 1;
  
  ort.env.wasm.proxy = false;
}
```

---

### 6. Postprocessing

Setelah inference, output tensor perlu di-postprocess untuk:
- Extract bounding boxes
- Filter berdasarkan confidence threshold
- Apply Non-Maximum Suppression (NMS)
- Calculate distance
- Draw bounding box dan label

#### Format Output Berbeda per Model

**YOLOv7:** `[det_num, 7]` - Format: `[batch_id, x0, y0, x1, y1, class_id, confidence]`

**YOLOv10:** `[1, all_boxes, 6]` - Format: `[x0, y0, x1, y1, confidence, class_id]`

**YOLOv11/v12:** `[1, 84, 1344]` - Format: 4 bbox coords + 80 class scores per anchor

**Lokasi kode untuk YOLOv7:**
```517:590:mode-2-react/components/models/Yolo.tsx
const postprocessYolov7: PostprocessFunction = (
  ctx: CanvasRenderingContext2D,
  modelResolution: number[],
  tensor: Tensor,
  conf2color: (conf: number) => string,
  focalLength: number = DEFAULT_FOCAL_LENGTH
) => {
  const dx = ctx.canvas.width / modelResolution[0];
  const dy = ctx.canvas.height / modelResolution[1];

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  
  // Iterate through all detections
  for (let i = 0; i < tensor.dims[0]; i++) {
    [batch_id, x0, y0, x1, y1, cls_id, score] = tensor.data.slice(
      i * 7,
      i * 7 + 7
    );

    // Scale coordinates ke ukuran canvas asli
    [x0, x1] = [x0, x1].map((x: any) => x * dx);
    [y0, y1] = [y0, y1].map((x: any) => x * dy);

    // Calculate distance menggunakan triangle similarity
    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;
    const distance = getObjectDistance(
      focalLength,
      cls_id,
      bboxWidth,
      bboxHeight,
      ctx.canvas.width
    );
    const distanceText = formatDistance(distance);

    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    
    // Draw label dengan distance
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(label, x0 + 5, y0 - 30);
    ctx.fillText(label, x0 + 5, y0 - 30);
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(distanceText, x0 + 5, y0 - 10);
    ctx.fillText(distanceText, x0 + 5, y0 - 10);

    // Fill dengan transparent color
    ctx.fillStyle = color.replace(')', ', 0.2)').replace('rgb', 'rgba');
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
};
```

**Langkah postprocessing:**
1. **Clear canvas** sebelumnya
2. **Iterate** semua detections dari output tensor
3. **Scale coordinates** dari model resolution ke canvas size
4. **Filter** berdasarkan confidence threshold (default: 0.25)
5. **Apply NMS** untuk menghilangkan overlapping boxes (YOLOv11/v12)
6. **Calculate distance** menggunakan triangle similarity
7. **Draw** bounding box, label, dan distance

---

### 7. Distance Estimation

Sistem menggunakan **Triangle Similarity** untuk estimasi jarak:

**Formula:**
```
distance = (real_width × focal_length) / pixel_width
```

**Lokasi kode:**
```178:209:mode-2-react/utils/triangle_similarity_distance.ts
export function getObjectDistance(
  focalLength: number,
  classId: number,
  boundingBoxWidth: number,
  boundingBoxHeight: number,
  canvasWidth: number = 640
): number {
  const objectSize = getObjectSize(classId);
  
  // Adjust focal length based on actual canvas resolution
  const resolutionScale = canvasWidth / 640;
  const adjustedFocalLength = focalLength * resolutionScale;
  
  // Use width for most objects, height for tall objects
  const isTallObject = boundingBoxHeight > boundingBoxWidth * 1.5;
  
  if (isTallObject) {
    // Use height for tall objects (person standing, bottles, etc)
    return calculateDistanceByHeight(
      adjustedFocalLength,
      objectSize.height,
      boundingBoxHeight
    );
  } else {
    // Use width for wider objects (cars, animals, etc)
    return calculateDistance(
      adjustedFocalLength,
      objectSize.width,
      boundingBoxWidth
    );
  }
}
```

**Cara kerja:**
1. Ambil ukuran real object dari database berdasarkan class ID
2. Adjust focal length sesuai resolusi canvas
3. Pilih menggunakan width atau height tergantung bentuk objek
4. Hitung jarak menggunakan triangle similarity

**Database Object Sizes:**
```115:155:mode-2-react/utils/triangle_similarity_distance.ts
export const objectSizes: Record<number, { width: number; height: number }> = {
  // People and animals
  0: { width: 14.3, height: 170 },      // person
  2: { width: 180, height: 150 },       // car
  5: { width: 250, height: 300 },       // bus
  // ... more objects
};
```

---

### 8. Live Detection Loop

Sistem dapat menjalankan deteksi secara kontinyu:

**Lokasi kode:**
```122:141:mode-2-react/components/ObjectDetectionCamera.tsx
const runLiveDetection = async () => {
  if (liveDetection.current) {
    liveDetection.current = false;
    return;
  }
  liveDetection.current = true;
  while (liveDetection.current) {
    const startTime = Date.now();
    const ctx = capture();
    if (!ctx) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      continue;
    }
    await runModel(ctx);
    setTotalTime(Date.now() - startTime);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  }
};
```

**Cara kerja:**
1. Set flag `liveDetection.current = true`
2. Loop terus menerus:
   - Capture frame dari kamera
   - Jalankan model inference
   - Update total time
   - Tunggu next frame menggunakan `requestAnimationFrame`
3. Stop jika `liveDetection.current = false` (dipanggil saat tombol Stop diklik)

---

## 📊 Struktur Data Flow

```
Camera Source
  ↓
Capture Frame (capture())
  ↓
Preprocessing (preprocess())
  ├─> Resize ke model resolution
  ├─> Extract RGB channels
  └─> Normalize [0-255] → [0-1]
  ↓
Model Inference (runModel())
  ├─> Input: Tensor [1, 3, W, H]
  └─> Output: Detection tensor (format berbeda per model)
  ↓
Postprocessing (postprocess())
  ├─> Parse detection results
  ├─> Apply NMS (untuk YOLOv11/v12)
  ├─> Calculate distance
  └─> Draw bounding box & label
  ↓
Display Canvas (videoCanvasRef)
```

---

## 🎯 Fitur Utama

### 1. Multi-Source Camera
- ✅ Webcam (front/back camera)
- ✅ ESP32-CAM (stream/capture mode)
- ✅ Auto fallback untuk ESP32

### 2. Multiple Model Support
- ✅ YOLOv7-tiny (256x256, 320x320, 640x640)
- ✅ YOLOv10n (256x256)
- ✅ YOLOv11n (256x256)
- ✅ YOLOv12n (256x256)

### 3. Real-time Detection
- ✅ Live detection loop dengan requestAnimationFrame
- ✅ Single capture mode
- ✅ Performance metrics (inference time, FPS)

### 4. Distance Estimation
- ✅ Triangle similarity algorithm
- ✅ Object size database
- ✅ Focal length calibration
- ✅ Smart unit formatting (cm/m)

### 5. Error Handling
- ✅ Model loading error dengan fallback
- ✅ Camera permission handling
- ✅ ESP32 connection retry
- ✅ Auto fallback stream → capture

---

## 🔧 Konfigurasi

### Model Resolution
Sistem mendukung berbagai resolusi model untuk trade-off antara akurasi dan performa:

```16:23:mode-2-react/components/models/Yolo.tsx
const RES_TO_MODEL: [number[], string][] = [
  [[256, 256], 'yolov7-tiny_256x256.onnx'],
  [[256, 256], 'yolo12n.onnx'],
  [[256, 256], 'yolo11n.onnx'],
  [[256, 256], 'yolov10n.onnx'],
  [[320, 320], 'yolov7-tiny_320x320.onnx'],
  [[640, 640], 'yolov7-tiny_640x640.onnx'],
];
```

**Trade-off:**
- **256x256**: Lebih cepat, kurang akurat (untuk objek kecil)
- **320x320**: Balance
- **640x640**: Lebih lambat, lebih akurat (untuk objek kecil/jauh)

### ESP32 Configuration
```34:36:mode-2-react/components/ObjectDetectionCamera.tsx
const ESP32_IP = '192.168.1.19';
const ESP32_STREAM_URL = `http://${ESP32_IP}:81/stream`;
const ESP32_CAPTURE_URL = `http://${ESP32_IP}/capture`;
```

### Confidence Threshold
Default: **0.25** (25% confidence minimum)

---

## 📈 Performance Considerations

### 1. ONNX Runtime Configuration
- Menggunakan WASM (non-SIMD, non-threaded) untuk kompatibilitas maksimal
- Model di-load sekali saat komponen mount
- Graph optimization level: 'all'

### 2. Canvas Optimization
- Offscreen buffer untuk ESP32 (menghindari gap saat loading)
- Canvas overlay untuk drawing bounding boxes
- `willReadFrequently: true` untuk capture context

### 3. Frame Rate Control
- Live detection menggunakan `requestAnimationFrame` (~60fps max)
- ESP32 stream mode: 70ms delay (~14fps)
- ESP32 capture mode: 180ms delay (~5.5fps)

---

## 🐛 Error Handling

### Camera Errors
- **NotAllowedError**: Permission denied → User harus allow camera access
- **NotFoundError**: No camera found → Show error message
- **ESP32 Error**: Auto retry dengan delay, fallback ke capture mode

### Model Errors
- Model loading failed → Try alternative YOLOv7 models
- Inference failed → Log error details, show error message

### Runtime Errors
- Frame not ready → Skip frame, wait 50ms
- Buffer not ready → Return null dari capture()

---

## 🔍 Key Technologies

1. **React** - UI framework
2. **TypeScript** - Type safety
3. **ONNX Runtime Web** - ML inference di browser
4. **YOLO Models** - Object detection models
5. **Canvas API** - Image processing & rendering
6. **MediaDevices API** - Webcam access
7. **NDArray** - Tensor operations
8. **Triangle Similarity** - Distance estimation algorithm

---

## 📝 Kesimpulan

Sistem camera detection ini adalah implementasi lengkap untuk object detection real-time di browser dengan fitur:
- ✅ Multi-source camera support
- ✅ Multiple YOLO model support
- ✅ Real-time inference dengan performa metrics
- ✅ Distance estimation menggunakan triangle similarity
- ✅ Robust error handling dan fallback mechanisms

Sistem dirancang untuk berjalan sepenuhnya di browser tanpa backend server, menggunakan WebAssembly untuk menjalankan model ONNX.


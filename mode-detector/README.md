# Object Detection - Native HTML/CSS/JavaScript

Versi lengkap aplikasi **Real-Time Object Detection** menggunakan **vanilla HTML, CSS, dan JavaScript** tanpa framework React atau library lainnya (kecuali ONNX Runtime Web dan ndarray untuk tensor operations).

## ✨ Fitur

- ✅ **Webcam Detection** - Deteksi objek dari webcam laptop/PC
- ✅ **ESP32-CAM Support** - Deteksi objek dari ESP32-CAM (stream/capture mode)
- ✅ **Multiple YOLO Models** - Support YOLOv7, YOLOv10, YOLOv11, YOLOv12
- ✅ **Real-time Detection** - Live detection dengan performance metrics
- ✅ **Single Frame Capture** - Capture dan deteksi single frame
- ✅ **Distance Estimation** - Estimasi jarak menggunakan triangle similarity
- ✅ **Performance Metrics** - Inference time, FPS, efficiency tracking
- ✅ **Multi-Resolution Support** - 256×256, 320×320, 640×640
- ✅ **Modern UI** - Glassmorphism design dengan gradient effects

## 📁 Struktur File

```
mode-detector/
├── index.html              # HTML structure
├── styles.css             # Styling
├── README.md              # Dokumentasi
└── js/
    ├── yoloClasses.js      # YOLO class names (80 classes)
    ├── utils.js            # Utility functions
    ├── distance.js         # Distance estimation
    ├── preprocessing.js    # Image preprocessing
    ├── postprocessing.js   # Detection postprocessing
    ├── model.js            # Model loading & inference
    ├── camera.js           # Camera management
    └── main.js             # Main application logic
```

## 🚀 Cara Menggunakan

### 1. Setup File Structure

Pastikan file struktur berikut ada:
- `mode-detector/index.html`
- `mode-detector/styles.css`
- `mode-detector/js/*.js` (semua file JavaScript)
- `mode-detector/static/models/*.onnx` (model files)
- `mode-detector/static/wasm/*.wasm` (ONNX Runtime WASM files)

### 2. Serve dengan HTTP Server

**PENTING**: File harus di-serve via HTTP server, tidak bisa dibuka langsung (file://) karena:
- ES modules require CORS
- ONNX Runtime memerlukan fetch API
- Camera API memerlukan secure context (HTTPS atau localhost)

**Option 1: Python HTTP Server**
```bash
cd mode-detector
python -m http.server 8000
```

**Option 2: Node.js HTTP Server**
```bash
npx http-server mode-detector -p 8000
```

**Option 3: VS Code Live Server**
- Install extension "Live Server"
- Right click `index.html` → "Open with Live Server"

**Option 4: PHP Built-in Server**
```bash
php -S localhost:8000
```

### 3. Akses di Browser

Buka browser dan akses: `http://localhost:8000`

**Catatan**: 
- Camera memerlukan permission dari user
- Beberapa browser memerlukan HTTPS untuk camera (kecuali localhost)
- Pastikan model files ada di `/static/models/`

## 📦 Dependencies

### External Libraries (via CDN)

1. **ONNX Runtime Web** - Untuk menjalankan model ONNX di browser
   ```html
   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
   ```

2. **NDArray** - Untuk tensor operations (opsional, ada fallback)
   ```html
   <script src="https://cdn.jsdelivr.net/npm/ndarray@1/dist/ndarray.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/ndarray-ops@1/dist/ndarray-ops.js"></script>
   ```

### Model Files

Pastikan model ONNX ada di `/static/models/`:
- `yolov7-tiny_256x256.onnx`
- `yolov7-tiny_320x320.onnx`
- `yolov7-tiny_640x640.onnx`
- `yolov10n.onnx`
- `yolo11n.onnx`
- `yolo12n.onnx`

### WASM Files

**PENTING**: ONNX Runtime WASM files akan otomatis di-download jika tidak ada, tapi untuk menghindari error CORS:

**Option 1: Download Manual (Recommended)**
Download dari: https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/static/
Copy ke `/static/wasm/`:
- `ort-wasm.wasm` (minimum required)
- Atau gunakan semua file untuk best performance

**Option 2: Let ONNX Runtime Auto-Download**
ONNX Runtime akan otomatis download dari CDN jika file tidak ditemukan secara local.

## 🔧 Konfigurasi

### ESP32-CAM Configuration

Edit `js/camera.js` untuk mengubah DNS ESP32:
```javascript
const ESP32_DNS = 'esp32cam.local'; // Ganti dengan DNS ESP32 Anda
```

### Model Selection

Edit `js/model.js` untuk menambah/mengubah daftar model:
```javascript
const MODELS = [
  { name: 'yolov7-tiny_256x256.onnx', resolution: [256, 256] },
  // Tambah model baru di sini
];
```

### Focal Length

Edit `js/main.js` untuk mengubah focal length (untuk distance estimation):
```javascript
const appState = {
  focalLength: 800 // Calibrate sesuai kamera Anda
};
```

## 📊 Performance

### Model Resolution Trade-offs

- **256×256**: Lebih cepat (~10-20ms), kurang akurat untuk objek kecil
- **320×320**: Balance speed/accuracy (~15-30ms)
- **640×640**: Lebih lambat (~30-60ms), lebih akurat untuk objek kecil/jauh

### Optimization Tips

1. **Gunakan model resolusi lebih kecil** untuk performa lebih baik
2. **Stop live detection** saat tidak digunakan
3. **Gunakan ESP32 stream mode** (lebih cepat dari capture mode)
4. **Tutup tab lain** untuk mengurangi CPU usage

## 🐛 Troubleshooting

### Model tidak load

**Gejala**: Error "Failed to load model" atau "Model URL returned 404"

**Solusi**:
1. Pastikan model files ada di `/static/models/`
2. Check path di browser console (Network tab)
3. Pastikan HTTP server berjalan dengan benar
4. Check CORS policy jika pakai server berbeda

### Camera tidak muncul

**Gejala**: "Camera permission denied" atau "No camera found"

**Solusi**:
1. Allow camera permission di browser
2. Pastikan camera tidak digunakan aplikasi lain
3. Check browser settings untuk camera access
4. Pastikan menggunakan HTTPS atau localhost

### ESP32 tidak connect

**Gejala**: "ESP32-CAM connection failed"

**Solusi**:
1. Pastikan ESP32 dan komputer di network yang sama
2. Check DNS ESP32 (edit di `camera.js`)
3. Pastikan ESP32 server running dan accessible
4. Coba akses URL langsung di browser: `http://esp32cam.local:81/stream`

### ONNX Runtime Error

**Gejala**: "ONNX Runtime not loaded" atau WASM error

**Solusi**:
1. Check console untuk error details
2. Pastikan WASM files ada di `/static/wasm/`
3. Pastikan path WASM benar di `model.js`
4. Check browser compatibility (Chrome/Firefox recommended)

### NDArray not found

**Gejala**: Warning "ndarray library not loaded"

**Solusi**:
- Tidak masalah! Aplikasi akan otomatis menggunakan fallback preprocessing
- Atau pastikan CDN untuk ndarray dapat diakses

## 📝 Catatan Penting

### Browser Compatibility

- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ⚠️ Safari (may need additional configuration)
- ❌ Internet Explorer (not supported)

### Camera Permissions

- Browser akan meminta permission untuk camera access
- Beberapa browser memerlukan HTTPS untuk camera (kecuali localhost)
- Permission dapat di-manage di browser settings

### Model Files Size

- Model files cukup besar (~5-20MB per model)
- Pastikan hosting/server support file besar
- Consider CDN untuk production deployment

## 🔄 Update History

### v1.0.0 (Current)
- ✅ Full vanilla JS implementation
- ✅ Support semua model YOLO (v7, v10, v11, v12)
- ✅ Webcam dan ESP32-CAM support
- ✅ Distance estimation
- ✅ Performance metrics
- ✅ Modern UI design

## 📚 Referensi

- [ONNX Runtime Web Documentation](https://onnxruntime.ai/docs/tutorials/web/)
- [MediaDevices API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [YOLO Models](https://github.com/ultralytics/ultralytics)

## 📄 License

Same as parent project.

---

**Dibuat sebagai versi native HTML/CSS/JS dari React implementation**


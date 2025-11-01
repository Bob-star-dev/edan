# Setup Instructions

## Quick Start

### 1. Copy Model Files

Copy model files ke folder `static/models/`:
```
mode-detector/
└── static/
    ├── models/
    │   ├── yolov7-tiny_256x256.onnx
    │   ├── yolov7-tiny_320x320.onnx
    │   ├── yolov7-tiny_640x640.onnx
    │   ├── yolov10n.onnx
    │   ├── yolo11n.onnx
    │   └── yolo12n.onnx
    └── wasm/
        ├── ort-wasm.wasm
        ├── ort-wasm-simd.wasm
        ├── ort-wasm-threaded.wasm
        └── ort-wasm-simd-threaded.wasm
```

### 2. Download WASM Files (Optional)

Jika WASM files belum ada, mereka akan otomatis di-download oleh ONNX Runtime. Atau download manual dari:
- https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/

Copy ke folder `static/wasm/`

### 3. Start HTTP Server

```bash
# Python
python -m http.server 8000

# Node.js
npx http-server -p 8000

# PHP
php -S localhost:8000
```

### 4. Open in Browser

Buka: `http://localhost:8000`

## File Structure

```
mode-detector/
├── index.html          # Main HTML file
├── styles.css          # Styling
├── README.md           # Documentation
├── SETUP.md           # This file
├── .gitignore         # Git ignore rules
└── js/
    ├── main.js        # Main application (loads first)
    ├── yoloClasses.js # YOLO classes (80 classes)
    ├── utils.js       # Utility functions
    ├── distance.js    # Distance estimation
    ├── preprocessing.js # Image preprocessing
    ├── postprocessing.js # Detection postprocessing
    ├── model.js       # Model management
    └── camera.js      # Camera management
```

## Script Loading Order

Scripts di-load dalam urutan ini (di `index.html`):

1. ONNX Runtime Web (CDN)
2. NDArray libraries (CDN)
3. `yoloClasses.js` - Class definitions
4. `utils.js` - Helper functions
5. `distance.js` - Distance functions
6. `preprocessing.js` - Preprocessing (uses utils)
7. `postprocessing.js` - Postprocessing (uses utils, distance, yoloClasses)
8. `model.js` - Model management
9. `camera.js` - Camera management
10. `main.js` - Main app (uses all above)

## Troubleshooting

### Models tidak ditemukan
- Pastikan folder `static/models/` ada
- Check path: `/static/models/model-name.onnx`
- Verify file exists dan accessible

### WASM tidak load
- Pastikan folder `static/wasm/` ada
- ONNX Runtime akan otomatis download jika tidak ada
- Check browser console untuk error details

### Camera tidak muncul
- Allow camera permission
- Pastikan menggunakan HTTP (bukan file://)
- Check browser compatibility

## Testing

1. **Test Webcam**: Klik "Webcam" → Allow permission → Should see video
2. **Test Model Load**: Check console untuk "Model loaded successfully"
3. **Test Detection**: Klik "Capture" → Should see bounding boxes
4. **Test Live**: Klik "Live Detection" → Should see real-time detection

## Next Steps

- Customize ESP32 IP di `js/camera.js`
- Adjust focal length di `js/main.js` untuk distance estimation
- Add more models di `js/model.js`
- Customize UI di `styles.css`


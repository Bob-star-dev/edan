# Object Detection - Vanilla JavaScript Example

Ini adalah contoh implementasi **vanilla HTML/CSS/JavaScript** dari sistem camera detection yang awalnya berbasis React.

## ✅ Fitur

- ✅ Webcam detection (front/back camera)
- ✅ ESP32-CAM support (stream/capture mode)
- ✅ Multiple YOLO model support
- ✅ Real-time live detection
- ✅ Single frame capture
- ✅ Performance metrics (FPS, inference time)
- ✅ No React dependencies!

## 📁 Struktur File

```
example-vanilla-js/
├── index.html      # HTML structure
├── app.js          # Main application logic
└── README.md       # This file
```

## 🚀 Cara Menggunakan

### 1. Setup Files

Pastikan file-file berikut ada:
- `index.html`
- `app.js`
- Model ONNX di `/static/models/` (yolov7-tiny_256x256.onnx, dll)
- ONNX Runtime WASM di `/static/wasm/`

### 2. Serve dengan HTTP Server

Karena menggunakan ES modules dan fetch, harus di-serve via HTTP (tidak bisa buka langsung file://).

**Option 1: Python HTTP Server**
```bash
cd example-vanilla-js
python -m http.server 8000
```
Lalu buka: `http://localhost:8000`

**Option 2: Node.js HTTP Server**
```bash
npx http-server example-vanilla-js -p 8000
```

**Option 3: VS Code Live Server**
- Install extension "Live Server"
- Right click `index.html` → "Open with Live Server"

### 3. Akses di Browser

Buka browser dan akses `http://localhost:8000`

## 📝 Catatan Penting

### 1. Preprocessing Simplified

File `app.js` menggunakan versi **simplified preprocessing** tanpa library `ndarray`. 

Untuk versi lengkap yang sama dengan React version, perlu:
- Install `ndarray` dan `ndarray-ops`
- Atau gunakan versi dengan CDN (lihat KONVERSI_KE_VANILLA_JS.md)

### 2. Postprocessing

Saat ini hanya support **YOLOv7 format**. Untuk YOLOv10/v11/v12, perlu tambahkan postprocessing function yang sesuai (lihat `Yolo.tsx` di folder utama).

### 3. Distance Estimation

Distance estimation belum diimplementasikan di contoh ini. Untuk menambahkannya:
- Copy function dari `triangle_similarity_distance.ts`
- Integrate ke postprocessing function

### 4. ESP32-CAM

Untuk menggunakan ESP32-CAM, pastikan:
- ESP32 sudah terhubung ke network yang sama
- Update `ESP32_IP` di `app.js` sesuai IP ESP32 Anda
- Setup API proxy di backend (jika perlu)

## 🔄 Perbedaan dengan React Version

| Aspek | React Version | Vanilla JS Version |
|-------|--------------|-------------------|
| State Management | useState hooks | JavaScript objects |
| Lifecycle | useEffect | Event listeners |
| DOM Refs | useRef | querySelector |
| Conditional Rendering | JSX conditionals | Manual DOM updates |
| Build Step | Required (Next.js) | Optional (jika pakai CDN) |
| Bundle Size | ~40KB React | 0KB (no framework) |

## ✅ Keuntungan Vanilla JS

1. **Lebih Ringan**: Tidak ada React bundle
2. **Lebih Cepat**: Tidak ada virtual DOM overhead
3. **Lebih Sederhana**: Tidak perlu build step
4. **Lebih Universal**: Bisa langsung di-hosting di static hosting
5. **Lebih Mudah Debug**: Code langsung, tidak ada abstraction

## ⚠️ Trade-offs

1. **Manual DOM Updates**: Harus manual update DOM setelah state berubah
2. **No TypeScript**: Tidak ada type checking (bisa pakai JSDoc)
3. **No Hot Reload**: Perlu refresh manual (kecuali pakai Live Server)
4. **More Verbose**: Lebih banyak code untuk hal yang sama

## 🔧 Customization

### Menambah Model

Edit array `MODELS` di `app.js`:
```javascript
const MODELS = [
  { name: 'yolov7-tiny_256x256.onnx', resolution: [256, 256] },
  { name: 'yolov10n.onnx', resolution: [256, 256] },
  // Tambah model baru di sini
];
```

### Mengubah ESP32 IP

Edit di `app.js`:
```javascript
const ESP32_IP = '192.168.1.19'; // Ganti dengan IP ESP32 Anda
```

### Menambah Fitur

Struktur code sudah modular, mudah untuk menambah fitur:
- Distance estimation: tambah di `postprocess()`
- Object filtering: tambah filter di `postprocess()`
- Export detection: tambah function baru
- Recording: tambah MediaRecorder API

## 📚 Next Steps

1. **Implement Full Preprocessing**: Tambah ndarray library untuk preprocessing lengkap
2. **Add Distance Estimation**: Integrate triangle similarity
3. **Support More Models**: Tambah postprocessing untuk YOLOv10/v11/v12
4. **Add NMS**: Implement Non-Maximum Suppression
5. **Improve Error Handling**: Tambah retry logic dan better error messages
6. **Add Configuration UI**: Allow user to adjust confidence threshold, dll

## 🐛 Troubleshooting

### Model tidak load
- Pastikan path model benar: `/static/models/model-name.onnx`
- Check browser console untuk error details
- Pastikan ONNX Runtime WASM files ada di `/static/wasm/`

### Camera tidak muncul
- Pastikan sudah allow camera permission
- Check browser console untuk error
- Pastikan menggunakan HTTPS atau localhost (beberapa browser require HTTPS untuk camera)

### ESP32 tidak connect
- Pastikan ESP32 dan komputer di network yang sama
- Check IP address ESP32
- Pastikan ESP32 server running dan accessible

## 📖 Referensi

- [ONNX Runtime Web Docs](https://onnxruntime.ai/docs/tutorials/web/)
- [MediaDevices API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices)
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

---

**Dibuat sebagai contoh konversi dari React ke Vanilla JS**


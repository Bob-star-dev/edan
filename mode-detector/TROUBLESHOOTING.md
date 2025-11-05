# Troubleshooting Guide

## ⚠️ ERR_NAME_NOT_RESOLVED (DNS tidak bisa di-resolve)

**Gejala:** Error `net::ERR_NAME_NOT_RESOLVED` saat mencoba connect ke ESP32-CAM

**Penyebab:** mDNS (`esp32cam.local`) tidak bekerja di Windows desktop

**Solusi:** Gunakan IP address langsung

### Cara menemukan IP ESP32-CAM:

1. **Dari Serial Monitor (Paling Mudah):**
   - Buka Arduino IDE
   - Buka Serial Monitor (Tools > Serial Monitor)
   - Set baud rate ke 115200
   - ESP32-CAM akan menampilkan IP setelah connect WiFi:
     ```
     ✅ WiFi connected! IP: 192.168.1.100
     ```

2. **Dari Router WiFi:**
   - Login ke router WiFi Anda
   - Cari device dengan nama "esp32cam" atau "ESP32"
   - Lihat IP address yang diberikan

3. **Dari Network Scanner:**
   - Install aplikasi network scanner (contoh: Angry IP Scanner)
   - Scan network Anda
   - Cari device dengan MAC address ESP32

### Cara mengatur IP di aplikasi:

1. Buka file `mode-detector/js/camera.js`
2. Cari baris ~109: `const ESP32_IP = null;`
3. Ubah menjadi: `const ESP32_IP = '192.168.1.100';` (gunakan IP ESP32-CAM Anda)
4. Save file
5. Refresh browser

**Contoh:**
```javascript
const ESP32_IP = '192.168.1.100'; // IP ESP32-CAM Anda
```

---

## Error: "DEFAULT_FOCAL_LENGTH has already been declared"

**Penyebab**: `DEFAULT_FOCAL_LENGTH` didefinisikan di lebih dari satu file.

**Solusi**: Sudah diperbaiki. Pastikan script di-load dalam urutan yang benar di `index.html`:
```html
<script src="js/distance.js"></script>  <!-- Defines DEFAULT_FOCAL_LENGTH -->
<script src="js/postprocessing.js"></script>  <!-- Uses it -->
```

---

## Error: "Failed to resolve module specifier '/static/wasm/ort-wasm-simd-threaded.jsep.mjs'"

**Penyebab**: ONNX Runtime mencoba menggunakan SIMD-threaded backend yang memerlukan file worker yang kompleks, tapi file tersebut tidak ada atau tidak dapat diakses karena CORS.

**Solusi**:

### Solusi 1: Download WASM Files Manual

Download basic WASM files dari CDN:
```bash
# Create wasm directory
mkdir -p static/wasm

# Download basic WASM file (no SIMD, no threading)
curl -o static/wasm/ort-wasm.wasm https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/static/wasm/ort-wasm.wasm
```

### Solusi 2: Gunakan CDN untuk ONNX Runtime (No Local WASM)

Jika local WASM files bermasalah, ONNX Runtime akan otomatis menggunakan CDN. Pastikan:
- Koneksi internet aktif
- Tidak ada firewall yang block CDN

### Solusi 3: Update ONNX Runtime Configuration

File sudah dikonfigurasi untuk menggunakan basic WASM (no SIMD, no threading). Pastikan konfigurasi di `js/model.js` sudah benar:

```javascript
ort.env.wasm.simd = false;
ort.env.wasm.numThreads = 1;
ort.env.wasm.threaded = false;
```

### Solusi 4: Check HTTP Server

Pastikan HTTP server memberikan proper CORS headers dan MIME types:

```python
# Python HTTP Server dengan CORS
python -m http.server 8000 --bind 127.0.0.1
```

Atau gunakan server yang lebih advance seperti:
```bash
npx http-server -p 8000 --cors
```

---

## Error: Model tidak load (infinite retry loop)

**Penyebab**: Fallback mechanism mencoba model lain terus menerus tanpa limit.

**Solusi**: Sudah diperbaiki dengan menambahkan limit pada retry. Refresh halaman dan check console untuk error details.

---

## Error: Camera permission denied

**Penyebab**: Browser memblokir akses kamera.

**Solusi**:
1. Allow camera permission saat diminta
2. Check browser settings: `chrome://settings/content/camera`
3. Pastikan menggunakan HTTPS atau localhost (bukan file://)
4. Beberapa browser memerlukan HTTPS untuk camera (kecuali localhost)

---

## Model loading sangat lambat

**Penyebab**: Model files besar dan download lambat.

**Solusi**:
1. Pastikan model files ada di local (`/static/models/`)
2. Check Network tab di browser DevTools untuk melihat download progress
3. Gunakan model resolusi lebih kecil (256x256) untuk loading lebih cepat

---

## Detection tidak akurat

**Penyebab**: Beberapa kemungkinan:
- Model resolusi terlalu kecil
- Confidence threshold terlalu tinggi/rendah
- Objek terlalu kecil atau terlalu jauh

**Solusi**:
1. Gunakan model resolusi lebih besar (640x640) untuk akurasi lebih baik
2. Adjust confidence threshold (default: 0.25) di `postprocessing.js`
3. Pastikan lighting dan angle kamera baik

---

## FPS sangat rendah

**Penyebab**: 
- Model resolusi terlalu besar
- CPU tidak cukup kuat
- Browser terlalu banyak tab terbuka

**Solusi**:
1. Gunakan model resolusi lebih kecil (256x256)
2. Tutup tab lain
3. Gunakan browser yang lebih modern (Chrome/Firefox recommended)
4. Stop live detection saat tidak digunakan

---

## ESP32-CAM tidak connect

**Penyebab**:
- ESP32 dan komputer tidak di network yang sama
- IP address salah
- ESP32 server tidak running

**Solusi**:
1. Check DNS ESP32 di `js/camera.js`
2. Pastikan ESP32 dan komputer di network WiFi yang sama
3. Test URL langsung di browser: `http://esp32cam.local:81/stream`
4. Coba switch ke "Capture" mode (lebih reliable dari Stream)

---

## Console errors setelah fix

Jika masih ada error setelah fix, coba:

1. **Hard Refresh**: `Ctrl+Shift+R` (Windows) atau `Cmd+Shift+R` (Mac)
2. **Clear Browser Cache**: Clear cache dan reload
3. **Check Console**: Pastikan semua script di-load tanpa error
4. **Check Network Tab**: Pastikan semua resource (models, wasm) berhasil di-load

Jika masih bermasalah, check:
- Browser compatibility (Chrome/Firefox recommended)
- JavaScript console untuk error details
- Network tab untuk failed requests


# Panduan Setup YOLO Object Detection untuk Aplikasi Navigasi

## Ringkasan

Sistem deteksi objek YOLO terintegrasi dengan aplikasi navigasi web. Deteksi akan berjalan di background saat navigasi aktif dan mengirim sinyal vibrate ke ESP32-C3 ketika objek terdeteksi pada jarak < 1.5m.

## Komponen

1. **Backend Server** (`yolo_backend_server.py`) - Server Python yang menjalankan deteksi di background
2. **Frontend Integration** (`map/yolo-detector-integration.js`) - JavaScript untuk komunikasi dengan backend
3. **ESP32-CAM** - Kamera untuk capture gambar
4. **ESP32-C3** - Vibrator untuk feedback haptic

## Setup

### 1. Install Dependencies

```bash
cd ESP32CAM_YOLOv3
pip install -r requirements.txt
```

### 2. Pastikan File YOLO Tersedia

Pastikan folder `YOLO/` berisi:
- `yolov3.weights`
- `yolov3.cfg`
- `coco.names.id`

### 3. Konfigurasi ESP32-CAM

Edit `detect.py` jika perlu mengubah:
- `CAMERA_URL_MDNS`: URL mDNS (default: "http://senavision.local/cam.jpg")
- `CAMERA_URL_IP`: URL IP (default: "http://192.168.1.97/cam.jpg")
- `VIBRATE_DISTANCE_THRESHOLD`: Jarak threshold (default: 1.5m)

### 4. Jalankan Backend Server

```bash
python yolo_backend_server.py
```

Server akan berjalan di `http://127.0.0.1:5000`

### 5. Buka Aplikasi Web

Buka `map/map.html` di browser. File `yolo-detector-integration.js` sudah terintegrasi.

## Cara Kerja

1. **Saat Navigasi Dimulai:**
   - Aplikasi web memanggil `YOLODetector.activate()`
   - Backend server mulai deteksi objek di background
   - Frame dari ESP32-CAM diproses setiap ~0.3 detik

2. **Saat Deteksi Objek:**
   - Jika jarak < 1.5m:
     - Objek di kiri → kirim sinyal ke `/left` → vibrator kiri aktif
     - Objek di kanan → kirim sinyal ke `/right` → vibrator kanan aktif
   - Hasil deteksi tersedia via API `/api/detections`

3. **Saat Navigasi Berakhir:**
   - Aplikasi web memanggil `YOLODetector.deactivate()`
   - Backend server menghentikan deteksi

## Testing

### Test Backend Server

```bash
# Check status
curl http://127.0.0.1:5000/api/status

# Start detection
curl -X POST http://127.0.0.1:5000/api/start

# Get detections
curl http://127.0.0.1:5000/api/detections

# Stop detection
curl -X POST http://127.0.0.1:5000/api/stop
```

### Test dari Browser Console

```javascript
// Initialize
await YOLODetector.init();

// Activate
await YOLODetector.activate();

// Check status
await YOLODetector.getDetailedStatus();

// Deactivate
await YOLODetector.deactivate();
```

## Troubleshooting

### Backend server tidak bisa diakses
- Pastikan server sudah running di port 5000
- Check firewall settings
- Pastikan CORS enabled

### ESP32-CAM tidak terhubung
- Check WiFi connection
- Verify IP address di `detect.py`
- Test dengan browser: `http://senavision.local/cam.jpg`

### Deteksi tidak aktif saat navigasi
- Check browser console untuk error
- Pastikan `yolo-detector-integration.js` sudah di-load
- Verify backend server running

### Vibrator tidak bergetar
- Check koneksi ESP32-C3 ke WiFi
- Verify IP ESP32-C3 di `ESP32CAM_Capture.ino`
- Test endpoint manual: `http://192.168.1.27/left` atau `/right`

## Catatan

- Backend server harus running sebelum navigasi dimulai
- Deteksi berjalan di background thread, tidak blocking navigasi
- Frame rate: ~3 FPS untuk mengurangi beban CPU
- Debouncing: 0.5 detik untuk mencegah spam request vibrate


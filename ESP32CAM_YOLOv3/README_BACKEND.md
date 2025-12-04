# YOLO Object Detection Backend Server

Backend server untuk menjalankan deteksi objek YOLO di background dan terintegrasi dengan aplikasi navigasi web.

## Instalasi

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Pastikan file-file YOLO sudah ada di folder `YOLO/`:
   - `yolov3.weights`
   - `yolov3.cfg`
   - `coco.names.id`

3. Pastikan ESP32-CAM sudah terhubung ke WiFi dan dapat diakses.

## Menjalankan Server

```bash
python yolo_backend_server.py
```

Server akan berjalan di `http://127.0.0.1:5000`

## API Endpoints

### GET /api/status
Mendapatkan status server dan deteksi saat ini.

**Response:**
```json
{
  "running": true,
  "camera_url": "http://senavision.local/cam.jpg",
  "last_result": {
    "objects": [...],
    "timestamp": 1234567890,
    "status": "running"
  }
}
```

### POST /api/start
Memulai deteksi objek di background.

**Response:**
```json
{
  "success": true,
  "message": "Detection started",
  "camera_url": "http://senavision.local/cam.jpg"
}
```

### POST /api/stop
Menghentikan deteksi objek.

**Response:**
```json
{
  "success": true,
  "message": "Detection stopped"
}
```

### GET /api/check-camera
Memeriksa koneksi ke ESP32-CAM.

**Response:**
```json
{
  "connected": true,
  "url": "http://senavision.local/cam.jpg"
}
```

### GET /api/detections
Mendapatkan hasil deteksi terbaru.

**Response:**
```json
{
  "objects": [
    {
      "label": "person",
      "confidence": 0.85,
      "distance": 1.2,
      "side": "left",
      "bbox": {"x": 100, "y": 150, "w": 80, "h": 200}
    }
  ],
  "timestamp": 1234567890,
  "status": "running",
  "closest_distance": 1.2,
  "objects_too_close": {
    "left": true,
    "right": false,
    "count_left": 1,
    "count_right": 0
  }
}
```

## Integrasi dengan Aplikasi Web

Backend server terintegrasi dengan aplikasi web melalui file `map/yolo-detector-integration.js`.

Deteksi akan otomatis aktif saat navigasi dimulai dan berhenti saat navigasi berakhir.

## Konfigurasi

Edit `detect.py` untuk mengubah:
- `VIBRATE_DISTANCE_THRESHOLD`: Jarak threshold untuk trigger vibrate (default: 1.5m)
- `CAMERA_URL_MDNS`: URL mDNS untuk ESP32-CAM (default: "http://senavision.local/cam.jpg")
- `CAMERA_URL_IP`: URL IP untuk ESP32-CAM (default: "http://192.168.1.97/cam.jpg")


# Firebase Realtime Database Integration - Ringkasan

## 📋 File yang Dibuat

### 1. Firebase Security Rules
- **File**: `database.rules.json` (di root project)
- **Deskripsi**: Rules untuk Firebase Realtime Database
- **Deploy**: `firebase deploy --only database`

### 2. ESP32 Code dengan Firebase
- **File**: `mode-detector/ESP32_CAM_FIREBASE_VIBRATION.ino`
- **Deskripsi**: Kode ESP32 yang membaca dari Firebase dan mengontrol vibration motor
- **Library Required**:
  - Firebase ESP32 Client (Mobizt)
  - ArduinoJson

### 3. Web App Firebase Integration
- **File**: `mode-detector/js/firebase-realtime.js`
- **Deskripsi**: JavaScript untuk koneksi ke Firebase Realtime Database dan monitoring realtime

### 4. ML Detection Integration
- **File**: `mode-detector/js/ml-firebase-integration.js`
- **Deskripsi**: Integrasi hasil ML detection dengan Firebase untuk mengirim direction ke ESP32

### 5. Dokumentasi
- **File**: `mode-detector/FIREBASE_SETUP.md`
- **Deskripsi**: Panduan lengkap setup Firebase

### 6. HTML Update
- **File**: `mode-detector/index.html`
- **Update**: Menambahkan script Firebase Realtime dan ML integration

### 7. Postprocessing Update
- **File**: `mode-detector/js/postprocessing.js`
- **Update**: Menambahkan integrasi Firebase di semua fungsi postprocessing (YOLOv7, YOLOv10, YOLOv11)

## 🔄 Alur Data

```
1. ESP32-CAM menangkap gambar
   ↓
2. Gambar dikirim ke Web App (via HTTP/stream)
   ↓
3. Web App menjalankan ML detection (YOLO)
   ↓
4. Hasil detection ditentukan direction (left/right/both/none)
   ↓
5. Direction dikirim ke Firebase Realtime Database (/ml_results/direction)
   ↓
6. ESP32 membaca dari Firebase dan mengaktifkan vibration motor
   ↓
7. ESP32 mengirim status ke Firebase (/esp32_status)
   ↓
8. Web App monitor status secara realtime
```

## 📊 Struktur Database Firebase

```json
{
  "ml_results": {
    "direction": "left" | "right" | "both" | "stop" | "none",
    "timestamp": 1234567890,
    "confidence": 0.95,
    "object_detected": "person"
  },
  "esp32_status": {
    "connected": true,
    "motor_active": "left" | "right" | "both" | "stop" | "none",
    "last_update": 1234567890,
    "ip_address": "192.168.1.100"
  }
}
```

## 🚀 Cara Setup

### 1. Deploy Firebase Rules

```bash
firebase deploy --only database
```

### 2. Setup ESP32

1. Install library Firebase ESP32 Client di Arduino IDE
2. Buka file `ESP32_CAM_FIREBASE_VIBRATION.ino`
3. Update credentials:
   ```cpp
   const char *ssid = "YOUR_WIFI_SSID";
   const char *password = "YOUR_WIFI_PASSWORD";
   #define FIREBASE_AUTH "YOUR_DATABASE_SECRET"
   ```
4. Upload ke ESP32-CAM

### 3. Test Sistem

1. **Test Firebase Connection**:
   - Buka Firebase Console
   - Edit `/ml_results/direction` = `"left"` atau `"right"`
   - Cek Serial Monitor ESP32, motor harus bergetar

2. **Test Web App**:
   - Buka web app
   - Jalankan Live Detection
   - Object terdeteksi → direction otomatis terkirim ke Firebase
   - ESP32 membaca dan motor bergetar sesuai direction

3. **Test Manual dari Browser Console**:
   ```javascript
   // Update direction manual
   await updateMLDirection('right', 0.95, 'person');
   
   // Check direction
   getMLDirection();
   
   // Check ESP32 status
   getESP32Status();
   ```

## 🔧 Konfigurasi Direction

Direction ditentukan berdasarkan posisi object:
- **left**: Object di sebelah kiri (< 35% dari canvas width)
- **right**: Object di sebelah kanan (> 65% dari canvas width)
- **both**: Object di tengah (35% - 65%) atau multiple objects
- **none**: Tidak ada object terdeteksi atau object terlalu jauh (> 150cm)

## 📝 Catatan Penting

1. **Firebase Authentication**: 
   - Untuk production, gunakan authentication
   - Database Secret hanya untuk development/testing

2. **Throttling**:
   - Firebase update dibatasi 200ms per update
   - ML detection berjalan setiap frame (jika Live Detection aktif)

3. **ESP32 Status Update**:
   - Status ESP32 di-update setiap 2 detik
   - ML results di-check setiap 100ms

4. **Error Handling**:
   - Jika Firebase tidak connect, sistem tetap berjalan (ML detection tetap aktif)
   - Vibration motor bisa dikontrol manual via HTTP endpoint

## 🐛 Troubleshooting

### ESP32 tidak connect ke Firebase
- Cek WiFi credentials
- Cek Firebase Host dan Auth token
- Cek Serial Monitor untuk error messages

### Motor tidak bergetar
- Test manual: ketik `1` (kanan), `2` (kiri), `0` (stop) di Serial Monitor
- Test HTTP endpoint: `http://esp32cam.local/vibrate?direction=left`
- Cek Firebase apakah direction ter-update

### Web app tidak update Firebase
- Cek Browser Console untuk errors
- Pastikan Firebase Realtime SDK sudah loaded
- Pastikan user sudah login (jika menggunakan auth)

## 📚 Referensi

- `FIREBASE_SETUP.md` - Panduan lengkap setup
- Firebase Console: https://console.firebase.google.com/u/0/project/senavision-id/database/senavision-id-default-rtdb/data/~2F


# Mode Detector Integration di Map Application

## Overview

Mode detector telah terintegrasi dengan aplikasi map sehingga dapat berjalan di background sambil navigasi aktif. Mode detector akan mendeteksi objek, menghitung jarak, dan mengirim data ke Firebase Realtime Database untuk dikonsumsi oleh ESP32.

## Fitur yang Terintegrasi

### 1. **Object Detection**
- Deteksi objek real-time menggunakan YOLO model
- Mendukung webcam dan ESP32-CAM
- Berjalan di background tanpa mengganggu navigasi

### 2. **Distance Detection**
- Menghitung jarak ke objek menggunakan triangle similarity
- Mengirim distance ke Firebase Realtime Database
- Path: `/ml_results/distance` dan `/ml_results/min_distance`

### 3. **Firebase Realtime Database Integration**
- Otomatis mengirim distance dan direction ke Firebase
- ESP32 dapat membaca distance untuk mengaktifkan motor vibration
- Struktur data:
  ```json
  {
    "ml_results": {
      "distance": 120.5,
      "min_distance": 120.5,
      "direction": "left" | "right" | "both" | "none",
      "detections": [
        {
          "distance": 120.5,
          "className": "person",
          "confidence": 0.95,
          "classId": 0
        }
      ],
      "timestamp": 1234567890,
      "confidence": 0.95,
      "object_detected": "person"
    },
    "motor": {
      "cmd": 0,
      "pwmL": 0,
      "pwmR": 0
    }
  }
  ```

## Cara Menggunakan

### 1. **Aktifkan Mode Detector**

Di browser console atau dari kode JavaScript:

```javascript
// Aktifkan mode detector
await window.ModeDetector.activate();

// Cek status
window.ModeDetector.getState();
```

### 2. **Nonaktifkan Mode Detector**

```javascript
// Nonaktifkan mode detector
window.ModeDetector.deactivate();
```

### 3. **Cek Status**

```javascript
// Cek state mode detector
const state = window.ModeDetector.getState();
console.log(state);
// Output:
// {
//   isActive: true,
//   isInitialized: true,
//   scriptsLoaded: true,
//   onnxLoaded: true,
//   modelLoaded: true,
//   cameraReady: true
// }
```

## Alur Data

```
1. Mode Detector aktif di map application
   ↓
2. Camera capture (webcam atau ESP32-CAM)
   ↓
3. YOLO model melakukan deteksi objek
   ↓
4. Distance calculation (triangle similarity)
   ↓
5. Postprocessing memanggil updateFirebaseFromDetections()
   ↓
6. Data dikirim ke Firebase Realtime Database:
   - /ml_results/distance
   - /ml_results/min_distance
   - /ml_results/direction
   - /ml_results/detections
   ↓
7. ESP32 membaca distance dari Firebase
   ↓
8. ESP32 mengaktifkan motor vibration jika distance < 150cm
   ↓
9. ESP32 update /motor di Firebase:
   - cmd: 1 (aktif) atau 0 (stop)
   - pwmL: 0-255
   - pwmR: 0-255
```

## Scripts yang Dimuat

Mode detector integration memuat script berikut secara berurutan:

1. `yoloClasses.js` - YOLO class definitions
2. `utils.js` - Utility functions
3. `distance.js` - Distance calculation
4. **`firebase-realtime.js`** - Firebase Realtime Database integration ⭐
5. **`ml-firebase-integration.js`** - ML Firebase integration (distance & direction) ⭐
6. `voiceNavigation.js` - Voice navigation
7. `vibration.js` - Vibration control
8. `preprocessing.js` - Image preprocessing
9. `postprocessing.js` - Detection postprocessing (memanggil Firebase update)
10. `model.js` - YOLO model loading
11. `camera.js` - Camera handling
12. `main.js` - Main application logic

## Firebase Configuration

Firebase Realtime Database menggunakan URL:
```
https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app
```

Konfigurasi Firebase ada di:
- `mode-detector/js/firebase-realtime.js` (untuk mode-detector standalone)
- `map/mode-detector-integration.js` (menggunakan script dari mode-detector)

## ESP32 Integration

ESP32 membaca distance dari Firebase dan mengaktifkan motor vibration:

### ESP32 Code
File: `mode-detector/ESP32_CAM_VIBRATION.ino`

- Membaca dari: `/ml_results/distance` atau `/ml_results/min_distance`
- Threshold: < 150 cm
- Update motor control: `/motor/cmd`, `/motor/pwmL`, `/motor/pwmR`

### Motor Control
- **Distance < 150 cm**: Motor aktif (HIGH), `cmd=1`, `pwmL=255`, `pwmR=255`
- **Distance >= 150 cm**: Motor mati (LOW), `cmd=0`, `pwmL=0`, `pwmR=0`

## Troubleshooting

### Mode Detector tidak aktif
1. Cek console untuk error messages
2. Pastikan semua scripts dimuat dengan benar
3. Cek apakah Firebase Realtime Database terinisialisasi:
   ```javascript
   window.firebaseRealtimeState
   ```

### Distance tidak terkirim ke Firebase
1. Pastikan Firebase Realtime Database terinisialisasi
2. Cek console untuk error Firebase
3. Pastikan `ml-firebase-integration.js` sudah dimuat
4. Cek apakah `updateFirebaseFromDetections` dipanggil dari postprocessing

### ESP32 tidak membaca distance
1. Cek koneksi ESP32 ke Firebase
2. Cek Serial Monitor ESP32 untuk error messages
3. Pastikan path Firebase benar: `/ml_results/distance` atau `/ml_results/min_distance`
4. Test manual: Update distance di Firebase Console dan cek ESP32 response

### Motor tidak aktif
1. Cek apakah ESP32 membaca distance dengan benar
2. Cek threshold: distance harus < 150 cm
3. Cek wiring motor vibration
4. Test manual: Update `/motor/cmd=1` di Firebase dan cek ESP32

## Testing

### Test Mode Detector
```javascript
// Aktifkan
await window.ModeDetector.activate();

// Tunggu beberapa detik untuk deteksi
// Cek Firebase Console: /ml_results/distance harus ter-update

// Nonaktifkan
window.ModeDetector.deactivate();
```

### Test Firebase Integration
```javascript
// Cek Firebase state
console.log(window.firebaseRealtimeState);

// Manual update distance (untuk testing)
if (typeof window.updateMLDirection === 'function') {
  await window.updateMLDirection('none', 0.95, 'person', 120.5, []);
}
```

### Test ESP32
1. Upload `ESP32_CAM_VIBRATION.ino` ke ESP32
2. Buka Serial Monitor (115200 baud)
3. Pastikan ESP32 terhubung ke WiFi dan Firebase
4. Update distance di Firebase Console (< 150 cm)
5. Motor harus aktif dan ESP32 harus update `/motor`

## Catatan Penting

1. **Voice Coordination**: Mode detector menggunakan `SpeechCoordinator` untuk koordinasi suara dengan navigasi
2. **Background Mode**: Mode detector berjalan di background tanpa UI, menggunakan hidden canvas
3. **Path Override**: `getStaticBasePath` di-override untuk menggunakan path `../mode-detector/static` saat berjalan di map
4. **Firebase Auto-Init**: Firebase Realtime Database otomatis terinisialisasi saat mode detector diaktifkan

## Referensi

- `mode-detector/ESP32_CAM_VIBRATION.ino` - ESP32 code untuk membaca distance dan kontrol motor
- `mode-detector/js/firebase-realtime.js` - Firebase Realtime Database integration
- `mode-detector/js/ml-firebase-integration.js` - ML Firebase integration
- `map/mode-detector-integration.js` - Mode detector integration untuk map application



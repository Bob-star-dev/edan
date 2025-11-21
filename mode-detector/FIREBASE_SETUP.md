# Firebase Realtime Database Setup untuk ESP32-CAM dengan Vibration Motor

## Overview

Sistem ini menggunakan Firebase Realtime Database untuk komunikasi realtime antara:
1. **ESP32-CAM** - Mengirim gambar dan membaca ML results untuk kontrol vibration motor
2. **Server/Cloud Function** - Memproses gambar dengan ML dan mengirim hasil ke Firebase
3. **Web App** - Monitor status ESP32 dan ML results secara realtime

## Alur Data

```
ESP32-CAM  ------(gambar)--->  SERVER (Firebase Storage/Function)
                                     |
                                     v
SERVER     ------(JSON)------>  Firebase Realtime Database (/ml_results)
                                     |
                                     v
ESP32      <-----(direction)---  Firebase Realtime Database (/ml_results/direction)
ESP32      ------(status)----->  Firebase Realtime Database (/esp32_status)
                                     |
                                     v
WEB APP    <----- realtime ----->  Firebase Realtime Database
```

## Struktur Database

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

## Setup Firebase

### 1. Install Firebase CLI (jika belum)

```bash
npm install -g firebase-tools
```

### 2. Login ke Firebase

```bash
firebase login
```

### 3. Deploy Security Rules

```bash
firebase deploy --only database
```

Rules akan diambil dari file `database.rules.json` di root project.

### 4. Setup Database Secret (untuk ESP32)

1. Buka Firebase Console: https://console.firebase.google.com/
2. Pilih project: **senavision-id**
3. Buka **Project Settings** > **Service Accounts**
4. Klik **Generate New Private Key** untuk mendapatkan service account key (optional)
5. Atau gunakan **Database Secrets**:
   - Buka **Realtime Database** > **Rules**
   - Klik **Get Secret** di bagian bawah
   - Copy secret token

### 5. Update ESP32 Code

Edit file `ESP32_CAM_FIREBASE_VIBRATION.ino`:

```cpp
#define FIREBASE_HOST "senavision-id-default-rtdb.firebaseio.com"
#define FIREBASE_AUTH "YOUR_DATABASE_SECRET_HERE"  // Ganti dengan Database Secret
```

## Install Library Arduino

### 1. Install Firebase Arduino Library

1. Buka **Arduino IDE**
2. Buka **Tools** > **Manage Libraries**
3. Search: **Firebase ESP32 Client**
4. Install library dari **Mobizt**

### 2. Install Library Tambahan

- **ArduinoJson** (untuk JSON parsing)
- **WiFi** (sudah termasuk di ESP32)

### 3. Install Board Support

Jika belum:
1. File > Preferences
2. Tambahkan URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Tools > Board > Boards Manager
4. Install **ESP32** board support

## Upload Code ke ESP32

1. Buka file `ESP32_CAM_FIREBASE_VIBRATION.ino` di Arduino IDE
2. Pilih board: **Tools** > **Board** > **ESP32 Arduino** > **AI Thinker ESP32-CAM**
3. Pastikan WiFi credentials sudah benar:
   ```cpp
   const char *ssid = "YOUR_WIFI_SSID";
   const char *password = "YOUR_WIFI_PASSWORD";
   ```
4. Pastikan Firebase credentials sudah benar
5. Upload ke ESP32-CAM

## Setup Web App

### 1. Tambahkan Script ke HTML

Tambahkan di `mode-detector/index.html` (sebelum closing `</body>`):

```html
<script src="js/firebase-realtime.js"></script>
```

### 2. Integrasikan dengan ML Detection

Di file `mode-detector/js/main.js` atau file ML processing, tambahkan:

```javascript
// Setelah deteksi object dan tentukan direction
async function processMLResults(detections) {
  // Tentukan direction berdasarkan posisi object
  let direction = 'none';
  
  if (detections.length > 0) {
    // Contoh: object di kiri = 'left', di kanan = 'right'
    const avgX = detections.reduce((sum, d) => sum + d.x, 0) / detections.length;
    const canvasWidth = 320; // Sesuaikan dengan ukuran canvas
    
    if (avgX < canvasWidth * 0.4) {
      direction = 'left';
    } else if (avgX > canvasWidth * 0.6) {
      direction = 'right';
    } else {
      direction = 'both';
    }
  }
  
  // Update ke Firebase
  if (typeof updateMLDirection === 'function') {
    await updateMLDirection(direction, confidence, objectDetected);
  }
}
```

## Testing

### 1. Test Firebase Connection

Buka Serial Monitor ESP32 (115200 baud), cek:
- ✅ WiFi connected
- ✅ Firebase initialized
- ✅ HTTP server started

### 2. Test ML Results

1. Buka Firebase Console
2. Buka Realtime Database
3. Edit `/ml_results/direction` = `"left"` atau `"right"`
4. Cek ESP32 Serial Monitor, harus muncul:
   - `📡 Received ML direction: left`
   - `⬅️  Getar motor kiri`

### 3. Test Web App

1. Buka web app
2. Buka Browser Console (F12)
3. Cek log:
   - `[Firebase Realtime] ✅ Initialized successfully`
   - `[Firebase Realtime] ✅ ML Results listener setup`
   - `[Firebase Realtime] ✅ ESP32 Status listener setup`

### 4. Manual Test dari Web App

Di Browser Console:
```javascript
// Update ML direction
await updateMLDirection('right', 0.95, 'person');

// Check current direction
getMLDirection();

// Check ESP32 status
getESP32Status();
```

## Security Rules

Rules yang digunakan (`database.rules.json`):

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "ml_results": {
      ".read": true,
      ".write": "auth != null"
    },
    "esp32_status": {
      ".read": true,
      ".write": true
    }
  }
}
```

**Catatan:** Rules ini memungkinkan:
- **ml_results**: Read untuk semua, Write hanya untuk authenticated users
- **esp32_status**: Read/Write untuk semua (karena ESP32 tidak bisa authenticate)

Untuk production, gunakan authentication atau private key untuk ESP32.

## Troubleshooting

### ESP32 tidak connect ke Firebase

1. Cek WiFi credentials
2. Cek Firebase Host dan Auth token
3. Cek Serial Monitor untuk error messages
4. Pastikan Firebase Realtime Database sudah diaktifkan

### ML results tidak ter-update

1. Cek apakah fungsi `updateMLDirection()` dipanggil
2. Cek Browser Console untuk error
3. Cek Firebase Console apakah data ter-update
4. Pastikan user sudah login (jika menggunakan auth)

### Motor tidak bergetar

1. Cek koneksi wiring motor
2. Test manual dari Serial Monitor: ketik `1` (kanan), `2` (kiri), `0` (stop)
3. Test dari HTTP endpoint: `http://esp32cam.local/vibrate?direction=left`
4. Cek Firebase apakah direction ter-update dengan benar

### Web app tidak realtime update

1. Cek Browser Console untuk Firebase errors
2. Pastikan Firebase Realtime Database SDK sudah loaded
3. Cek apakah listeners sudah setup
4. Test manual update dari Firebase Console

## Referensi

- [Firebase Realtime Database Docs](https://firebase.google.com/docs/database)
- [Firebase ESP32 Library](https://github.com/mobizt/Firebase-ESP-32)
- [ArduinoJson Documentation](https://arduinojson.org/)


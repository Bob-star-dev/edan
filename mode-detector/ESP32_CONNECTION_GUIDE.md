# Panduan Konfigurasi ESP32-CAM: IP Statis vs mDNS

## 📋 Ringkasan Konsep

Sistem ini mengarahkan semua akses ESP32-CAM dari `esp32cam.local` (mDNS) ke alamat IP statis `http://192.168.1.12/stream` untuk Machine Learning camera feed.

---

## 🎯 Tujuan

1. **Mengganti mDNS dengan IP Statis**: Prioritas utama menggunakan IP `192.168.1.12`
2. **Endpoint Stream**: Semua request ke `/stream` menggunakan IP statis
3. **Fallback Mechanism**: Jika IP statis gagal, fallback ke mDNS
4. **Machine Learning Integration**: ML client langsung menggunakan IP statis

---

## 🔄 Diagram Alur Koneksi

```
┌─────────────────────────────────────────────────────────────┐
│                    Machine Learning Client                  │
│                    (Browser / JavaScript)                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Request: /stream
                        ▼
        ┌───────────────────────────────┐
        │   Connection Strategy         │
        │   (Priority-based)             │
        └───────────────┬───────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌───────────────┐              ┌───────────────┐
│  PRIMARY      │              │  FALLBACK     │
│  IP Static    │              │  mDNS         │
│  192.168.1.12 │              │  esp32cam.local│
└───────┬───────┘              └───────┬───────┘
        │                               │
        │ Success?                      │
        │                               │
        ├─────────── YES ────────────────┤
        │                               │
        ▼                               ▼
┌───────────────────────────────────────────┐
│      ESP32-CAM Stream Endpoint            │
│      http://192.168.1.12/stream           │
│      (Port 80 - MJPEG Stream)            │
└───────────────────────────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │   MJPEG Video Stream   │
            │   (Continuous Frames)  │
            └───────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │   ML Processing       │
            │   (Object Detection)  │
            └───────────────────────┘
```

---

## 🔧 Konfigurasi JavaScript

### 1. Konfigurasi URL Priority

```javascript
// Priority 1: IP Statis (Primary)
const ESP32_STATIC_IP = '192.168.1.12';
const ESP32_STATIC_BASE_URL = `http://${ESP32_STATIC_IP}`;

// Priority 2: mDNS (Fallback)
const ESP32_MDNS_HOST = 'esp32cam.local';
const ESP32_MDNS_BASE_URL = `http://${ESP32_MDNS_HOST}`;

// Endpoint Configuration
const ESP32_STREAM_ENDPOINT = '/stream';  // Port 80
const ESP32_CAPTURE_ENDPOINT = '/capture'; // Port 80
```

### 2. Connection Strategy Function

```javascript
/**
 * Get ESP32 Base URL dengan Priority System
 * Priority: IP Statis > mDNS
 */
function getESP32BaseURL() {
  // Always prefer static IP first
  return ESP32_STATIC_BASE_URL;
}

/**
 * Get Stream URL dengan Fallback
 */
function getESP32StreamURL() {
  const baseURL = getESP32BaseURL();
  return `${baseURL}${ESP32_STREAM_ENDPOINT}`;
}

/**
 * Get Capture URL dengan Fallback
 */
function getESP32CaptureURL() {
  const baseURL = getESP32BaseURL();
  return `${baseURL}${ESP32_CAPTURE_ENDPOINT}`;
}
```

### 3. Connection dengan Fallback Mechanism

```javascript
/**
 * Connect to ESP32 Stream dengan Auto-Fallback
 */
async function connectESP32Stream() {
  const img = document.getElementById('esp32-img');
  if (!img) return;

  // Primary: Try Static IP
  const primaryURL = getESP32StreamURL();
  console.log(`[ESP32] 🔄 Attempting connection to: ${primaryURL}`);
  
  let connected = false;
  
  // Try primary URL (Static IP)
  try {
    connected = await testConnection(primaryURL);
    if (connected) {
      console.log(`[ESP32] ✅ Connected via Static IP: ${primaryURL}`);
      img.src = primaryURL;
      return;
    }
  } catch (error) {
    console.warn(`[ESP32] ⚠️ Static IP failed: ${error.message}`);
  }
  
  // Fallback: Try mDNS
  if (!connected) {
    const fallbackURL = `${ESP32_MDNS_BASE_URL}${ESP32_STREAM_ENDPOINT}`;
    console.log(`[ESP32] 🔄 Fallback to mDNS: ${fallbackURL}`);
    
    try {
      connected = await testConnection(fallbackURL);
      if (connected) {
        console.log(`[ESP32] ✅ Connected via mDNS: ${fallbackURL}`);
        img.src = fallbackURL;
        return;
      }
    } catch (error) {
      console.error(`[ESP32] ❌ mDNS also failed: ${error.message}`);
    }
  }
  
  // Both failed
  throw new Error('ESP32 connection failed: Both Static IP and mDNS unavailable');
}

/**
 * Test Connection dengan Timeout
 */
function testConnection(url) {
  return new Promise((resolve, reject) => {
    const testImg = new Image();
    const timeout = setTimeout(() => {
      testImg.onload = null;
      testImg.onerror = null;
      resolve(false);
    }, 5000); // 5 second timeout
    
    testImg.onload = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    
    testImg.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    
    testImg.crossOrigin = 'anonymous';
    testImg.src = url + '?t=' + Date.now();
  });
}
```

---

## 📡 API Endpoint Specification

### ESP32-CAM Endpoints (Port 80)

| Endpoint | Method | Description | Response |
|----------|--------|-------------|----------|
| `/stream` | GET | MJPEG video stream | `multipart/x-mixed-replace` |
| `/capture` | GET | Single JPEG frame | `image/jpeg` |
| `/status` | GET | Device status | `application/json` |

### URL Format

**Primary (Static IP):**
- Stream: `http://192.168.1.12/stream`
- Capture: `http://192.168.1.12/capture`
- Status: `http://192.168.1.12/status`

**Fallback (mDNS):**
- Stream: `http://esp32cam.local/stream`
- Capture: `http://esp32cam.local/capture`
- Status: `http://esp32cam.local/status`

---

## 🔄 Fallback Strategy Flow

```
START
  │
  ▼
┌─────────────────────┐
│ Try Static IP       │
│ 192.168.1.12/stream │
└──────────┬──────────┘
           │
           ├─── SUCCESS ────► Use Static IP
           │
           └─── FAIL ────►
                          │
                          ▼
                ┌─────────────────────┐
                │ Try mDNS            │
                │ esp32cam.local/stream│
                └──────────┬──────────┘
                           │
                           ├─── SUCCESS ────► Use mDNS
                           │
                           └─── FAIL ────► Show Error
```

---

## 🛠️ Implementasi di camera.js

### Step 1: Update Configuration

```javascript
// ESP32 Configuration - IP Static Priority
const ESP32_STATIC_IP = '192.168.1.12';
const ESP32_STATIC_BASE_URL = `http://${ESP32_STATIC_IP}`;
const ESP32_MDNS_HOST = 'esp32cam.local'; // Fallback only
const ESP32_MDNS_BASE_URL = `http://${ESP32_MDNS_HOST}`;

// Endpoints
const ESP32_STREAM_URL = `${ESP32_STATIC_BASE_URL}/stream`;
const ESP32_CAPTURE_URL = `${ESP32_STATIC_BASE_URL}/capture`;
```

### Step 2: Update getESP32BaseURL()

```javascript
function getESP32BaseURL() {
  // Always return static IP (no fallback in base URL)
  // Fallback handled in connection logic
  return ESP32_STATIC_BASE_URL;
}
```

### Step 3: Update Stream Connection

```javascript
function readMJPEGStream() {
  const img = document.getElementById('esp32-img');
  if (!img) return;
  
  img.crossOrigin = 'anonymous';
  
  // Primary: Static IP
  const primaryURL = `${ESP32_STATIC_BASE_URL}/stream?t=${Date.now()}`;
  console.log(`[ESP32] 📡 Connecting to: ${primaryURL}`);
  
  img.onerror = () => {
    // Fallback to mDNS if static IP fails
    const fallbackURL = `${ESP32_MDNS_BASE_URL}/stream?t=${Date.now()}`;
    console.warn(`[ESP32] ⚠️ Static IP failed, trying mDNS: ${fallbackURL}`);
    img.src = fallbackURL;
  };
  
  img.src = primaryURL;
}
```

---

## 🎯 Machine Learning Integration

### ML Client Configuration

```javascript
// ML Camera Feed Configuration
const ML_CAMERA_CONFIG = {
  source: 'esp32',
  url: 'http://192.168.1.12/stream', // Direct IP, no mDNS
  type: 'mjpeg',
  frameRate: 30,
  resolution: '640x480'
};

// ML Processing Function
async function processMLFrame() {
  const img = document.getElementById('esp32-img');
  if (!img || !img.complete) return;
  
  // Get frame from ESP32 stream
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  // Process with ML model
  const detections = await runMLInference(canvas);
  
  return detections;
}
```

---

## ✅ Checklist Implementasi

- [x] Konfigurasi IP statis sebagai primary
- [x] Endpoint `/stream` menggunakan IP statis
- [x] Fallback mechanism ke mDNS
- [x] ML client menggunakan IP statis langsung
- [x] Error handling untuk connection failure
- [x] Logging untuk debugging

---

## 🔍 Troubleshooting

### Problem: Connection Failed

**Solution:**
1. Verify ESP32 IP: Check Serial Monitor atau router
2. Test in browser: `http://192.168.1.12/stream`
3. Check firewall/network settings
4. Verify ESP32 web server running

### Problem: mDNS Fallback Not Working

**Solution:**
1. Ensure mDNS service running on ESP32
2. Check network supports mDNS (Bonjour/Avahi)
3. Use IP statis as primary (recommended)

---

## 📝 Catatan Penting

1. **IP Statis adalah Primary**: Semua koneksi default ke `192.168.1.12`
2. **mDNS adalah Fallback**: Hanya digunakan jika IP statis gagal
3. **Port 80**: Semua endpoint menggunakan port 80 (tidak ada port 81)
4. **CORS**: Pastikan ESP32 web server mengirim CORS headers
5. **Machine Learning**: Langsung menggunakan IP statis tanpa mDNS

---

## 🚀 Quick Start

1. Set IP statis di ESP32 (via router atau static IP config)
2. Update `ESP32_STATIC_IP` di `camera.js`
3. Test connection: `http://192.168.1.12/stream`
4. ML akan otomatis menggunakan IP statis


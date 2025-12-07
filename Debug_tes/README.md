# ESP32-CAM YOLO Background Detector (JavaScript Native)

Versi JavaScript native dari sistem deteksi objek ESP32-CAM dengan YOLO yang berjalan di background.

## Fitur

- ✅ Deteksi objek menggunakan COCO-SSD (TensorFlow.js)
- ✅ Perhitungan jarak objek dari kamera
- ✅ Sinyal vibrate otomatis saat objek terlalu dekat (< 1.5m)
- ✅ Berjalan di background tanpa UI yang mencolok
- ✅ Support mDNS dan IP address untuk ESP32-CAM
- ✅ Error handling dan retry mechanism
- ✅ Debouncing untuk mencegah spam request vibrate

## Struktur File

```
Debug_tes/
├── index.html      # HTML sederhana dengan background putih
├── config.js       # Konfigurasi (IP, threshold, dll)
├── detector.js     # Main detector logic
└── README.md       # Dokumentasi ini
```

## Konfigurasi

Edit `config.js` untuk mengubah konfigurasi:

```javascript
const CONFIG = {
    CAMERA: {
        MDNS_URL: "http://senavision.local/cam.jpg",
        IP_URL: "http://192.168.1.97/cam.jpg",  // Ganti dengan IP ESP32-CAM Anda
        FRAME_INTERVAL: 100,  // Interval antar frame (ms) - 10 FPS
    },
    
    VIBRATOR: {
        DISTANCE_THRESHOLD: 1.5,  // Jarak dalam meter untuk trigger vibrate
        DEBOUNCE_TIME: 500,  // Waktu debounce (ms)
    },
    
    // ... konfigurasi lainnya
};
```

## Cara Menggunakan

1. **Buka `index.html` di browser**
   - Bisa menggunakan local file atau web server
   - Disarankan menggunakan web server (misalnya `python -m http.server`)

2. **Pastikan ESP32-CAM sudah terhubung**
   - ESP32-CAM harus terhubung ke WiFi yang sama
   - IP address harus sesuai dengan konfigurasi di `config.js`

3. **Sistem akan otomatis:**
   - Load model COCO-SSD
   - Mencari kamera ESP32-CAM
   - Mulai deteksi objek di background
   - Mengirim sinyal vibrate jika objek terlalu dekat

## Alur Kerja

```
1. Browser (JavaScript)
   ↓ Fetch image dari ESP32-CAM
2. COCO-SSD Detection
   ↓ Deteksi objek dan hitung jarak
3. Jika jarak < 1.5m
   ↓ Kirim HTTP request ke ESP32-CAM
4. ESP32-CAM
   ↓ Teruskan ke ESP32-C3 Vibrator
5. ESP32-C3
   ↓ Aktifkan vibrator motor
```

## Status Indicator

Di pojok kiri atas ada status indicator (hampir tidak terlihat, opacity 0.3):
- **Status**: Status umum sistem
- **Camera**: Status koneksi ke ESP32-CAM
- **Model**: Status model COCO-SSD
- **FPS**: Frame per second
- **Objects**: Jumlah objek yang terdeteksi

Hover untuk melihat lebih jelas.

## Debug Mode

Untuk melihat log di console, set `DEBUG: true` di `config.js`:

```javascript
const CONFIG = {
    DEBUG: true,  // Enable console logging
    // ...
};
```

## Troubleshooting

### Camera tidak terhubung
- Pastikan ESP32-CAM menyala dan terhubung ke WiFi
- Pastikan IP address di `config.js` sesuai
- Cek apakah ESP32-CAM bisa diakses di browser: `http://192.168.1.97/cam.jpg`

### Model tidak load
- Pastikan koneksi internet aktif (untuk download model dari CDN)
- Model akan di-cache oleh browser setelah pertama kali load

### Vibrate tidak bekerja
- Pastikan ESP32-CAM bisa mengakses ESP32-C3 (IP: 192.168.1.27)
- Cek Serial Monitor ESP32-CAM untuk melihat log
- Pastikan ESP32-C3 sudah terhubung dan running

## Perbedaan dengan Versi Python

| Fitur | Python | JavaScript |
|-------|--------|------------|
| Model | YOLOv3 (OpenCV) | COCO-SSD (TensorFlow.js) |
| Platform | Desktop | Web Browser |
| UI | OpenCV Window | Background (HTML) |
| Performance | Lebih cepat | Sedikit lebih lambat |
| Deployment | Perlu Python env | Hanya browser |

## Catatan

- COCO-SSD menggunakan model yang berbeda dari YOLOv3, tapi hasil deteksi serupa
- Perhitungan jarak menggunakan logika yang sama dengan versi Python
- Sistem berjalan di background, tidak mengganggu penggunaan browser


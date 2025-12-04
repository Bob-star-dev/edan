# YOLO Object Detection - Mobile Version (JavaScript)

Versi mobile yang dioptimalkan untuk perangkat mobile, berjalan langsung di browser tanpa backend server.

## ✅ Keuntungan Versi Mobile

- ✅ **Tidak perlu backend server** - Berjalan langsung di browser
- ✅ **Bisa deploy ke Firebase Hosting** - Semua file static
- ✅ **Optimized untuk mobile** - Menggunakan MobileNet v2 (ringan & cepat)
- ✅ **WebGL acceleration** - Menggunakan GPU mobile jika tersedia
- ✅ **Real-time detection** - Deteksi setiap 300ms (~3 FPS)
- ✅ **Support vibrator** - Tetap support left/right vibrator
- ✅ **Distance estimation** - Tetap support perhitungan jarak

## Teknologi

- **TensorFlow.js** - Machine learning di browser
- **COCO-SSD** - Object detection model (80 classes)
- **MobileNet v2** - Backbone network (ringan untuk mobile)

## Cara Kerja

1. **Model Loading**: TensorFlow.js load COCO-SSD model saat init
2. **Camera Access**: Ambil frame dari ESP32-CAM via HTTP
3. **Detection**: Model detect objek di frame
4. **Distance Calculation**: Estimasi jarak berdasarkan ukuran objek
5. **Vibrator Control**: Kirim sinyal ke ESP32-CAM endpoint jika objek < 1.5m

## Setup

Tidak perlu setup khusus! File sudah terintegrasi di `map.html`.

Pastikan:
- ESP32-CAM terhubung ke WiFi
- IP ESP32-CAM sesuai di `yolo-detector-integration-mobile.js`

## Konfigurasi

Edit `map/yolo-detector-integration-mobile.js` untuk mengubah:

```javascript
const CAMERA_URL_MDNS = "http://senavision.local/cam.jpg";
const CAMERA_URL_IP = "http://192.168.1.97/cam.jpg";
const VIBRATE_DISTANCE_THRESHOLD = 1.5; // meter
const DETECTION_INTERVAL = 300; // ms (~3 FPS)
```

## Performance

- **Model Size**: ~5-10 MB (load sekali saat init)
- **Detection Speed**: ~300ms per frame (~3 FPS)
- **Memory Usage**: ~50-100 MB (tergantung device)
- **Battery Impact**: Sedang (menggunakan GPU jika tersedia)

## Browser Support

- ✅ Chrome/Edge (Android/iOS) - Full support
- ✅ Safari (iOS) - Full support
- ✅ Firefox Mobile - Full support
- ⚠️ Browser lama - Mungkin tidak support WebGL

## Troubleshooting

### Model tidak load
- Check koneksi internet (model di-load dari CDN)
- Check browser console untuk error
- Pastikan browser support WebGL

### Detection lambat
- Normal untuk device low-end
- Bisa kurangi `DETECTION_INTERVAL` untuk lebih cepat (tapi lebih boros battery)
- Pastikan WebGL enabled (check di browser settings)

### Camera tidak terhubung
- Check ESP32-CAM WiFi connection
- Verify IP address
- Test manual: buka `http://senavision.local/cam.jpg` di browser

### Vibrator tidak bergetar
- Check koneksi ESP32-C3 ke WiFi
- Verify IP ESP32-C3 di `ESP32CAM_Capture.ino`
- Check browser console untuk error

## Perbandingan dengan Versi Python Backend

| Fitur | Python Backend | Mobile JS |
|-------|----------------|------------|
| Setup | Perlu server | Langsung |
| Deploy | VPS/Cloud | Firebase |
| Akurasi | YOLOv3 (tinggi) | COCO-SSD (cukup) |
| Speed | Server-side | Client-side |
| Mobile | Baik | Optimal |

## Catatan

- Model di-load dari CDN (jsdelivr) - perlu internet saat pertama kali
- Detection berjalan di main thread (tapi tidak blocking karena async)
- WebGL acceleration otomatis jika tersedia
- Model size ~5-10 MB (cached oleh browser setelah pertama kali)


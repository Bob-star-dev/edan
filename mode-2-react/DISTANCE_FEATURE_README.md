# 📏 Distance Estimation Feature

## ✅ Integration Complete!

Fitur **Distance Estimation** menggunakan **Triangle Similarity Algorithm** telah berhasil diintegrasikan ke dalam aplikasi Real-Time Object Detection.

## 🎯 Fitur

- **Triangle Similarity Algorithm** - Metode yang sama seperti di [reference repository](https://github.com/Asadullah-Dal17/Distance_measurement_using_single_camera)
- **Automatic Distance Calculation** - Jarak otomatis untuk semua objek yang terdeteksi
- **Smart Unit Display** - Menampilkan jarak dalam cm/m sesuai jarak
- **Multi-Object Support** - Dukungan untuk semua 80 class YOLO
- **Resolution Adaptive** - Otomatis menyesuaikan dengan resolusi video

## 📍 File yang Ditambahkan

- `utils/triangle_similarity_distance.ts` - Core calculation functions

## 🎨 Format Display

Jarak ditampilkan di **2 baris** pada setiap bounding box:
```
Person 93.2%      ← Class + Confidence
45cm              ← Distance
```

### Format Jarak
- **< 50cm**: `45cm` (integer)
- **50-100cm**: `75.5cm` (1 desimal)
- **1-10m**: `2.43m` (2 desimal)  
- **> 10m**: `15.2m` (1 desimal)

## 🔧 Kalibrasi (Opsi)

Untuk akurasi lebih baik, Anda dapat melakukan kalibrasi:

1. Letakkan objek dengan ukuran diketahui pada jarak tertentu
2. Buka console browser (F12)
3. Jalankan kode berikut:

```javascript
// Contoh: Objek berukuran 20cm, pada jarak 100cm
import { calculateFocalLength } from './utils/triangle_similarity_distance';

const focalLength = calculateFocalLength({
  knownDistance: 100,    // cm
  realObjectWidth: 20,   // cm
  pixelWidth: 150        // pixels dari captured image
});

console.log('Focal Length:', focalLength);
```

4. Update nilai di `utils/triangle_similarity_distance.ts`:
```typescript
export const DEFAULT_FOCAL_LENGTH = [nilai yang didapat]; // Replace with calibrated value
```

## 📊 Object Size Database

File sudah dilengkapi dengan database ukuran rata-rata untuk:
- **People**: 14.3cm (face width)
- **Vehicles**: car (180cm), bus (250cm), dll
- **Animals**: cat (8cm), dog (15cm), dll
- **Furniture**: chair (50cm), sofa (200cm), dll

Database ada di `utils/triangle_similarity_distance.ts` - Anda bisa update sesuai kebutuhan!

## ⚡ Cara Penggunaan

1. **Reload browser** (F5)
2. **Aktifkan Live Detection** atau **Capture Photo**
3. Jarak otomatis akan ditampilkan pada setiap objek terdeteksi

## 🎓 Referensi

- Algorithm: [Triangle Similarity](https://github.com/Asadullah-Dal17/Distance_measurement_using_single_camera)
- Formula: `distance = (real_width × focal_length) / pixel_width`

## 💡 Tips

- **Objekt dekat**: Gunakan objek ukuran kecil untuk akurasi lebih baik
- **Objek jauh**: Gunakan objek yang lebih besar sebagai referensi
- **Kalibrasi berkala**: Re-calibrate jika ganti kamera atau resolusi
- **Testing**: Test dengan beberapa jarak berbeda untuk verifikasi

## 🔄 Menghapus Fitur Jarak

Jika ingin menghapus fitur ini:
```bash
# Hapus file distance
rm utils/triangle_similarity_distance.ts

# Hapus imports di Yolo.tsx
# Remove distance calculation code di postprocess functions
```

---

**Selamat! Aplikasi Anda sekarang memiliki fitur Distance Estimation yang akurat! 🎉**


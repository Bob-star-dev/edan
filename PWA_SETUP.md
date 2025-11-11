# PWA Setup untuk SENAVISION

Proyek ini telah dikonfigurasi sebagai Progressive Web App (PWA) yang dapat diinstall di perangkat mobile dan desktop.

## Fitur PWA

✅ **Installable** - Dapat diinstall sebagai aplikasi native
✅ **Offline Support** - Bekerja tanpa koneksi internet (dengan cache)
✅ **Fast Loading** - Assets di-cache untuk loading yang lebih cepat
✅ **App-like Experience** - Tampil seperti aplikasi native

## File yang Dibuat

1. **manifest.json** - Konfigurasi PWA (nama, icon, theme color, dll)
2. **service-worker.js** - Service worker untuk caching dan offline support

## Cara Menggunakan

### 1. Install sebagai PWA

**Chrome/Edge (Desktop):**
- Buka aplikasi di browser
- Klik icon "Install" di address bar
- Atau: Menu → Install SENAVISION

**Chrome/Edge (Mobile):**
- Buka aplikasi di browser
- Menu (⋮) → "Add to Home Screen" atau "Install App"

**Safari (iOS):**
- Buka aplikasi di Safari
- Share button → "Add to Home Screen"

**Firefox:**
- Menu → "Install Site as App"

### 2. Verifikasi PWA

Setelah install, aplikasi akan:
- Muncul di home screen dengan icon
- Buka dalam window terpisah (tanpa browser UI)
- Dapat diakses offline (untuk halaman yang sudah di-cache)

## Testing PWA

### Chrome DevTools

1. Buka Chrome DevTools (F12)
2. Tab "Application"
3. Cek:
   - **Manifest** - Pastikan manifest.json terdeteksi
   - **Service Workers** - Pastikan service worker terdaftar dan aktif
   - **Cache Storage** - Lihat cached assets

### Lighthouse PWA Audit

1. Buka Chrome DevTools → Tab "Lighthouse"
2. Pilih "Progressive Web App"
3. Klik "Generate report"
4. Target: Score 90+ untuk PWA

## Troubleshooting

### Service Worker tidak terdaftar
- Pastikan aplikasi diakses via HTTPS atau localhost
- Service worker tidak bekerja di HTTP (kecuali localhost)
- Cek console untuk error messages

### Cache tidak update
- Service worker menggunakan versioning (CACHE_NAME)
- Update version di service-worker.js untuk force update
- Atau: Clear cache di DevTools → Application → Clear Storage

### Manifest tidak terdeteksi
- Pastikan path `/manifest.json` benar
- Cek Network tab apakah manifest.json ter-load
- Pastikan MIME type adalah `application/manifest+json`

## Update Service Worker

Untuk update service worker:
1. Ubah `CACHE_NAME` di service-worker.js (contoh: `senavision-v1.0.1`)
2. Deploy file baru
3. User akan mendapat update otomatis saat reload

## Catatan Penting

⚠️ **HTTPS Required**: PWA memerlukan HTTPS untuk production (localhost OK untuk development)

⚠️ **Icon Size**: Pastikan icon minimal 192x192 dan 512x512 untuk best experience

⚠️ **Service Worker Scope**: Service worker harus di root (`/`) untuk mengcover seluruh aplikasi

## Fitur yang Tersedia

- ✅ Install prompt
- ✅ Offline caching
- ✅ Fast loading
- ✅ App shortcuts
- ✅ Theme color
- ✅ Splash screen (via manifest)
- ✅ Background sync (prepared for future use)
- ✅ Push notifications (prepared for future use)


# Panduan Deployment ke Firebase

## Setup Firebase (Pertama Kali)

### 1. Install Firebase CLI (Jika Belum)
```bash
npm install -g firebase-tools
```

### 2. Login ke Firebase
```bash
firebase login
```
Buka URL yang muncul di browser dan login dengan akun Google Anda.

### 3. Daftarkan Project Firebase
- Buka: https://console.firebase.google.com
- Klik "Add project" atau "Create a project"
- Isi nama project (contoh: "sanavision")
- Aktifkan Google Analytics (opsional)
- Klik "Create project"

### 4. Setup Hosting di Firebase Console
- Di Firebase Console, pilih project Anda
- Klik "Hosting" di sidebar kiri
- Klik "Get started"
- Ikuti petunjuk (akan muncul di terminal)

### 5. Inisialisasi di Terminal
```bash
firebase init hosting
```

Pilih opsi-opsi berikut:
- **Use an existing project** (pilih project yang sudah dibuat)
- **What do you want to use as your public directory?** → ketik: `.` (root directory)
- **Configure as a single-page app?** → ketik: `Yes`
- **Set up automatic builds and deploys with GitHub?** → ketik: `No`

### 6. Deploy
```bash
firebase deploy
```

## File Konfigurasi

File `firebase.json` sudah dibuat dengan konfigurasi:
- Public directory: `.` (root directory)
- SPA mode: enabled
- Routes configuration:
  - `/map/**` redirects to `/map.html`
  - All other routes redirect to `/index.html`
- Ignores folders: `speak/`, `voice/`, `tracking/`

## URL Setelah Deploy

Setelah `firebase deploy` selesai, Anda akan mendapat URL seperti:
```
https://your-project-id.web.app
https://your-project-id.firebaseapp.com
```

## Deploy Ulang (Jika Ada Perubahan)

Setelah file diubah, cukup jalankan:
```bash
firebase deploy
```

## Alias Project (Opsional)

Jika punya multiple project:
```bash
firebase use --add          # Add alias
firebase use alias-name     # Switch project
firebase deploy             # Deploy to current project
```

## Struktur File yang Dideploy

```
edan/
├── index.html           ← Landing page homepage
├── firebase.json        ← Konfigurasi hosting
├── DEPLOY.md           ← Dokumen ini
├── image/
│   ├── enuma.png       ← Logo partner ENUMA
│   └── mersiflab.png   ← Logo partner Mersif Lab
└── map/
    ├── map.html        ← Aplikasi navigasi
    ├── index.js        ← Logic aplikasi (1058 lines)
    └── map.css         ← Styling aplikasi
```

## Troubleshooting

### Error: No currently active project
```bash
firebase use --add
firebase use project-id
```

### Error: Authentication required
```bash
firebase login
```

### Error: Permission denied
- Pastikan akun Anda adalah owner/editor di Firebase Console
- Cek di: Firebase Console > Project Settings > Users and permissions

### Error: File tidak ditemukan
- Pastikan file `firebase.json` ada di root directory
- Pastikan path ke file sudah benar
- Cek di `firebase.json` apakah `public` directory sudah benar

## File yang Dideploy

Dari root directory:
- `index.html` - Landing page perusahaan SANAVISION dengan footer lengkap
- `map/map.html` - Aplikasi navigasi real-time
- `map/index.js` - Logic aplikasi (1058 lines)
- `map/map.css` - Styling aplikasi
- `image/enuma.png` - Logo partner ENUMA Technology
- `image/mersiflab.png` - Logo partner Mersif Lab
- `firebase.json` - Konfigurasi Firebase hosting
- `DEPLOY.md` - Panduan deployment ini

**Yang di-ignore:**
- `speak/` folder (folder terpisah)
- `voice/` folder (folder terpisah)
- `tracking/` folder (folder terpisah)

## Environment Variables (Opsional)

Jika butuh environment variables, buat file `.firebaserc`:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

## Cek Status Deploy

Setelah deployment selesai, Anda bisa mengecek status di:
1. Terminal - akan menampilkan URL deployment
2. Firebase Console > Hosting - melihat log dan statistik
3. Browser - buka URL yang diberikan

## Custom Domain (Opsional)

Untuk menggunakan custom domain:
1. Firebase Console > Hosting > Add custom domain
2. Ikuti instruksi untuk verifikasi domain
3. Update DNS records di provider domain Anda
4. Setelah verifikasi, custom domain akan aktif

## Rollback Deployment

Jika ada masalah dengan deployment terbaru:
```bash
firebase hosting:clone site-id:live-backup site-id:live
```

Atau dari Firebase Console:
1. Hosting > Releases > History
2. Klik release yang ingin di-rollback
3. Klik "Rollback"

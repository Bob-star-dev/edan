# Panduan Deployment ke Firebase

## Setup Firebase (Pertama Kali)

### 1. Login ke Firebase
```bash
firebase login
```
Buka URL yang muncul di browser dan login dengan akun Google Anda.

### 2. Daftarkan Project Firebase
- Buka: https://console.firebase.google.com
- Klik "Add project" atau "Create a project"
- Isi nama project (contoh: "sanavision")
- Aktifkan Google Analytics (opsional)
- Klik "Create project"

### 3. Setup Hosting di Firebase Console
- Di Firebase Console, pilih project Anda
- Klik "Hosting" di sidebar kiri
- Klik "Get started"
- Ikuti petunjuk (akan muncul di terminal)

### 4. Inisialisasi di Terminal
```bash
firebase init hosting
```

Pilih opsi-opsi berikut:
- **Use an existing project** (pilih project yang sudah dibuat)
- **What do you want to use as your public directory?** → ketik: `map`
- **Configure as a single-page app?** → ketik: `Yes`
- **Set up automatic builds and deploys with GitHub?** → ketik: `No`

### 5. Deploy
```bash
firebase deploy
```

## File Konfigurasi

File `firebase.json` sudah dibuat dengan konfigurasi:
- Public directory: `map`
- SPA mode: enabled
- All routes redirect to index.html

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

## File yang Dideploy

Dari folder `map/`:
- index.html (landing page dengan animasi)
- map.html (aplikasi map)
- index.js (logic aplikasi)
- map.css (styling)
- Semua file lain di folder map

## Environment Variables (Opsional)

Jika butuh environment variables, buat file `.firebaserc`:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

# Alur Navigasi SenaVision - Simple

## Overview
Aplikasi pemetaan dengan navigasi suara untuk Indonesia. Mendukung GPS real-time, route management, dan voice commands.

---

## Alur Sederhana

### 1️⃣ Inisialisasi Aplikasi
```
1. Load HTML → map.html
2. Load CSS → map.css  
3. Load JavaScript → firebase-app.js → index.js
4. Init Leaflet Map (pusat: 3.59, 98.67)
5. Load saved routes dari LocalStorage/Firestore
6. Render UI (status panel, voice panel, route panel)
7. Check GPS permission status
```

### 2️⃣ Request GPS Permission
```
1. Show permission popup
2. User klik "Berikan Akses Lokasi"
3. Browser permission dialog
4. User Allow/Deny
5. If Allow → hide popup, start GPS tracking
6. If Deny → show error, show retry button
```

### 3️⃣ GPS Tracking
```
1. Start watchPosition (every 1 second)
2. Get GPS coordinates
3. Validate accuracy (< 500m)
4. Block cached/default locations
5. Update blue marker (user position)
6. Update accuracy circle (yellow)
7. Update coordinates in UI
```

### 4️⃣ Activation
```
App: Senavision Siap, Panduan Penggunaan:
1. Isilah rute terlebih dahulu, Ucapkan Rute 1 atau Rute 2 dan seterusnya untuk menuju Lokasi yang anda Tuju. Selamat menikmati Perjalanan.
2. App: Mikrofon Di Aktifkan
(Mikrofon Aktif)
3. User: Rute Satu 
(Mikrofon Mati)
4. App: Rute 1, Anda dari The Hotel Alana, Blulukan, Colomadu menuju Solo Square Mall. Dengan Jarak ... dan Waktu tempuh ... . Ucapkan Navigasi untuk memulai, Jika tidak Ucapkan Ganti Rute.
(Mikrofon Aktif)
5. User: Ganti Rute
(Mikrofon Mati)
6. App: Berganti Rute. Sebutkan Rute yang ingin anda tuju
(Mikrofon Aktif)
7. User: Rute 2
(Mikrofon Mati)
8. App: Rute 2, Anda dari The Hotel Alana,Colomadu. menuju Solo Square Mall,Laweyan. Dengan Jarak ... dan Waktu tempuh ... . Ucapkan Navigasi untuk memulai, Jika tidak Ucapkan Ganti Rute.
(Mikrofon Aktif)
9. User: Navigasi //Maka Langusung menuntut memberi arah sampai titik lokasi realtime user dekat dengan titik lokasi tujuan
(Mikrofon Mati)
10. App: Anda sudah sampai di tujuan. Jika ingin melanjutkan lagi maka ucapkan Rute yang ingin anda tuju, Jika tidak maka ucapkan stop
11. //Jika user mengucapkan Rute yang di tuju maka akan mengulang ke point 4
(Mikrofon Aktif)
12. User: Stop
(Mikrofon Mati)
13. App: Senavision Off

Note: Jangan sampai bertabrakan mic on dengan suara speaker
```

### 7️⃣ Real-time Navigation
```
Loop (every 1 second):
1. Update GPS position
2. Move blue marker
3. Update route (following user movement)
4. Check distance to next turn
5. If distance < 200m → announce direction
6. Pan map to follow user (if moving)
7. Update instruction distances
8. Hide passed instructions
```

### 8️⃣ Voice Directions
```
Trigger: Distance to turn < 200 meters

Announce:
- "Setelah 50 meter Belok kiri"
- "Belok kanan sekarang"
- "Lurus terus 150 meter"

Process:
1. Parse instruction text
2. Translate to Indonesian
3. Convert distance
4. Check not duplicate
5. Speak using Speech Synthesis
6. Mark as announced
```

### 9️⃣ Route Management
```
Panel "Kelola Rute":
1. Show 6 route slots (1-6)
2. Click route → edit form
3. Input start & end
4. Geocode locations
5. Save to localStorage + Firestore
6. Refresh route list

Voice:
"Rute 1" → select route
```

### 🔟 Cancel Navigation
```
User Actions:
Click stop button
Navigasi Di Batalkan
(Akan kembali ke Alur nomer 4 Activation pada point 2)
```

---

## Data Flow

### GPS Position
```
GPS Sensor → navigator.geolocation → onLocationFound()
→ Validate accuracy → Update marker → Update route → Voice direction
```

### Voice Input
```
Microphone → Speech Recognition → handleVoiceCommand()
→ Parse command → Execute action → Speech Synthesis response
```

### Route Calculation
```
Start Point + End Point → OSRM API → Route coordinates
→ Draw on map → Translate instructions → Store in Firestore
```

### Cloud Sync
```
LocalStorage → loadUserSavedRoutes() → Firestore
Firestore → saveUserSavedRoutes() → LocalStorage
Both → Always in sync (read from Firestore, write to both)
```

---

## Key Files

### map.html (217 lines)
- HTML structure
- Panels: status, voice, route, debug
- External CDN links
- Firebase config

### index.js (3732 lines)
- GPS tracking logic
- Speech recognition
- Route management
- Voice directions
- Firestore sync
- UI interactions

### map.css (1270 lines)
- Responsive design
- Glassmorphism effects
- Panel styling
- Mobile/Desktop layouts

### firebase-app.js (154 lines)
- Firebase initialization
- Auth handlers
- Firestore helpers
- Global functions

---

## Configuration

### GPS Settings
```javascript
LOCATION_UPDATE_INTERVAL = 1000  // 1 second
MAX_ACCEPTABLE_ACCURACY = 500    // meters
MAX_ACCURACY_RADIUS = 1000       // circle max
```

### Route Settings
```javascript
savedRoutes = []  // 6 slots
routeAnnounceDistance = 200  // meters
passedThreshold = 50  // meters
```

### Voice Settings
```javascript
lang = 'id-ID'
continuous = true
interimResults = true
rate = 0.85
pitch = 1
volume = 1
```

---

## Firebase Structure

```
senavision-id/
  ├── users/
  │   └── {uid}/
  │       ├── lastActive: timestamp
  │       ├── latestRoute: {...}
  │       ├── savedRoutes: Array[6]
  │       └── routes/  (subcollection)
  │           └── {autoId}/
  │               ├── type: string
  │               ├── summary: {...}
  │               ├── destination: {...}
  │               └── createdAt: timestamp
```

---

## User Journey Example

```
1. Buka map.html
2. Izin lokasi → Allow
3. Ucapkan "Rute 1" → Menuju Rute 1
4. Ucapkan "Navigasi" → Dimulai
5. Ikuti suara arahan
6. Sampai tujuan
```

---

## Endpoints Used

### OpenStreetMap
- Tiles: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- Geocoding: `https://nominatim.openstreetmap.org/search`

### OSRM
- Routing: Default Leaflet Routing Machine server

### Firebase
- Auth: Google Sign-In
- Firestore: Cloud database
- Config: senavision-id project

---

## Error Handling

### GPS Errors
```javascript
- Timeout → Retry
- Permission denied → Show popup
- Position unavailable → Retry with longer timeout
- Cached location → Block, request fresh
```

### Voice Errors
```javascript
- Not allowed → Click to enable
- No speech → Continue listening
- Aborted → Auto-restart
- Network → Fallback to offline
```

### Route Errors
```javascript
- OSRM error → Announce error
- Geocoding fail → Show message
- Network error → Retry
```

---

## Testing Checklist

- [ ] GPS tracking works
- [ ] Permission popup shows/hides
- [ ] Voice commands recognized
- [ ] Route calculation succeeds
- [ ] Directions announced correctly
- [ ] Saved routes load/save
- [ ] Firebase sync works
- [ ] Mobile responsive
- [ ] Desktop layout correct
- [ ] Debug console logs
- [ ] Error messages clear

---

**Last Updated:** Analisis berdasarkan kode terbaru
**Version:** Current implementation

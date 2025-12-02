# 🧪 Panduan Testing Fitur Baru di Laptop

## 🎯 Fitur Baru yang Ditambahkan

1. **Announcement "Belok Kanan/Kiri"** - Navigator sekarang mengatakan "Belok kanan" atau "Belok kiri" dengan jelas
2. **Marker Belokan** - Setiap titik belokan ditandai dengan marker berwarna di peta

---

## 🚀 Quick Start Testing

### Step 1: Buka Aplikasi di Browser

1. Buka terminal di folder project
2. Jalankan local server:
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Atau Python 2
   python -m SimpleHTTPServer 8000
   ```
3. Buka browser: `http://localhost:8000/map/map.html`
4. Buka Console (`F12` → Console tab)

### Step 2: Test Fitur Baru (Otomatis)

Copy-paste script ini ke Console:

```javascript
// Test lengkap fitur baru: marker belokan + announcement
testNavigation.testTurnMarkersAndAnnouncement();
```

**Script ini akan:**
- ✅ Set lokasi awal (Jakarta)
- ✅ Buat route dengan belokan
- ✅ Check marker belokan
- ✅ Test announcement "belok kanan/kiri"

---

## 📋 Testing Step-by-Step

### Test 1: Check Marker Belokan

```javascript
// 1. Set lokasi awal
testNavigation.setLocation(-6.2088, 106.8456, 10);

// 2. Set destination dan buat route
setTimeout(() => {
    testNavigation.startNavigation(-6.2148, 106.8556, 'Tujuan Test');
    
    // 3. Check marker belokan setelah route dibuat
    setTimeout(() => {
        testNavigation.checkTurnMarkers();
    }, 3000);
}, 2000);
```

**Expected Result:**
- ✅ Console menampilkan jumlah marker belokan
- ✅ Marker belokan terlihat di peta sebagai lingkaran berwarna:
  - 🔵 Teal (#4ecdc4) untuk belok kanan
  - 🔴 Red (#ff6b6b) untuk belok kiri

---

### Test 2: Test Announcement "Belok Kanan/Kiri"

```javascript
// Test announcement "belok kanan"
testNavigation.testVoice('Belok kanan sekarang');

// Test announcement "belok kiri" (setelah 3 detik)
setTimeout(() => {
    testNavigation.testVoice('Belok kiri sekarang');
}, 3000);

// Test dengan jarak
setTimeout(() => {
    testNavigation.testVoice('Setelah 50 meter Belok kanan');
}, 6000);
```

**Expected Result:**
- ✅ Navigator berbicara: "Belok kanan sekarang"
- ✅ Navigator berbicara: "Belok kiri sekarang"
- ✅ Navigator berbicara: "Setelah 50 meter Belok kanan"

---

### Test 3: Test Real-time Navigation dengan Belokan

```javascript
// 1. Setup lokasi dan route
testNavigation.setLocation(-6.2088, 106.8456, 10);

setTimeout(() => {
    // 2. Buat route dengan belokan
    testNavigation.startNavigation(-6.2148, 106.8556, 'Tujuan');
    
    setTimeout(() => {
        // 3. Simulasi pergerakan mendekati belokan
        testNavigation.simulateApproachingTurn();
    }, 3000);
}, 2000);
```

**Expected Result:**
- ✅ Marker belokan muncul di peta
- ✅ Saat user mendekati belokan (< 200m), navigator berbicara: "Setelah X meter Belok kanan/kiri"
- ✅ Console log menampilkan setiap announcement

---

## 🔍 Debug Commands

### Check Marker Belokan

```javascript
testNavigation.checkTurnMarkers();
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🎯 CHECK: Turn Markers Status                               ║
╚══════════════════════════════════════════════════════════════╝

┌─────────────────────┬───────┐
│ turnMarkersCount    │ 3     │
│ hasRoute            │ true  │
│ routeInstructions   │ 15    │
└─────────────────────┴───────┘

✅ Ditemukan 3 marker belokan di peta!
   Marker #1: -6.210000, 106.850000
   Marker #2: -6.212000, 106.852000
   Marker #3: -6.214000, 106.854000
```

### Check State Navigator

```javascript
testNavigation.checkNavigatorSpeaking();
```

### Monitor Navigator Real-time

```javascript
// Monitor selama 60 detik
testNavigation.monitorNavigator(60);
```

---

## 🎯 Test Lengkap Otomatis

### Script Lengkap untuk Test Semua Fitur Baru

```javascript
// ============================================
// TEST LENGKAP: Fitur Baru (Marker + Announcement)
// ============================================

console.log('🚀 Memulai test lengkap fitur baru...\n');

// Test 1: Marker belokan + Announcement
testNavigation.testTurnMarkersAndAnnouncement();

// Setelah 15 detik, test real-time navigation
setTimeout(() => {
    console.log('\n🚶 Memulai test real-time navigation...');
    testNavigation.simulateApproachingTurn();
}, 15000);
```

---

## ✅ Checklist Testing

Setelah menjalankan test, pastikan:

- [ ] ✅ Marker belokan muncul di peta (lingkaran berwarna)
- [ ] ✅ Marker belokan memiliki warna berbeda untuk kanan/kiri
- [ ] ✅ Announcement mengatakan "Belok kanan" atau "Belok kiri" dengan jelas
- [ ] ✅ Announcement muncul saat mendekati belokan (< 200m)
- [ ] ✅ Format announcement: "Setelah X meter Belok kanan/kiri" atau "Belok kanan/kiri sekarang"
- [ ] ✅ Console log menampilkan informasi marker belokan

---

## 🐛 Troubleshooting

### Problem: Marker Belokan Tidak Muncul

**Check:**
```javascript
// 1. Pastikan route sudah dibuat
console.log('Route:', route !== null);
console.log('Route Data:', currentRouteData !== null);

// 2. Check marker belokan
testNavigation.checkTurnMarkers();

// 3. Check route instructions
if (currentRouteData && currentRouteData.instructions) {
    console.log('Instructions:', currentRouteData.instructions.length);
    currentRouteData.instructions.forEach((inst, i) => {
        if (inst.text && (inst.text.includes('turn') || inst.text.includes('belok'))) {
            console.log(`Instruction ${i}:`, inst.text);
        }
    });
}
```

**Solution:**
- Pastikan route sudah dibuat dengan `testNavigation.startNavigation(...)`
- Tunggu beberapa detik setelah route dibuat
- Pastikan route memiliki instructions dengan belokan

---

### Problem: Announcement Tidak Jelas

**Check:**
```javascript
// Test announcement langsung
testNavigation.testVoice('Belok kanan sekarang');
testNavigation.testVoice('Belok kiri sekarang');
```

**Solution:**
- Pastikan volume browser/system tidak muted
- Check console untuk error
- Test dengan `testNavigation.testVoice(...)` langsung

---

### Problem: Announcement Tidak Muncul Saat Mendekati Belokan

**Check:**
```javascript
// Check prerequisites
testNavigation.debugTurnAnnouncement();

// Check state
testNavigation.checkState();
```

**Solution:**
- Pastikan `isNavigating = true`
- Pastikan `voiceDirectionsEnabled = true`
- Pastikan jarak ke belokan < 200m
- Pastikan route sudah dibuat

---

## 📝 Contoh Koordinat untuk Testing

### Jakarta (dengan belokan)
```javascript
// Start: Jakarta Pusat
testNavigation.setLocation(-6.2088, 106.8456, 10);

// Destination: Jakarta Selatan (akan ada belokan)
testNavigation.startNavigation(-6.2148, 106.8556, 'Jakarta Selatan');
```

### Solo (dengan belokan)
```javascript
// Start: Solo
testNavigation.setLocation(-7.5667, 110.8167, 10);

// Destination: Solo Selatan
testNavigation.startNavigation(-7.5767, 110.8267, 'Solo Selatan');
```

---

## 💡 Tips

1. **Gunakan Console Logs**: Semua informasi marker dan announcement akan di-log di console
2. **Lihat Peta**: Marker belokan akan terlihat sebagai lingkaran berwarna di peta
3. **Dengarkan Suara**: Pastikan volume tidak muted untuk mendengar announcement
4. **Test Berulang**: Jalankan test beberapa kali untuk memastikan konsistensi

---

## 🎉 Success Indicators

Jika semua test berhasil, Anda akan melihat:

1. ✅ **Marker Belokan**: Lingkaran berwarna muncul di setiap titik belokan di peta
2. ✅ **Announcement Jelas**: Navigator mengatakan "Belok kanan" atau "Belok kiri" dengan jelas
3. ✅ **Real-time**: Announcement muncul otomatis saat mendekati belokan
4. ✅ **Console Logs**: Informasi lengkap di console untuk debugging

---

**Selamat Testing! 🚀**

Jika ada masalah, jalankan:
```javascript
testNavigation.checkTurnMarkers();
testNavigation.debugTurnAnnouncement();
```



# Panduan Testing Navigasi di Laptop

## 🎯 Overview
Panduan lengkap untuk mengetes aplikasi navigasi SenaVision di laptop (tanpa GPS real).

---

## 📋 Persiapan

### 1. Jalankan Local Server

Aplikasi memerlukan HTTPS atau localhost untuk akses GPS. Gunakan salah satu cara berikut:

#### Opsi A: Python HTTP Server (Paling Mudah)
```bash
# Buka terminal di folder project
cd C:\Users\USER\Documents\edan-1

# Python 3
python -m http.server 8000

# Atau Python 2
python -m SimpleHTTPServer 8000
```

#### Opsi B: Node.js HTTP Server
```bash
# Install http-server global (sekali saja)
npm install -g http-server

# Jalankan server
cd C:\Users\USER\Documents\edan-1
http-server -p 8000
```

#### Opsi C: VS Code Live Server
- Install extension "Live Server" di VS Code
- Klik kanan pada `map/map.html` → "Open with Live Server"

### 2. Buka Aplikasi
```
http://localhost:8000/map/map.html
```

---

## 🧪 Cara Testing

### Metode 1: Simulasi GPS via Browser DevTools (Chrome/Edge)

#### Langkah-langkah:

1. **Buka DevTools**
   - Tekan `F12` atau `Ctrl+Shift+I`
   - Buka tab **Console**

2. **Aktifkan Sensor Override**
   - Tekan `Ctrl+Shift+P` (Command Palette)
   - Ketik: `Show Sensors`
   - Pilih **Show Sensors**
   - Tab **Sensors** akan muncul di DevTools

3. **Set Location Override**
   - Di tab **Sensors**, pilih **Location**
   - Pilih preset location atau set custom:
     - **Custom location**: Klik "Manage" → "Add location"
     - Contoh koordinat Jakarta: `-6.2088, 106.8456`
     - Contoh koordinat Solo: `-7.5667, 110.8167`

4. **Simulasi Pergerakan GPS**
   - Gunakan script di Console (lihat bagian Script Helper di bawah)

---

### Metode 2: Manual GPS Simulation via Console

Buka Console (`F12` → Console) dan jalankan script berikut:

#### Script 1: Set Lokasi Awal
```javascript
// Set lokasi awal (contoh: Jakarta)
const startLat = -6.2088;
const startLng = 106.8456;

// Simulasi GPS update
if (typeof onLocationFound === 'function') {
    const mockEvent = {
        latlng: L.latLng(startLat, startLng),
        accuracy: 10 // 10 meter accuracy (sangat akurat)
    };
    onLocationFound(mockEvent);
    console.log('✅ Lokasi awal diset:', startLat, startLng);
}
```

#### Script 2: Simulasi Pergerakan (Berjalan)
```javascript
// Simulasi user bergerak dari titik A ke titik B
let currentLat = -6.2088; // Start: Jakarta
let currentLng = 106.8456;
const targetLat = -6.2148; // Target: 600m ke selatan
const targetLng = 106.8456;

const steps = 30; // 30 langkah
const latStep = (targetLat - currentLat) / steps;
const lngStep = (targetLng - currentLng) / steps;

let stepCount = 0;
const moveInterval = setInterval(() => {
    if (stepCount >= steps) {
        clearInterval(moveInterval);
        console.log('✅ Simulasi pergerakan selesai');
        return;
    }
    
    currentLat += latStep;
    currentLng += lngStep;
    
    const mockEvent = {
        latlng: L.latLng(currentLat, currentLng),
        accuracy: 10
    };
    
    if (typeof onLocationFound === 'function') {
        onLocationFound(mockEvent);
    }
    
    stepCount++;
    console.log(`📍 Langkah ${stepCount}/${steps}:`, currentLat.toFixed(6), currentLng.toFixed(6));
}, 1000); // Update setiap 1 detik
```

#### Script 3: Test Voice Navigation
```javascript
// Test fungsi speakText langsung
if (typeof speakText === 'function') {
    speakText('Setelah 50 meter Belok kiri', 'id-ID', true);
    console.log('✅ Test suara: "Setelah 50 meter Belok kiri"');
}
```

#### Script 4: Test Navigation Announcement
```javascript
// Test announceNextDirection langsung
if (typeof announceNextDirection === 'function') {
    // Pastikan navigasi aktif dulu
    isNavigating = true;
    announceNextDirection();
    console.log('✅ Test navigation announcement');
}
```

---

### Metode 3: Testing Lengkap dengan Helper Script

Copy script lengkap ini ke Console untuk testing otomatis:

```javascript
// ============================================
// HELPER SCRIPT: Testing Navigation di Laptop
// ============================================

window.testNavigation = {
    // Set lokasi awal
    setLocation: function(lat, lng, accuracy = 10) {
        if (typeof onLocationFound === 'function') {
            const mockEvent = {
                latlng: L.latLng(lat, lng),
                accuracy: accuracy
            };
            onLocationFound(mockEvent);
            console.log('✅ Lokasi diset:', lat, lng, '(accuracy:', accuracy + 'm)');
        }
    },
    
    // Simulasi pergerakan dari A ke B
    simulateMovement: function(startLat, startLng, endLat, endLng, duration = 30) {
        let currentLat = startLat;
        let currentLng = startLng;
        const latStep = (endLat - startLat) / duration;
        const lngStep = (endLng - startLng) / duration;
        
        let step = 0;
        const interval = setInterval(() => {
            if (step >= duration) {
                clearInterval(interval);
                console.log('✅ Simulasi selesai');
                return;
            }
            
            currentLat += latStep;
            currentLng += lngStep;
            
            this.setLocation(currentLat, currentLng, 10);
            step++;
        }, 1000);
        
        console.log('🚶 Simulasi pergerakan dimulai...');
        return interval;
    },
    
    // Set destination dan mulai navigasi
    startNavigation: function(destLat, destLng, destName = 'Tujuan') {
        // Set destination
        if (typeof updateDestination === 'function') {
            updateDestination(destLat, destLng, destName);
            console.log('✅ Destination diset:', destName);
        }
        
        // Start navigation
        if (typeof startTurnByTurnNavigation === 'function') {
            startTurnByTurnNavigation();
            console.log('✅ Navigasi dimulai');
        }
    },
    
    // Test voice announcement
    testVoice: function(text = 'Setelah 50 meter Belok kiri') {
        if (typeof speakText === 'function') {
            speakText(text, 'id-ID', true);
            console.log('✅ Test suara:', text);
        }
    },
    
    // Test lengkap: Lokasi → Destination → Navigasi
    fullTest: function() {
        console.log('🧪 Memulai test lengkap...');
        
        // 1. Set lokasi awal (Jakarta)
        this.setLocation(-6.2088, 106.8456, 10);
        
        setTimeout(() => {
            // 2. Set destination (600m ke selatan)
            this.startNavigation(-6.2148, 106.8456, 'Tujuan Test');
            
            setTimeout(() => {
                // 3. Simulasi pergerakan
                this.simulateMovement(-6.2088, 106.8456, -6.2148, 106.8456, 20);
            }, 3000);
        }, 2000);
    }
};

// Cara pakai:
console.log(`
📖 CARA PAKAI:
1. testNavigation.setLocation(-6.2088, 106.8456)  // Set lokasi
2. testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan')  // Set tujuan & mulai navigasi
3. testNavigation.testVoice('Setelah 50 meter Belok kiri')  // Test suara
4. testNavigation.fullTest()  // Test lengkap otomatis
`);
```

---

## 🎤 Testing Voice Commands

### 1. Test Speech Recognition
```javascript
// Check apakah speech recognition tersedia
console.log('Speech Recognition:', 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

// Test start recognition
if (typeof toggleVoiceListening === 'function') {
    toggleVoiceListening();
    console.log('✅ Voice listening toggled');
}
```

### 2. Test Voice Commands Manual
Setelah mikrofon aktif, ucapkan:
- **"Rute 1"** - untuk memilih rute
- **"Navigasi"** - untuk mulai navigasi
- **"Stop"** - untuk berhenti
- **"Ganti Rute"** - untuk ganti rute

### 3. Simulasi Voice Command via Console
```javascript
// Simulasi user mengatakan "Rute 1"
if (typeof handleVoiceCommand === 'function') {
    handleVoiceCommand('Rute 1');
    console.log('✅ Simulasi command: "Rute 1"');
}

// Simulasi user mengatakan "Navigasi"
setTimeout(() => {
    if (typeof handleVoiceCommand === 'function') {
        handleVoiceCommand('Navigasi');
        console.log('✅ Simulasi command: "Navigasi"');
    }
}, 2000);
```

---

## 🗺️ Testing Route Management

### 1. Buat Rute via Console
```javascript
// Buat rute 1 dari lokasi saat ini ke tujuan
if (typeof setRoute === 'function' && typeof getCurrentLocationAsStart === 'function') {
    const start = getCurrentLocationAsStart();
    if (start) {
        const end = {
            lat: -6.2148,
            lng: 106.8456,
            name: 'Tujuan Test'
        };
        
        if (setRoute(1, start, end)) {
            console.log('✅ Rute 1 berhasil dibuat');
            // Refresh UI
            if (typeof renderRouteList === 'function') {
                renderRouteList();
            }
        }
    }
}
```

### 2. Test Route Selection
```javascript
// Pilih rute 1
if (typeof handleRouteCommand === 'function') {
    handleRouteCommand(1);
    console.log('✅ Rute 1 dipilih');
}
```

---

## 🔍 Debugging Tips

### 1. Check State Variables
```javascript
// Check state navigasi
console.log('isNavigating:', typeof isNavigating !== 'undefined' ? isNavigating : 'undefined');
console.log('currentUserPosition:', currentUserPosition);
console.log('latLngB (destination):', latLngB);
console.log('route:', route);
console.log('isListening:', isListening);
```

### 2. Check Speech Coordinator
```javascript
// Check SpeechCoordinator state
if (typeof window.SpeechCoordinator !== 'undefined') {
    console.log('SpeechCoordinator State:', window.SpeechCoordinator.getState());
}
```

### 3. Test Navigation Voice Function
```javascript
// Test fungsi testNavigationVoice yang sudah ada
if (typeof window.testNavigationVoice === 'function') {
    window.testNavigationVoice('Test suara navigasi');
}
```

---

## 📝 Checklist Testing

- [ ] Local server berjalan (localhost:8000)
- [ ] Aplikasi terbuka di browser
- [ ] GPS permission diberikan (atau di-simulate)
- [ ] Lokasi awal terdeteksi (marker biru muncul)
- [ ] Rute bisa dibuat (via UI atau console)
- [ ] Voice command "Rute 1" bekerja
- [ ] Voice command "Navigasi" bekerja
- [ ] Navigation announcement muncul saat mendekati belokan
- [ ] Suara "Belok kiri/kanan" terdengar jelas
- [ ] Mikrofon mati saat navigator berbicara
- [ ] Mikrofon aktif kembali setelah navigator selesai

---

## ⚠️ Troubleshooting

### Problem: GPS tidak terdeteksi
**Solusi:**
- Pastikan menggunakan localhost (bukan file://)
- Gunakan browser Chrome/Edge (support GPS simulation)
- Atau gunakan script manual di Console

### Problem: Voice tidak terdengar
**Solusi:**
- Check volume browser/system
- Test dengan `window.testNavigationVoice('Test')`
- Check console untuk error

### Problem: Navigation tidak announce
**Solusi:**
- Pastikan `isNavigating = true`
- Pastikan route sudah dibuat
- Check jarak ke belokan (harus < 200m)
- Check console untuk log `announceNextDirection`

---

## 🎯 Quick Test Script

Copy-paste ini ke Console untuk quick test:

```javascript
// Quick Test: Set location → Create route → Start navigation
testNavigation.setLocation(-6.2088, 106.8456, 10);
setTimeout(() => {
    testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan');
    setTimeout(() => {
        testNavigation.testVoice('Setelah 50 meter Belok kiri');
    }, 2000);
}, 2000);
```

---

**Selamat Testing! 🚀**






# 🔍 Debug: Test Turn Announcement

## 📋 Overview
Script debug lengkap untuk memastikan navigator benar-benar berbicara saat user akan berbelok.

---

## 🚀 Quick Start

### Test Lengkap (Recommended)
```javascript
// 1. Setup lokasi dan navigasi
testNavigation.setLocation(-6.2088, 106.8456, 10);
testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan Test');

// 2. Mulai navigasi (simulasi user ucapkan "Navigasi")
testNavigation.simulateCommand('Navigasi');

// 3. Debug turn announcement
testNavigation.debugTurnAnnouncement();

// 4. Simulasi mendekati belokan
testNavigation.simulateApproachingTurn();
```

---

## 📝 Step-by-Step Debug

### Step 1: Setup Prerequisites

```javascript
// Set lokasi awal
testNavigation.setLocation(-6.2088, 106.8456, 10);

// Set tujuan dan mulai navigasi
testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan Test');

// Pastikan navigasi aktif (simulasi user ucapkan "Navigasi")
testNavigation.simulateCommand('Navigasi');
```

**Expected Output:**
```
✅ Lokasi diset: -6.2088, 106.8456
✅ Destination diset: Tujuan Test
✅ Navigasi dimulai
```

---

### Step 2: Test Voice Announcement

```javascript
testNavigation.debugTurnAnnouncement();
```

**Fungsi ini akan:**
1. ✅ Check semua prerequisites (speechSynthesis, voiceDirectionsEnabled, dll)
2. ✅ Test voice announcement langsung
3. ✅ Monitor apakah navigator benar-benar berbicara
4. ✅ Verify dengan `speechSynthesis.speaking`

**Expected Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🔍 DEBUG: TEST TURN ANNOUNCEMENT                            ║
╚══════════════════════════════════════════════════════════════╝

📋 STEP 1: Checking prerequisites...
┌─────────────────────┬───────┐
│ speechSynthesis     │ true  │
│ voiceDirectionsEnabled │ true  │
│ isNavigating        │ true  │
│ hasRoute            │ true  │
│ hasUserPosition     │ true  │
│ hasDestination      │ true  │
└─────────────────────┴───────┘
✅ Semua prerequisites OK!

📋 STEP 2: Testing voice announcement...
🔊 Menguji: "Setelah 50 meter Belok kiri"
✅ [VERIFIED] Navigator MULAI berbicara!
   🔊 Speech synthesis isSpeaking = true
✅ [VERIFIED] Navigator SELESAI berbicara!
   ✅ Speech synthesis isSpeaking = false
```

---

### Step 3: Simulasi Mendekati Belokan

```javascript
testNavigation.simulateApproachingTurn();
```

**Fungsi ini akan:**
1. ✅ Simulasi user bergerak dari 250m → 200m → 50m → 0m ke belokan
2. ✅ Monitor setiap announcement yang muncul
3. ✅ Log dengan timestamp setiap kali navigator berbicara
4. ✅ Report total announcements di akhir

**Expected Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🚶 SIMULASI: User Mendekati Belokan                         ║
╚══════════════════════════════════════════════════════════════╝

✅ Navigasi aktif, mulai simulasi...

📍 Simulasi dimulai dari: -6.2088, 106.8456
🎯 Tujuan: -6.2148, 106.8456
📏 Total jarak: ~600 meter
⏱️  Setiap langkah = 1 detik (~20 meter)

🚶 Simulasi pergerakan dimulai...

📍 Langkah 5/30 - Jarak tersisa: ~500m
📍 Langkah 10/30 - Jarak tersisa: ~400m
📍 Langkah 15/30 - Jarak tersisa: ~300m
📍 Langkah 20/30 - Jarak tersisa: ~200m
  ⚠️  MENDEKATI BELOKAN! Navigator seharusnya berbicara...
[14:30:25] 🔊 NAVIGATOR BERBICARA (announcement #1)
📍 Langkah 25/30 - Jarak tersisa: ~100m
[14:30:30] 🔊 NAVIGATOR BERBICARA (announcement #2)
📍 Langkah 30/30 - Jarak tersisa: ~0m

✅ Simulasi selesai!
📊 Total announcements: 2
✅ [VERIFIED] Navigator BERHASIL berbicara saat user mendekati belokan!
```

---

## 🔧 Manual Debug Commands

### Check State Navigator
```javascript
testNavigation.checkNavigatorSpeaking();
```

**Output:**
```
🔊 Navigator Speaking State: {
  speechSynthesisAvailable: true,
  isSpeaking: false,
  isPending: false,
  isPaused: false,
  isNavigating: true,
  voiceDirectionsEnabled: true
}
🔇 Navigator TIDAK berbicara
```

### Monitor Real-time
```javascript
// Monitor selama 60 detik
testNavigation.monitorNavigator(60);
```

**Output:**
```
📊 Memulai monitoring navigator selama 60 detik...
[5s] 🔇 Navigator tidak berbicara (normal jika tidak ada belokan)
[10s] 🔇 Navigator tidak berbicara (normal jika tidak ada belokan)
[15s] 🔊 Navigator SEDANG BERBICARA
[20s] 🔇 Navigator tidak berbicara (normal jika tidak ada belokan)
...
```

### Test Voice Langsung
```javascript
testNavigation.testVoice('Setelah 50 meter Belok kiri');
```

**Output:**
```
🧪 Testing navigation voice announcement...
📢 Text yang akan diucapkan: Setelah 50 meter Belok kiri
📊 State sebelum speak: { speaking: false, pending: false, paused: false }
🔊 [NAVIGATOR] Mulai berbicara: Setelah 50 meter Belok kiri
[14:30:25] 🔊 NAVIGATOR MULAI BERBICARA: "Setelah 50 meter Belok kiri"
📊 State monitoring (1s): { speaking: true, pending: false, paused: false, time: "1s" }
📊 State monitoring (2s): { speaking: true, pending: false, paused: false, time: "2s" }
✅ [NAVIGATOR] Selesai berbicara: Setelah 50 meter Belok kiri
[14:30:27] ✅ NAVIGATOR SELESAI BERBICARA: "Setelah 50 meter Belok kiri"
📊 State setelah speak: { speaking: false, pending: false, paused: false }
```

---

## ✅ Verification Checklist

Setelah menjalankan debug, pastikan:

- [ ] ✅ `speechSynthesis` tersedia
- [ ] ✅ `voiceDirectionsEnabled = true`
- [ ] ✅ `isNavigating = true`
- [ ] ✅ Route sudah dibuat (`hasRoute = true`)
- [ ] ✅ User position ada (`hasUserPosition = true`)
- [ ] ✅ Destination sudah diset (`hasDestination = true`)
- [ ] ✅ Navigator berbicara saat test (`announcementStarted = true`)
- [ ] ✅ Navigator selesai berbicara (`announcementEnded = true`)
- [ ] ✅ Total announcements > 0 saat simulasi pergerakan

---

## 🐛 Troubleshooting

### Problem: Navigator tidak berbicara

**Check:**
```javascript
// 1. Check prerequisites
testNavigation.debugTurnAnnouncement();

// 2. Check state
testNavigation.checkNavigatorSpeaking();

// 3. Check voice directions enabled
console.log('voiceDirectionsEnabled:', voiceDirectionsEnabled);
```

**Solutions:**
- Pastikan `voiceDirectionsEnabled = true`
- Pastikan `isNavigating = true`
- Pastikan route sudah dibuat
- Pastikan jarak ke belokan < 200m

---

### Problem: Prerequisites tidak terpenuhi

**Jika `hasUserPosition = false`:**
```javascript
testNavigation.setLocation(-6.2088, 106.8456, 10);
```

**Jika `hasRoute = false` atau `hasDestination = false`:**
```javascript
testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan');
```

**Jika `isNavigating = false`:**
```javascript
testNavigation.simulateCommand('Navigasi');
```

---

## 📊 Expected Results

### ✅ Success Case
```
✅ Semua prerequisites OK!
✅ [VERIFIED] Navigator MULAI berbicara!
✅ [VERIFIED] Navigator SELESAI berbicara!
📊 Total announcements: 2
✅ [VERIFIED] Navigator BERHASIL berbicara saat user mendekati belokan!
```

### ❌ Failure Case
```
⚠️ Navigator TIDAK berbicara - check:
  → Apakah route sudah dibuat?
  → Apakah voiceDirectionsEnabled = true?
  → Apakah jarak ke belokan < 200m?
```

---

## 🎯 Complete Test Script

Copy-paste ini untuk test lengkap:

```javascript
// ============================================
// COMPLETE DEBUG SCRIPT
// ============================================

console.log('🚀 Starting complete debug test...\n');

// Step 1: Setup
console.log('📋 Step 1: Setup location and navigation...');
testNavigation.setLocation(-6.2088, 106.8456, 10);

setTimeout(() => {
    testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan Test');
    
    setTimeout(() => {
        // Step 2: Start navigation
        console.log('\n📋 Step 2: Starting navigation...');
        testNavigation.simulateCommand('Navigasi');
        
        setTimeout(() => {
            // Step 3: Debug turn announcement
            console.log('\n📋 Step 3: Testing turn announcement...');
            testNavigation.debugTurnAnnouncement();
            
            setTimeout(() => {
                // Step 4: Simulate approaching turn
                console.log('\n📋 Step 4: Simulating approaching turn...');
                testNavigation.simulateApproachingTurn();
            }, 5000);
        }, 3000);
    }, 3000);
}, 2000);
```

---

## 📝 Notes

1. **Jarak Announcement**: Navigator akan berbicara saat jarak ke belokan **≤ 200 meter**
2. **Auto-restart**: Navigator akan auto-restart setelah selesai berbicara
3. **Monitoring**: Gunakan `monitorNavigator()` untuk monitoring real-time
4. **Console Logs**: Semua announcement akan di-log dengan timestamp

---

**Last Updated:** Setelah penambahan debug functions






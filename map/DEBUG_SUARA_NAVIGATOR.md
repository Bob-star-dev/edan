# 🔍 Debug: Suara Navigator Tidak Muncul

## 🚨 Masalah
Navigator tidak berbicara saat mendekati belokan, meskipun semua kondisi sudah terpenuhi.

## 🔧 Script Debug Lengkap

Copy-paste script ini ke Console Browser untuk debug:

```javascript
// ============================================
// SCRIPT DEBUG SUARA NAVIGATOR
// ============================================

console.log('🔍 Memulai debug suara navigator...\n');

// 1. Check SpeechSynthesis availability
console.log('📋 STEP 1: Check SpeechSynthesis');
const speechCheck = {
    'speechSynthesis available': 'speechSynthesis' in window,
    'speechSynthesis.speaking': window.speechSynthesis ? window.speechSynthesis.speaking : 'N/A',
    'speechSynthesis.pending': window.speechSynthesis ? window.speechSynthesis.pending : 'N/A',
    'hasUserInteraction': typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : 'undefined',
    'voiceDirectionsEnabled': typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : 'undefined',
    'isNavigating': typeof isNavigating !== 'undefined' ? isNavigating : 'undefined'
};
console.table(speechCheck);

// 2. Test basic speech
console.log('\n📋 STEP 2: Test Basic Speech');
if ('speechSynthesis' in window) {
    // Set hasUserInteraction = true (CRITICAL!)
    if (typeof hasUserInteraction !== 'undefined') {
        hasUserInteraction = true;
        console.log('✅ hasUserInteraction = true');
    }
    
    // Test speak langsung
    const testUtterance = new SpeechSynthesisUtterance('Test suara navigator');
    testUtterance.lang = 'id-ID';
    testUtterance.rate = 0.85;
    testUtterance.volume = 1;
    
    testUtterance.onstart = function() {
        console.log('✅✅✅ TEST SPEECH BERHASIL MULAI!');
    };
    
    testUtterance.onerror = function(event) {
        console.error('❌ TEST SPEECH ERROR:', event.error);
        console.error('   Error name:', event.error ? event.error.name : 'unknown');
        console.error('   Error message:', event.error ? event.error.message : 'unknown');
    };
    
    testUtterance.onend = function() {
        console.log('✅ TEST SPEECH SELESAI');
    };
    
    console.log('🔊 Mencoba berbicara: "Test suara navigator"');
    window.speechSynthesis.speak(testUtterance);
    
    // Check setelah 1 detik
    setTimeout(() => {
        if (window.speechSynthesis.speaking) {
            console.log('✅ Speech synthesis sedang berbicara!');
        } else {
            console.warn('⚠️ Speech synthesis TIDAK berbicara!');
            console.warn('💡 SOLUSI:');
            console.warn('   1. Klik di halaman untuk memberikan user interaction');
            console.warn('   2. Check volume browser/system tidak muted');
            console.warn('   3. Reload halaman dan klik tombol "Berikan Akses Lokasi"');
        }
    }, 1000);
} else {
    console.error('❌ SpeechSynthesis tidak tersedia di browser ini!');
}

// 3. Check navigator state
console.log('\n📋 STEP 3: Check Navigator State');
const navCheck = {
    'voiceDirectionsEnabled': typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : 'undefined',
    'isNavigating': typeof isNavigating !== 'undefined' ? isNavigating : 'undefined',
    'hasRoute': typeof route !== 'undefined' && route !== null,
    'hasRouteData': typeof currentRouteData !== 'undefined' && currentRouteData !== null,
    'hasUserPosition': typeof currentUserPosition !== 'undefined' && currentUserPosition !== null,
    'SpeechCoordinator.isNavigating': typeof window.SpeechCoordinator !== 'undefined' ? window.SpeechCoordinator.isNavigating : 'undefined'
};
console.table(navCheck);

// 4. Test speakText function
console.log('\n📋 STEP 4: Test speakText Function');
if (typeof speakText === 'function') {
    console.log('✅ speakText function tersedia');
    console.log('🔊 Mencoba memanggil speakText("Belok kanan sekarang", "id-ID", true)...');
    
    // Set hasUserInteraction = true
    if (typeof hasUserInteraction !== 'undefined') {
        hasUserInteraction = true;
    }
    
    speakText('Belok kanan sekarang', 'id-ID', true, function() {
        console.log('✅ speakText callback dipanggil - suara selesai');
    });
    
    // Monitor selama 3 detik
    let checkCount = 0;
    const monitorInterval = setInterval(() => {
        checkCount++;
        const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
        console.log(`[${checkCount}s] Speech synthesis speaking:`, isSpeaking);
        
        if (checkCount >= 3) {
            clearInterval(monitorInterval);
            if (!isSpeaking) {
                console.warn('⚠️ speakText TIDAK membuat suara muncul!');
                console.warn('💡 SOLUSI:');
                console.warn('   1. Klik di halaman untuk memberikan user interaction');
                console.warn('   2. Reload halaman dan klik tombol "Berikan Akses Lokasi"');
                console.warn('   3. Check console untuk error messages');
            }
        }
    }, 1000);
} else {
    console.error('❌ speakText function tidak ditemukan!');
}

// 5. Test announceFromRouteData
console.log('\n📋 STEP 5: Test announceFromRouteData');
if (typeof announceFromRouteData === 'function') {
    console.log('✅ announceFromRouteData function tersedia');
    
    // Set prerequisites
    if (typeof voiceDirectionsEnabled !== 'undefined') {
        voiceDirectionsEnabled = true;
    }
    if (typeof isNavigating !== 'undefined') {
        isNavigating = true;
    }
    if (typeof hasUserInteraction !== 'undefined') {
        hasUserInteraction = true;
    }
    if (typeof window.SpeechCoordinator !== 'undefined') {
        window.SpeechCoordinator.setNavigating(true);
    }
    
    console.log('🔊 Memanggil announceFromRouteData()...');
    announceFromRouteData();
    
    setTimeout(() => {
        const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
        if (isSpeaking) {
            console.log('✅ announceFromRouteData berhasil membuat suara muncul!');
        } else {
            console.warn('⚠️ announceFromRouteData TIDAK membuat suara muncul!');
            console.warn('💡 Check:');
            console.warn('   - Apakah route memiliki instructions dengan belokan?');
            console.warn('   - Apakah jarak ke belokan < 200m?');
            console.warn('   - Apakah currentRouteData.instructions ada?');
        }
    }, 2000);
} else {
    console.error('❌ announceFromRouteData function tidak ditemukan!');
}

console.log('\n✅ Debug script selesai!');
console.log('💡 Perhatikan output di atas untuk menemukan masalahnya.');
```

## 🎯 Solusi Cepat

### Solusi 1: Set User Interaction
```javascript
// Set hasUserInteraction = true
hasUserInteraction = true;

// Test suara langsung
speakText('Belok kanan sekarang', 'id-ID', true);
```

### Solusi 2: Klik di Halaman
1. **Klik di mana saja di halaman** (untuk memberikan user interaction)
2. Jalankan script simulasi lagi:
```javascript
testNavigation.simulateRouteNavigation();
```

### Solusi 3: Reload dan Klik Tombol
1. **Reload halaman** (F5)
2. **Klik tombol "Berikan Akses Lokasi"** (ini memberikan user interaction)
3. Jalankan script simulasi lagi

### Solusi 4: Check Volume
1. **Check volume browser/system tidak muted**
2. **Check volume system Windows tidak 0**
3. **Test dengan script di atas**

## 🔍 Penyebab Umum

1. **User Interaction Required**: Browser memerlukan user interaction sebelum speechSynthesis bisa berbicara
2. **Volume Muted**: Volume browser/system muted
3. **SpeechSynthesis Error**: Ada error di speechSynthesis (check console untuk error)
4. **SpeechCoordinator Blocking**: SpeechCoordinator mungkin memblokir (jarang terjadi)
5. **Route Tidak Memiliki Belokan**: Route tidak memiliki instructions dengan belokan

## 📊 Checklist

- [ ] SpeechSynthesis tersedia (`'speechSynthesis' in window`)
- [ ] hasUserInteraction = true
- [ ] voiceDirectionsEnabled = true
- [ ] isNavigating = true
- [ ] Route memiliki instructions dengan belokan
- [ ] Jarak ke belokan < 200m
- [ ] Volume browser/system tidak muted
- [ ] Tidak ada error di console

## 💡 Tips

1. **Selalu klik di halaman** sebelum menjalankan script simulasi
2. **Check console** untuk error messages
3. **Test dengan script debug di atas** untuk menemukan masalah spesifik
4. **Reload halaman** jika masih tidak berfungsi



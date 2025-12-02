// ============================================
// SCRIPT DEBUG: Kenapa Suara Tidak Muncul?
// Copy-paste script ini ke Console Browser
// ============================================

console.log('🔍 Memulai debug suara navigator...\n');

// 1. Check SpeechSynthesis
console.log('📋 STEP 1: Check SpeechSynthesis');
const speechCheck = {
    'speechSynthesis available': 'speechSynthesis' in window,
    'speechSynthesis.speaking': window.speechSynthesis ? window.speechSynthesis.speaking : 'N/A',
    'speechSynthesis.pending': window.speechSynthesis ? window.speechSynthesis.pending : 'N/A',
    'speechSynthesis.paused': window.speechSynthesis ? window.speechSynthesis.paused : 'N/A'
};
console.table(speechCheck);

// 2. Check Voices
console.log('\n📋 STEP 2: Check Available Voices');
if ('speechSynthesis' in window) {
    const voices = window.speechSynthesis.getVoices();
    console.log('Total voices:', voices.length);
    
    const indonesianVoices = voices.filter(v => v.lang.startsWith('id-') || v.lang === 'id-ID');
    console.log('Indonesian voices:', indonesianVoices.length);
    if (indonesianVoices.length > 0) {
        console.log('Indonesian voice found:', indonesianVoices[0].name, indonesianVoices[0].lang);
    } else {
        console.warn('⚠️ TIDAK ADA VOICE INDONESIAN!');
        console.warn('💡 SOLUSI: Install voice Indonesian di Windows Settings');
    }
    
    // List semua voices
    console.log('\n📋 All voices:');
    voices.forEach((v, i) => {
        if (v.lang.startsWith('id-') || v.name.toLowerCase().includes('indonesia')) {
            console.log(`  [${i}] ${v.name} (${v.lang}) - ${v.default ? 'DEFAULT' : ''}`);
        }
    });
}

// 3. Test Speech dengan Voice Indonesian Eksplisit
console.log('\n📋 STEP 3: Test Speech dengan Voice Indonesian');
if ('speechSynthesis' in window) {
    const voices = window.speechSynthesis.getVoices();
    const indonesianVoices = voices.filter(v => v.lang.startsWith('id-') || v.lang === 'id-ID');
    
    if (indonesianVoices.length === 0) {
        console.error('❌ TIDAK ADA VOICE INDONESIAN!');
        console.error('💡 SOLUSI:');
        console.error('   1. Buka Windows Settings → Time & Language → Speech');
        console.error('   2. Install "Bahasa Indonesia" voice pack');
        console.error('   3. Reload halaman');
    } else {
        const testUtterance = new SpeechSynthesisUtterance('Test suara navigator belok kanan');
        testUtterance.lang = 'id-ID';
        testUtterance.voice = indonesianVoices[0]; // Pilih voice Indonesian secara eksplisit
        testUtterance.rate = 0.85;
        testUtterance.pitch = 1;
        testUtterance.volume = 1; // Volume maksimal
        
        console.log('✅ Voice dipilih:', indonesianVoices[0].name);
        console.log('✅ Volume:', testUtterance.volume);
        console.log('✅ Rate:', testUtterance.rate);
        
        let speechStarted = false;
        let speechEnded = false;
        let speechError = false;
        
        testUtterance.onstart = function() {
            speechStarted = true;
            console.log('✅✅✅ TEST SPEECH BERHASIL MULAI!');
            console.log('   speechSynthesis.speaking:', window.speechSynthesis.speaking);
        };
        
        testUtterance.onend = function() {
            speechEnded = true;
            console.log('✅ TEST SPEECH SELESAI');
            
            if (speechStarted && speechEnded && !speechError) {
                console.log('✅✅✅ SPEECH BERHASIL - Tapi jika tidak terdengar:');
                console.log('   → Check volume Windows tidak muted');
                console.log('   → Check volume browser tidak muted');
                console.log('   → Check speaker/headphone terhubung');
            }
        };
        
        testUtterance.onerror = function(event) {
            speechError = true;
            console.error('❌ TEST SPEECH ERROR:', event.error);
            console.error('   Error name:', event.error ? event.error.name : 'unknown');
            console.error('   Error message:', event.error ? event.error.message : 'unknown');
        };
        
        // Set hasUserInteraction
        if (typeof hasUserInteraction !== 'undefined') {
            hasUserInteraction = true;
        }
        
        console.log('🔊 Mencoba berbicara: "Test suara navigator belok kanan"');
        console.log('💡 PASTIKAN volume Windows dan browser TIDAK muted!');
        window.speechSynthesis.speak(testUtterance);
        
        // Monitor selama 3 detik
        let checkCount = 0;
        const monitorInterval = setInterval(() => {
            checkCount++;
            const isSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
            console.log(`[${checkCount}s] Speech synthesis speaking:`, isSpeaking);
            
            if (checkCount >= 3) {
                clearInterval(monitorInterval);
                if (!speechStarted) {
                    console.error('❌ Speech TIDAK MULAI!');
                    console.error('💡 SOLUSI:');
                    console.error('   1. Klik di halaman untuk memberikan user interaction');
                    console.error('   2. Reload halaman dan klik tombol "Berikan Akses Lokasi"');
                } else if (speechStarted && !speechError) {
                    console.log('✅ Speech berhasil dimulai');
                    if (!speechEnded) {
                        console.log('⏳ Speech masih berjalan...');
                    }
                }
            }
        }, 1000);
    }
} else {
    console.error('❌ SpeechSynthesis tidak tersedia di browser ini!');
}

// 4. Check Volume System (hanya info, tidak bisa diubah via JavaScript)
console.log('\n📋 STEP 4: Check Volume (Manual)');
console.log('💡 PERIKSA MANUAL:');
console.log('   1. Volume Windows tidak muted (icon speaker di taskbar)');
console.log('   2. Volume browser tidak muted (icon speaker di tab browser)');
console.log('   3. Speaker/headphone terhubung dan tidak muted');
console.log('   4. Test dengan aplikasi lain (YouTube, dll) apakah suara muncul');

console.log('\n✅ Debug script selesai!');
console.log('💡 Perhatikan output di atas untuk menemukan masalahnya.');


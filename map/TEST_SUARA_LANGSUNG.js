// ============================================
// TEST SUARA LANGSUNG - Untuk Debug TTS
// ============================================
// Script ini untuk test apakah TTS benar-benar bekerja
// Copy-paste script ini ke console browser

console.log('🧪 TEST SUARA LANGSUNG - Mulai...');

// Test 1: Cek speechSynthesis tersedia
if (!('speechSynthesis' in window)) {
    console.error('❌ speechSynthesis tidak tersedia!');
} else {
    console.log('✅ speechSynthesis tersedia');
}

// Test 2: Cek voices
const voices = window.speechSynthesis.getVoices();
console.log('📋 Total voices:', voices.length);
const indonesianVoices = voices.filter(v => v.lang.startsWith('id-') || v.lang === 'id-ID');
console.log('📋 Indonesian voices:', indonesianVoices.length);
if (indonesianVoices.length > 0) {
    console.log('✅ Voice Indonesian ditemukan:', indonesianVoices[0].name);
} else {
    console.error('❌ Voice Indonesian TIDAK ditemukan!');
    console.error('💡 Install voice Indonesian: Windows Settings → Time & Language → Speech');
}

// Test 3: Test speak langsung
console.log('🔊 Test speak langsung...');
const testText = 'Belok kanan sekarang';
const utterance = new SpeechSynthesisUtterance(testText);
utterance.lang = 'id-ID';
utterance.volume = 1;
utterance.rate = 0.85;
utterance.pitch = 1;

if (indonesianVoices.length > 0) {
    utterance.voice = indonesianVoices[0];
    console.log('✅ Voice Indonesian dipilih:', indonesianVoices[0].name);
}

utterance.onstart = function() {
    console.log('✅✅✅ SUARA MULAI!');
};

utterance.onend = function() {
    console.log('✅ SUARA SELESAI');
};

utterance.onerror = function(event) {
    console.error('❌ ERROR:', event.error);
    console.error('❌ Error details:', {
        error: event.error,
        type: event.type,
        charIndex: event.charIndex
    });
};

// Pastikan hasUserInteraction = true
if (typeof hasUserInteraction !== 'undefined') {
    hasUserInteraction = true;
    console.log('✅ hasUserInteraction = true');
} else {
    console.warn('⚠️ hasUserInteraction tidak didefinisikan');
}

// Test speak
console.log('🎯 Memanggil speechSynthesis.speak()...');
window.speechSynthesis.speak(utterance);
console.log('✅ speechSynthesis.speak() dipanggil');

// Check setelah 100ms
setTimeout(() => {
    const isSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    if (isSpeaking) {
        console.log('✅✅✅ Speech CONFIRMED STARTED - speechSynthesis.speaking =', window.speechSynthesis.speaking);
    } else {
        console.error('❌❌❌ Speech TIDAK dimulai!');
        console.error('💡 Kemungkinan masalah:');
        console.error('   1. Volume Windows/browser muted');
        console.error('   2. Voice Indonesian tidak terinstall');
        console.error('   3. Speaker/headphone tidak terhubung');
        console.error('   4. Browser memblokir speech synthesis');
        console.error('   5. User belum klik di halaman (user interaction)');
    }
}, 100);

// Test 4: Test dengan speakText function
setTimeout(() => {
    console.log('🧪 Test dengan speakText function...');
    if (typeof speakText === 'function') {
        console.log('✅ speakText function tersedia');
        hasUserInteraction = true;
        voiceDirectionsEnabled = true;
        speakText('Belok kiri sekarang', 'id-ID', true);
        console.log('✅ speakText dipanggil');
    } else {
        console.error('❌ speakText function TIDAK tersedia!');
    }
}, 2000);

console.log('🧪 TEST SUARA LANGSUNG - Selesai. Perhatikan console untuk hasil.');





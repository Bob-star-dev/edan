// ============================================
// SCRIPT UNTUK TEST SIMULASI NAVIGASI
// Copy-paste script ini ke Console Browser
// ============================================

// Script sederhana untuk test simulasi navigasi
// Jalankan satu per satu di console:

// 1. Set lokasi awal
testNavigation.setLocation(-6.2088, 106.8456, 10);

// 2. Tunggu 2 detik, lalu buat route
setTimeout(function() {
    testNavigation.startNavigation(-6.2148, 106.8556, 'Tujuan Test');
    
    // 3. Tunggu 5 detik, lalu mulai simulasi pergerakan
    setTimeout(function() {
        testNavigation.simulateRouteNavigation();
    }, 5000);
    
}, 2000);

// ============================================
// ATAU gunakan script ini untuk test langsung:
// ============================================

// Test lengkap otomatis (satu baris)
// testNavigation.testTurnMarkersAndAnnouncement();


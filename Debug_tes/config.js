// ============================================================================
// KONFIGURASI ESP32-CAM YOLO DETECTOR
// ============================================================================

const CONFIG = {
    // ESP32-CAM URL Configuration
    CAMERA: {
        MDNS_URL: "http://senavision.local/cam.jpg",
        IP_URL: "http://192.168.43.161/cam.jpg",  // IP address ESP32-CAM (akan auto-detect)
        TIMEOUT: 5000,  // 5 detik timeout
        RETRY_DELAY: 2000,  // Delay sebelum retry jika gagal (ms)
        FRAME_INTERVAL: 100,  // Interval antar frame (ms) - 10 FPS
    },
    
    // Firebase Configuration
    FIREBASE: {
        apiKey: "AIzaSyDrKWMsQvJgtgGRvE2FEHPTnpq7MrKLQTQ",
        authDomain: "senavision-id.firebaseapp.com",
        databaseURL: "https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "senavision-id",
        storageBucket: "senavision-id.firebasestorage.app",
        messagingSenderId: "1073477417711",
        appId: "1:1073477417711:web:681c33a68733fc2b35391a",
        measurementId: "G-7HJF81K0GE"
    },
    
    // Vibrator Configuration
    VIBRATOR: {
        DISTANCE_THRESHOLD: 1.5,  // Jarak dalam meter untuk trigger vibrate
        DEBOUNCE_TIME: 500,  // Waktu debounce dalam ms (mencegah spam request)
    },
    
    // Distance Calculation Configuration
    DISTANCE: {
        FOCAL_LENGTH: 450,  // Focal length dalam pixel (dikalibrasi untuk ESP32-CAM 800x600)
        CORRECTION_FACTOR: 0.45,  // Faktor koreksi untuk akurasi
    },
    
    // Object Sizes (dalam cm) - untuk perhitungan jarak
    OBJECT_SIZES: {
        "person": 160,  // Tinggi rata-rata orang dewasa Indonesia (cm)
        "bicycle": 100,
        "car": 150,
        "motorbike": 110,
        "bus": 300,
        "truck": 350,
        "bird": 30,
        "cat": 25,
        "dog": 50,
        "horse": 160,
        "sheep": 80,
        "cow": 140,
        "elephant": 300,
        "bear": 150,
        "zebra": 140,
        "giraffe": 500,
        "chair": 100,
        "sofa": 90,
        "bed": 50,
        "diningtable": 75,
        "tv": 60,
        "laptop": 3,
        "bottle": 25,
        "cup": 10,
        "bowl": 8,
    },
    
    // COCO-SSD Model Configuration
    MODEL: {
        MIN_SCORE: 0.3,  // Minimum confidence score untuk deteksi
    },
    
    // Debug Mode
    DEBUG: false,  // Set true untuk melihat log di console
};


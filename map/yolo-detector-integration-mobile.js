/**
 * YOLO Detector Integration untuk Mobile Device
 * Menggunakan TensorFlow.js dengan model yang dioptimalkan untuk mobile
 * Berjalan langsung di browser tanpa backend server
 */

(function() {
    'use strict';

    // Konfigurasi
    const DETECTION_INTERVAL = 300; // Deteksi setiap 300ms (~3 FPS untuk mobile)
    const VIBRATE_DISTANCE_THRESHOLD = 1.5; // Jarak dalam meter
    const CAMERA_URL_MDNS = "http://senavision.local/cam.jpg";
    const CAMERA_URL_IP = "http://192.168.1.97/cam.jpg";
    
    // State
    let isActive = false;
    let isInitialized = false;
    let model = null;
    let detectionInterval = null;
    let lastDetectionResult = null;
    let cameraUrl = null;
    let lastVibrateTimeLeft = 0;
    let lastVibrateTimeRight = 0;
    const VIBRATE_DEBOUNCE_TIME = 500; // 500ms debounce

    /**
     * Load TensorFlow.js dan model
     */
    async function loadTensorFlowModel() {
        try {
            // Load TensorFlow.js
            if (typeof tf === 'undefined') {
                await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.min.js');
            }

            // Load COCO-SSD model (optimized untuk mobile)
            if (typeof cocoSsd === 'undefined') {
                await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
            }

            // Load model - menggunakan MobileNet v2 untuk mobile optimization
            console.log('[YOLODetector Mobile] Loading COCO-SSD model (MobileNet v2 - optimized for mobile)...');
            model = await cocoSsd.load({
                base: 'mobilenet_v2' // MobileNet v2 lebih ringan dan cepat untuk mobile devices
            });
            
            console.log('[YOLODetector Mobile] ✅ Model loaded successfully');
            return true;
        } catch (error) {
            console.error('[YOLODetector Mobile] ❌ Failed to load model:', error);
            return false;
        }
    }

    /**
     * Helper: Load script dynamically
     */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Find camera URL (mDNS atau IP)
     */
    async function findCameraUrl() {
        // Try mDNS first
        try {
            const response = await fetch(CAMERA_URL_MDNS, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(2000) 
            });
            if (response.ok) {
                console.log('[YOLODetector Mobile] ✅ Camera found via mDNS');
                return CAMERA_URL_MDNS;
            }
        } catch (e) {
            console.log('[YOLODetector Mobile] mDNS failed, trying IP...');
        }

        // Try IP
        try {
            const response = await fetch(CAMERA_URL_IP, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(2000) 
            });
            if (response.ok) {
                console.log('[YOLODetector Mobile] ✅ Camera found via IP');
                return CAMERA_URL_IP;
            }
        } catch (e) {
            console.error('[YOLODetector Mobile] ❌ Camera not found');
        }

        return null;
    }

    /**
     * Load image from ESP32-CAM
     */
    async function loadImageFromCamera(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url + '?t=' + Date.now(); // Cache busting
        });
    }

    /**
     * Calculate distance (menggunakan tinggi objek)
     * COCO-SSD memberikan class name langsung, jadi kita bisa langsung pakai
     */
    function estimateDistance(bbox, imageWidth, imageHeight, className) {
        // Ukuran objek dalam pixel
        const pixelHeight = bbox[3] - bbox[1];
        
        // Ukuran rata-rata objek dalam cm (untuk estimasi)
        const objectSizes = {
            'person': 160,
            'bicycle': 100,
            'car': 150,
            'motorcycle': 110,
            'motorbike': 110,
            'bus': 300,
            'truck': 350,
            'bird': 30,
            'cat': 25,
            'dog': 50,
            'horse': 160,
            'sheep': 80,
            'cow': 140,
            'elephant': 300,
            'bear': 150,
            'zebra': 140,
            'giraffe': 500,
            'chair': 100,
            'couch': 90,
            'bed': 50,
            'dining table': 75,
            'tv': 60,
            'laptop': 3,
            'bottle': 25,
            'cup': 10,
            'bowl': 8
        };

        // Focal length estimasi untuk ESP32-CAM (800x600)
        const FOCAL_LENGTH = 450;
        const DISTANCE_CORRECTION_FACTOR = 0.45;

        // Cari ukuran objek berdasarkan class name
        const realHeightCm = objectSizes[className] || objectSizes[className.toLowerCase()] || 100; // Default 100cm

        if (pixelHeight === 0) return null;

        // Perhitungan jarak
        const distanceM = (realHeightCm * FOCAL_LENGTH) / (pixelHeight * 100) * DISTANCE_CORRECTION_FACTOR;
        
        return Math.round(distanceM * 10) / 10; // Round to 1 decimal
    }

    /**
     * Send vibrate signal
     */
    async function sendVibrateSignal(side) {
        const now = Date.now();
        
        // Debouncing
        if (side === 'left') {
            if (now - lastVibrateTimeLeft < VIBRATE_DEBOUNCE_TIME) return;
            lastVibrateTimeLeft = now;
        } else {
            if (now - lastVibrateTimeRight < VIBRATE_DEBOUNCE_TIME) return;
            lastVibrateTimeRight = now;
        }

        if (!cameraUrl) return;

        try {
            const baseUrl = cameraUrl.replace('/cam.jpg', '');
            const endpoint = side === 'left' ? '/left' : '/right';
            const vibrateUrl = baseUrl + endpoint;
            
            await fetch(vibrateUrl, { 
                method: 'GET',
                signal: AbortSignal.timeout(1000) 
            });
            
            console.log(`[YOLODetector Mobile] ⚠️ Vibrate ${side.toUpperCase()} signal sent`);
        } catch (error) {
            console.warn(`[YOLODetector Mobile] Failed to send vibrate signal:`, error);
        }
    }

    /**
     * Run detection on image
     */
    async function runDetection() {
        if (!isActive || !model || !cameraUrl) return;

        try {
            // Load image from ESP32-CAM
            const img = await loadImageFromCamera(cameraUrl);
            
            // Run detection
            const predictions = await model.detect(img);
            
            // Process results
            const detectedObjects = [];
            const objectsLeft = [];
            const objectsRight = [];
            let closestDistance = null;

            const imgWidth = img.width;
            const imgHeight = img.height;

            predictions.forEach(prediction => {
                const [x, y, width, height] = prediction.bbox;
                const centerX = x + width / 2;
                const side = centerX < imgWidth / 2 ? 'left' : 'right';
                
                // Estimate distance menggunakan class name dari COCO-SSD
                const distance = estimateDistance(
                    [x, y, x + width, y + height],
                    imgWidth,
                    imgHeight,
                    prediction.class
                );

                const objData = {
                    label: prediction.class,
                    confidence: Math.round(prediction.score * 100) / 100,
                    distance: distance,
                    side: side,
                    bbox: {
                        x: Math.round(x),
                        y: Math.round(y),
                        w: Math.round(width),
                        h: Math.round(height)
                    }
                };

                detectedObjects.push(objData);

                // Check if too close
                if (distance !== null && distance < VIBRATE_DISTANCE_THRESHOLD) {
                    if (side === 'left') {
                        objectsLeft.push(distance);
                    } else {
                        objectsRight.push(distance);
                    }

                    if (closestDistance === null || distance < closestDistance) {
                        closestDistance = distance;
                    }
                }
            });

            // Update last detection result
            lastDetectionResult = {
                objects: detectedObjects,
                timestamp: Date.now(),
                status: 'running',
                closest_distance: closestDistance,
                objects_too_close: {
                    left: objectsLeft.length > 0,
                    right: objectsRight.length > 0,
                    count_left: objectsLeft.length,
                    count_right: objectsRight.length
                }
            };

            // Send vibrate signals
            if (closestDistance !== null && closestDistance < VIBRATE_DISTANCE_THRESHOLD) {
                if (objectsLeft.length > 0) {
                    await sendVibrateSignal('left');
                }
                if (objectsRight.length > 0) {
                    await sendVibrateSignal('right');
                }

                // Audio warning via SpeechCoordinator
                if (typeof window.SpeechCoordinator !== 'undefined') {
                    const side = objectsLeft.length > 0 ? 'kiri' : 'kanan';
                    const message = `Peringatan: Objek terdeteksi di ${side} pada jarak ${closestDistance.toFixed(1)} meter`;
                    window.SpeechCoordinator.queueModeDetectorAnnouncement(message, 'warning');
                }
            }

        } catch (error) {
            console.error('[YOLODetector Mobile] Detection error:', error);
            lastDetectionResult = {
                objects: [],
                timestamp: Date.now(),
                status: 'error',
                error: error.message
            };
        }
    }

    /**
     * Start detection loop
     */
    function startDetectionLoop() {
        if (detectionInterval) {
            clearInterval(detectionInterval);
        }

        detectionInterval = setInterval(() => {
            runDetection();
        }, DETECTION_INTERVAL);
    }

    /**
     * Stop detection loop
     */
    function stopDetectionLoop() {
        if (detectionInterval) {
            clearInterval(detectionInterval);
            detectionInterval = null;
        }
    }

    /**
     * YOLO Detector API (compatible dengan versi backend)
     */
    window.YOLODetector = {
        /**
         * Initialize detector
         */
        init: async function() {
            if (isInitialized) {
                console.log('[YOLODetector Mobile] Already initialized');
                return true;
            }

            console.log('[YOLODetector Mobile] Initializing...');
            
            // Load model
            const modelLoaded = await loadTensorFlowModel();
            if (!modelLoaded) {
                return false;
            }

            // Find camera
            cameraUrl = await findCameraUrl();
            if (!cameraUrl) {
                console.warn('[YOLODetector Mobile] Camera not found, but initialization continues');
            }

            isInitialized = true;
            console.log('[YOLODetector Mobile] ✅ Initialized successfully');
            return true;
        },

        /**
         * Activate detector
         */
        activate: async function() {
            if (!isInitialized) {
                console.warn('[YOLODetector Mobile] Not initialized. Calling init() first...');
                const initSuccess = await this.init();
                if (!initSuccess) {
                    return false;
                }
            }

            if (isActive) {
                console.log('[YOLODetector Mobile] Already active');
                return true;
            }

            console.log('[YOLODetector Mobile] Activating...');

            // Re-check camera if needed
            if (!cameraUrl) {
                cameraUrl = await findCameraUrl();
                if (!cameraUrl) {
                    console.error('[YOLODetector Mobile] ❌ Camera not available');
                    return false;
                }
            }

            isActive = true;
            startDetectionLoop();
            
            console.log('[YOLODetector Mobile] ✅ Activated successfully');
            return true;
        },

        /**
         * Deactivate detector
         */
        deactivate: function() {
            if (!isActive) {
                console.log('[YOLODetector Mobile] Already inactive');
                return Promise.resolve(true);
            }

            console.log('[YOLODetector Mobile] Deactivating...');
            
            isActive = false;
            stopDetectionLoop();
            
            console.log('[YOLODetector Mobile] ✅ Deactivated successfully');
            return Promise.resolve(true);
        },

        /**
         * Get current state
         */
        getState: function() {
            return {
                isInitialized: isInitialized,
                isActive: isActive,
                connection: {
                    connected: cameraUrl !== null,
                    url: cameraUrl,
                    method: cameraUrl ? (cameraUrl.includes('senavision.local') ? 'mDNS' : 'IP') : null
                },
                lastDetection: lastDetectionResult
            };
        },

        /**
         * Get detailed status
         */
        getDetailedStatus: async function() {
            return {
                initialized: isInitialized,
                active: isActive,
                backendRunning: false, // No backend for mobile version
                camera: {
                    connected: cameraUrl !== null,
                    url: cameraUrl
                },
                connection: {
                    connected: cameraUrl !== null,
                    method: cameraUrl ? (cameraUrl.includes('senavision.local') ? 'mDNS' : 'IP') : null,
                    url: cameraUrl,
                    error: cameraUrl ? null : 'Camera not found'
                },
                lastDetection: lastDetectionResult
            };
        },

        /**
         * Check ESP32-CAM connection
         */
        checkESP32Connection: async function() {
            const url = await findCameraUrl();
            cameraUrl = url;
            
            return {
                connected: url !== null,
                method: url ? (url.includes('senavision.local') ? 'mDNS' : 'IP') : null,
                url: url,
                error: url ? null : 'Cannot connect to ESP32-CAM'
            };
        }
    };

    console.log('[YOLODetector Mobile] Module loaded. Optimized for mobile devices.');

})();


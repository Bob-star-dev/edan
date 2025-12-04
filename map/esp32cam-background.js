// ============================================================================
// ESP32-CAM BACKGROUND DETECTOR (No UI - Background Only)
// ============================================================================

(function() {
    'use strict';
    
    // Konfigurasi
    const CONFIG = {
        CAMERA: {
            MDNS_URL: "http://senavision.local/cam.jpg",
            IP_URL: "http://192.168.1.97/cam.jpg",
            TIMEOUT: 5000,
            RETRY_DELAY: 2000,
            FRAME_INTERVAL: 100,
        },
        VIBRATOR: {
            DISTANCE_THRESHOLD: 1.5,
            DEBOUNCE_TIME: 500,
            TIMEOUT: 5000,
            RETRY_COUNT: 2,
        },
        DISTANCE: {
            FOCAL_LENGTH: 450,
            CORRECTION_FACTOR: 0.45,
        },
        OBJECT_SIZES: {
            "person": 160, "bicycle": 100, "car": 150, "motorbike": 110,
            "bus": 300, "truck": 350, "bird": 30, "cat": 25, "dog": 50,
            "horse": 160, "sheep": 80, "cow": 140, "elephant": 300,
            "bear": 150, "zebra": 140, "giraffe": 500, "chair": 100,
            "sofa": 90, "bed": 50, "diningtable": 75, "tv": 60,
            "laptop": 3, "bottle": 25, "cup": 10, "bowl": 8,
        },
        MODEL: {
            MIN_SCORE: 0.3,
        },
        DEBUG: true, // Enable debug untuk logging vibrate dan status
    };
    
    // State
    let model = null;
    let canvas = null;
    let ctx = null;
    let isRunning = false;
    let cameraUrl = null;
    let lastVibrateTimeLeft = 0;
    let lastVibrateTimeRight = 0;
    let cameraConnected = false;
    let connectionStatusCallback = null;
    
    // Create hidden canvas
    function createCanvas() {
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'esp32cam-bg-canvas';
            canvas.style.display = 'none';
            canvas.style.position = 'absolute';
            canvas.style.top = '-9999px';
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);
            ctx = canvas.getContext('2d');
        }
    }
    
    function log(msg) {
        if (CONFIG.DEBUG) {
            console.log(`[ESP32CAM BG] ${msg}`);
        }
    }
    
    function error(msg) {
        console.error(`[ESP32CAM BG] ${msg}`);
    }
    
    // Update camera connection status
    function updateCameraStatus(connected) {
        const wasConnected = cameraConnected;
        cameraConnected = connected;
        
        if (wasConnected !== connected) {
            if (connected) {
                console.log(`[ESP32CAM] ✅ Camera connected: ${cameraUrl || 'Unknown URL'}`);
            } else {
                console.warn(`[ESP32CAM] ⚠️ Camera disconnected`);
            }
            
            // Call callback if set
            if (connectionStatusCallback && typeof connectionStatusCallback === 'function') {
                try {
                    connectionStatusCallback(connected, cameraUrl);
                } catch (e) {
                    console.error('[ESP32CAM] Error in connection status callback:', e);
                }
            }
        }
    }
    
    // Load model
    async function loadModel() {
        try {
            if (!model) {
                log('Loading COCO-SSD model...');
                model = await cocoSsd.load();
                log('Model loaded');
            }
            return true;
        } catch (e) {
            error(`Failed to load model: ${e.message}`);
            return false;
        }
    }
    
    // Find camera
    async function findCamera() {
        const testUrl = async (url) => {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const response = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                    cache: 'no-cache',
                    mode: 'cors',
                    credentials: 'omit'
                });
                clearTimeout(timeout);
                if (response.ok) {
                    const ct = response.headers.get('content-type');
                    if (ct && ct.startsWith('image/')) return true;
                }
            } catch (e) {
                if (e.name === 'TypeError' || e.message.includes('CORS')) {
                    try {
                        await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-cache' });
                        return true;
                    } catch {}
                }
            }
            return false;
        };
        
        console.log('[ESP32CAM] 🔍 Searching for camera...');
        updateCameraStatus(false);
        
        if (await testUrl(CONFIG.CAMERA.MDNS_URL)) {
            cameraUrl = CONFIG.CAMERA.MDNS_URL;
            console.log(`[ESP32CAM] ✅ Camera found (mDNS): ${cameraUrl}`);
            updateCameraStatus(true);
            return true;
        }
        
        if (await testUrl(CONFIG.CAMERA.IP_URL)) {
            cameraUrl = CONFIG.CAMERA.IP_URL;
            console.log(`[ESP32CAM] ✅ Camera found (IP): ${cameraUrl}`);
            updateCameraStatus(true);
            return true;
        }
        
        console.error('[ESP32CAM] ❌ Camera not found - both mDNS and IP failed');
        updateCameraStatus(false);
        return false;
    }
    
    // Fetch image
    async function fetchImage() {
        if (!cameraUrl) {
            updateCameraStatus(false);
            return null;
        }
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.CAMERA.TIMEOUT);
            const response = await fetch(cameraUrl + '?t=' + Date.now(), {
                cache: 'no-cache',
                signal: controller.signal,
                mode: 'cors',
                credentials: 'omit'
            });
            clearTimeout(timeout);
            
            if (!response.ok) {
                updateCameraStatus(false);
                throw new Error(`HTTP ${response.status}`);
            }
            
            updateCameraStatus(true);
            
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            return new Promise((resolve, reject) => {
                const t = setTimeout(() => {
                    URL.revokeObjectURL(url);
                    updateCameraStatus(false);
                    reject(new Error('Timeout'));
                }, CONFIG.CAMERA.TIMEOUT);
                
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    clearTimeout(t);
                    URL.revokeObjectURL(url);
                    resolve(img);
                };
                img.onerror = () => {
                    clearTimeout(t);
                    URL.revokeObjectURL(url);
                    updateCameraStatus(false);
                    reject(new Error('Load failed'));
                };
                img.src = url;
            });
        } catch (e) {
            updateCameraStatus(false);
            log(`Fetch failed: ${e.message}`);
            return null;
        }
    }
    
    // Calculate distance
    function calculateDistance(pixelHeight, objectName) {
        const size = CONFIG.OBJECT_SIZES[objectName];
        if (!size || pixelHeight === 0) return null;
        
        let dist = (size * CONFIG.DISTANCE.FOCAL_LENGTH) / (pixelHeight * 100);
        const correction = objectName === "person" 
            ? CONFIG.DISTANCE.CORRECTION_FACTOR 
            : CONFIG.DISTANCE.CORRECTION_FACTOR * 0.95;
        dist = dist * correction;
        
        return Math.round(dist * 10) / 10;
    }
    
    // Send vibrate signal to ESP32-CAM
    async function sendVibrate(side) {
        const now = Date.now();
        if (side === 'left') {
            if (now - lastVibrateTimeLeft < CONFIG.VIBRATOR.DEBOUNCE_TIME) {
                log(`Vibrate ${side} skipped (debounce)`);
                return false;
            }
            lastVibrateTimeLeft = now;
        } else {
            if (now - lastVibrateTimeRight < CONFIG.VIBRATOR.DEBOUNCE_TIME) {
                log(`Vibrate ${side} skipped (debounce)`);
                return false;
            }
            lastVibrateTimeRight = now;
        }
        
        if (!cameraUrl) {
            console.warn(`[ESP32CAM] ⚠️ Cannot send vibrate ${side} - camera not connected`);
            return false;
        }
        
        const baseUrl = cameraUrl.replace('/cam.jpg', '');
        const vibrateUrl = `${baseUrl}/${side}`;
        
        console.log(`[ESP32CAM] 📳 Sending vibrate signal to ${side.toUpperCase()}...`);
        console.log(`[ESP32CAM] 📡 URL: ${vibrateUrl}`);
        
        for (let i = 0; i < CONFIG.VIBRATOR.RETRY_COUNT; i++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), CONFIG.VIBRATOR.TIMEOUT);
                const response = await fetch(vibrateUrl, {
                    signal: controller.signal,
                    cache: 'no-cache'
                });
                clearTimeout(timeout);
                if (response.ok) {
                    const text = await response.text().catch(() => 'OK');
                    console.log(`[ESP32CAM] ✅ Vibrate signal sent to ${side.toUpperCase()} (${vibrateUrl})`);
                    console.log(`[ESP32CAM] 📳 Response: ${text}`);
                    return true;
                } else {
                    console.warn(`[ESP32CAM] ⚠️ Vibrate ${side} returned status ${response.status}`);
                }
            } catch (e) {
                if (i < CONFIG.VIBRATOR.RETRY_COUNT - 1) {
                    await new Promise(r => setTimeout(r, 100));
                    continue;
                }
                console.error(`[ESP32CAM] ❌ Failed to send vibrate signal to ${side}: ${e.message}`);
            }
        }
        return false;
    }
    
    // Detect objects
    async function detectObjects(img) {
        if (!model || !canvas) return [];
        
        try {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            
            const predictions = await model.detect(canvas);
            return predictions.filter(p => p.score >= CONFIG.MODEL.MIN_SCORE);
        } catch (e) {
            if (e.message.includes('tainted')) {
                error('Canvas tainted - CORS issue');
            } else {
                error(`Detection error: ${e.message}`);
            }
            return [];
        }
    }
    
    // Process frame
    async function processFrame() {
        if (!isRunning) return;
        
        try {
            const img = await fetchImage();
            if (!img) {
                setTimeout(processFrame, CONFIG.CAMERA.RETRY_DELAY);
                return;
            }
            
            const predictions = await detectObjects(img);
            
            let tooClose = false;
            let closest = null;
            const left = [];
            const right = [];
            
            for (const pred of predictions) {
                const dist = calculateDistance(pred.bbox[3], pred.class);
                if (dist !== null) {
                    if (dist < CONFIG.VIBRATOR.DISTANCE_THRESHOLD) {
                        tooClose = true;
                        if (closest === null || dist < closest) closest = dist;
                        
                        const centerX = pred.bbox[0] + pred.bbox[2] / 2;
                        if (centerX < img.width / 2) {
                            left.push({ class: pred.class, dist });
                        } else {
                            right.push({ class: pred.class, dist });
                        }
                        log(`${pred.class}: ${dist}m [TOO CLOSE!]`);
                    } else {
                        log(`${pred.class}: ${dist}m`);
                    }
                }
            }
            
            if (tooClose) {
                if (left.length > 0) await sendVibrate('left');
                if (right.length > 0) await sendVibrate('right');
                const sides = [];
                if (left.length > 0) sides.push(`LEFT (${left.length} objek)`);
                if (right.length > 0) sides.push(`RIGHT (${right.length} objek)`);
                console.warn(`[ESP32CAM] ⚠️ WARNING: Object detected at ${closest}m (threshold: ${CONFIG.VIBRATOR.DISTANCE_THRESHOLD}m) [${sides.join(' & ')}]`);
            }
        } catch (e) {
            error(`Frame error: ${e.message}`);
        }
        
        if (isRunning) {
            setTimeout(processFrame, CONFIG.CAMERA.FRAME_INTERVAL);
        }
    }
    
    // API
    window.ESP32CAMDetector = {
        init: function() {
            return new Promise(async (resolve) => {
                createCanvas();
                const loaded = await loadModel();
                resolve(loaded);
            });
        },
        
        activate: function() {
            return new Promise(async (resolve) => {
                if (isRunning) {
                    resolve(true);
                    return;
                }
                
                log('Starting...');
                createCanvas();
                
                if (!model) {
                    const loaded = await loadModel();
                    if (!loaded) {
                        error('Model load failed');
                        resolve(false);
                        return;
                    }
                }
                
                let found = false;
                for (let i = 0; i < 3; i++) {
                    if (i > 0) {
                        log(`Retry ${i + 1}/3...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    found = await findCamera();
                    if (found) break;
                }
                
                if (!found) {
                    error('Camera not found');
                    resolve(false);
                    return;
                }
                
                isRunning = true;
                processFrame();
                log('Started');
                resolve(true);
            });
        },
        
        deactivate: function() {
            return new Promise((resolve) => {
                log('Stopping...');
                isRunning = false;
                resolve(true);
            });
        },
        
        getState: function() {
            return {
                isActive: isRunning,
                isInitialized: model !== null,
                cameraUrl: cameraUrl,
                cameraConnected: cameraConnected
            };
        },
        
        // Set callback for connection status updates
        setConnectionStatusCallback: function(callback) {
            connectionStatusCallback = callback;
            // Immediately call with current status
            if (callback && typeof callback === 'function') {
                try {
                    callback(cameraConnected, cameraUrl);
                } catch (e) {
                    console.error('[ESP32CAM] Error in connection status callback:', e);
                }
            }
        },
        
        // Get current connection status
        getConnectionStatus: function() {
            return {
                connected: cameraConnected,
                url: cameraUrl
            };
        }
    };
    
    // Backward compatibility
    window.YOLODetector = window.ESP32CAMDetector;
    
    log('ESP32-CAM Background Detector loaded');
})();


// ============================================================================
// ESP32-CAM YOLO BACKGROUND DETECTOR
// ============================================================================

class ESP32CAMDetector {
    constructor() {
        this.model = null;
        this.canvas = document.getElementById('hiddenCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.isRunning = false;
        this.frameCount = 0;
        this.lastFrameTime = Date.now();
        this.fps = 0;
        
        // Vibrator debouncing
        this.lastVibrateTimeLeft = 0;
        this.lastVibrateTimeRight = 0;
        
        // Camera URL
        this.cameraUrl = null;
        
        // Status elements
        this.statusText = document.getElementById('statusText');
        this.cameraStatus = document.getElementById('cameraStatus');
        this.modelStatus = document.getElementById('modelStatus');
        this.fpsElement = document.getElementById('fps');
        this.objectCountElement = document.getElementById('objectCount');
        this.firebaseStatus = document.getElementById('firebaseStatus');
        
        this.log('ESP32-CAM YOLO Detector initialized');
    }
    
    log(message) {
        if (CONFIG.DEBUG) {
            console.log(`[Detector] ${message}`);
        }
    }
    
    error(message) {
        console.error(`[Detector] ${message}`);
    }
    
    updateStatus(text, type = 'info') {
        if (this.statusText) {
            this.statusText.textContent = text;
            this.statusText.className = type;
        }
    }
    
    updateCameraStatus(online) {
        if (this.cameraStatus) {
            this.cameraStatus.textContent = online ? 'Online' : 'Offline';
            this.cameraStatus.className = online ? 'status-online' : 'status-offline';
        }
    }
    
    updateModelStatus(loaded) {
        if (this.modelStatus) {
            this.modelStatus.textContent = loaded ? 'Loaded' : 'Loading...';
            this.modelStatus.className = loaded ? 'status-online' : 'status-offline';
        }
    }
    
    updateFPS(fps) {
        if (this.fpsElement) {
            this.fpsElement.textContent = fps.toFixed(1);
        }
    }
    
    updateObjectCount(count) {
        if (this.objectCountElement) {
            this.objectCountElement.textContent = count;
        }
    }
    
    updateFirebaseStatus(ready) {
        if (this.firebaseStatus) {
            this.firebaseStatus.textContent = ready ? 'Ready' : 'Loading...';
            this.firebaseStatus.className = ready ? 'status-online' : 'status-offline';
        }
    }
    
    // Load COCO-SSD model
    async loadModel() {
        try {
            this.log('Loading COCO-SSD model...');
            this.updateModelStatus(false);
            
            this.model = await cocoSsd.load();
            
            this.log('Model loaded successfully');
            this.updateModelStatus(true);
            return true;
        } catch (error) {
            this.error(`Failed to load model: ${error.message}`);
            this.updateModelStatus(false);
            return false;
        }
    }
    
    // Find camera URL (try mDNS first, then IP)
    async findCameraUrl() {
        this.log('Finding camera URL...');
        
        // Helper function untuk test URL dengan Image element (lebih reliable)
        const testCameraUrl = async (url, timeout = 3000) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';  // Coba dengan CORS
                
                let resolved = false;
                const timeoutId = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        img.onload = null;
                        img.onerror = null;
                        resolve(false);
                    }
                }, timeout);
                
                img.onload = () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeoutId);
                        resolve(true);
                    }
                };
                
                img.onerror = () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeoutId);
                        // Jika CORS error, coba tanpa crossOrigin
                        const imgNoCors = new Image();
                        let noCorsResolved = false;
                        const noCorsTimeout = setTimeout(() => {
                            if (!noCorsResolved) {
                                noCorsResolved = true;
                                resolve(false);
                            }
                        }, timeout);
                        
                        imgNoCors.onload = () => {
                            if (!noCorsResolved) {
                                noCorsResolved = true;
                                clearTimeout(noCorsTimeout);
                                resolve(true);  // Image loaded, even without CORS
                            }
                        };
                        
                        imgNoCors.onerror = () => {
                            if (!noCorsResolved) {
                                noCorsResolved = true;
                                clearTimeout(noCorsTimeout);
                                resolve(false);
                            }
                        };
                        
                        imgNoCors.src = url + '?t=' + Date.now();
                    }
                };
                
                img.src = url + '?t=' + Date.now();
            });
        };
        
        // Try mDNS first
        this.log('Trying mDNS URL...');
        const mdnWorks = await testCameraUrl(CONFIG.CAMERA.MDNS_URL, 3000);
        if (mdnWorks) {
            this.log('mDNS URL works');
            this.cameraUrl = CONFIG.CAMERA.MDNS_URL;
            return true;
        }
        
        this.log('mDNS failed, trying IP addresses...');
        
        // Try configured IP first (highest priority)
        const commonIPs = [];
        if (CONFIG.CAMERA.IP_URL) {
            const configuredIP = CONFIG.CAMERA.IP_URL.replace('http://', '').replace('/cam.jpg', '');
            commonIPs.push(configuredIP); // Add configured IP first
        }
        
        // Try common IP ranges for hotspot HP
        commonIPs.push(
            '192.168.43.161',  // Current ESP32CAM IP (from Serial Monitor)
            '192.168.43.97',   // Android hotspot (common)
            '192.168.43.1',    // Gateway (sometimes camera)
            '172.20.10.97',    // iPhone hotspot
            '192.168.137.97',  // Some Android
            '192.168.1.97'     // Old router (backward compatibility)
        );
        
        // Remove duplicates
        const uniqueIPs = [...new Set(commonIPs)];
        
        // Try each IP
        for (const ip of uniqueIPs) {
            const testIPUrl = `http://${ip}/cam.jpg`;
            this.log(`Trying IP: ${ip}...`);
            const ipWorks = await testCameraUrl(testIPUrl, 3000);
            if (ipWorks) {
                this.log(`✅ IP URL works: ${testIPUrl}`);
                this.cameraUrl = testIPUrl;
                return true;
            }
        }
        
        this.error('❌ All connection methods failed');
        this.error('Please check:');
        this.error('1. ESP32-CAM is powered on and connected to WiFi');
        this.error('2. ESP32-CAM is on the same network');
        this.error('3. Check Serial Monitor ESP32-CAM for actual IP address');
        return false;
    }
    
    // Fetch image from ESP32-CAM
    async fetchCameraImage() {
        if (!this.cameraUrl) {
            return null;
        }
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.CAMERA.TIMEOUT);
            
            // Fetch dengan CORS mode (setelah ESP32-CAM ditambahkan CORS headers)
            const response = await fetch(this.cameraUrl + '?t=' + Date.now(), {
                cache: 'no-cache',
                signal: controller.signal,
                mode: 'cors',
                credentials: 'omit'
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    URL.revokeObjectURL(imageUrl);
                    reject(new Error('Image load timeout'));
                }, CONFIG.CAMERA.TIMEOUT);
                
                const img = new Image();
                img.crossOrigin = 'anonymous';  // Penting untuk CORS dan canvas
                img.onload = () => {
                    clearTimeout(timeout);
                    URL.revokeObjectURL(imageUrl);
                    resolve(img);
                };
                img.onerror = () => {
                    clearTimeout(timeout);
                    URL.revokeObjectURL(imageUrl);
                    reject(new Error('Failed to load image'));
                };
                img.src = imageUrl;
            });
        } catch (error) {
            this.log(`Failed to fetch camera image: ${error.message}`);
            return null;
        }
    }
    
    // Calculate distance from object
    calculateDistance(pixelHeight, objectName) {
        const objectSize = CONFIG.OBJECT_SIZES[objectName];
        
        if (!objectSize) {
            return null;
        }
        
        if (pixelHeight === 0) {
            return null;
        }
        
        // Perhitungan dasar jarak
        // distance = (real_height * focal_length) / (pixel_height * 100)
        let distanceM = (objectSize * CONFIG.DISTANCE.FOCAL_LENGTH) / (pixelHeight * 100);
        
        // Terapkan faktor koreksi
        let correction = CONFIG.DISTANCE.CORRECTION_FACTOR;
        if (objectName === "person") {
            correction = CONFIG.DISTANCE.CORRECTION_FACTOR;
        } else {
            correction = CONFIG.DISTANCE.CORRECTION_FACTOR * 0.95;
        }
        
        distanceM = distanceM * correction;
        
        return Math.round(distanceM * 10) / 10; // Round to 1 decimal
    }
    
    // Send vibrate signal to Firebase (for ESP32-C3)
    async sendVibrateSignal(side) {
        const currentTime = Date.now();
        
        // Debouncing
        if (side === 'left') {
            if (currentTime - this.lastVibrateTimeLeft < CONFIG.VIBRATOR.DEBOUNCE_TIME) {
                return;
            }
            this.lastVibrateTimeLeft = currentTime;
        } else {
            if (currentTime - this.lastVibrateTimeRight < CONFIG.VIBRATOR.DEBOUNCE_TIME) {
                return;
            }
            this.lastVibrateTimeRight = currentTime;
        }
        
        // Check if Firebase is initialized
        if (!window.firebaseDatabase) {
            this.error('Firebase not initialized yet');
            return false;
        }
        
        try {
            // Import Firebase Database functions
            const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
            
            const vibrateRef = ref(window.firebaseDatabase, '/vibrate/signal');
            const vibrateData = {
                side: side,
                active: true,
                timestamp: Date.now()
            };
            
            // Send to Firebase
            await set(vibrateRef, vibrateData);
            this.log(`✅ Vibrate signal sent to Firebase: ${side.toUpperCase()}`);
            
            // Auto-clear after 1 second
            setTimeout(async () => {
                try {
                    await set(vibrateRef, {
                        ...vibrateData,
                        active: false
                    });
                } catch (e) {
                    // Ignore clear errors
                }
            }, 1000);
            
            return true;
            } catch (error) {
            this.error(`Failed to send vibrate signal to Firebase: ${error.message}`);
                    return false;
        }
    }
    
    // Detect objects in image
    async detectObjects(image) {
        if (!this.model) {
            return [];
        }
        
        try {
            // Set canvas size
            this.canvas.width = image.width;
            this.canvas.height = image.height;
            
            // Clear canvas first
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Draw image to canvas
            this.ctx.drawImage(image, 0, 0);
            
            // Run detection
            const predictions = await this.model.detect(this.canvas);
            
            // Filter by minimum score
            const filteredPredictions = predictions.filter(
                pred => pred.score >= CONFIG.MODEL.MIN_SCORE
            );
            
            return filteredPredictions;
        } catch (error) {
            // Jika error "tainted canvas", berarti CORS belum di-setup di ESP32-CAM
            if (error.message.includes('tainted') || error.message.includes('Tainted')) {
                this.error('Canvas tainted - ESP32-CAM needs CORS headers. Please upload updated ESP32CAM_Capture.ino');
                this.error('The image loaded but cannot be processed due to CORS policy.');
            } else {
                this.error(`Detection error: ${error.message}`);
            }
            return [];
        }
    }
    
    // Process frame
    async processFrame() {
        if (!this.isRunning) {
            return;
        }
        
        try {
            // Fetch image
            const image = await this.fetchCameraImage();
            
            if (!image) {
                this.updateCameraStatus(false);
                setTimeout(() => this.processFrame(), CONFIG.CAMERA.RETRY_DELAY);
                return;
            }
            
            this.updateCameraStatus(true);
            
            // Detect objects
            const predictions = await this.detectObjects(image);
            
            // Update object count
            this.updateObjectCount(predictions.length);
            
            // Process each detection
            let objectTooClose = false;
            let closestDistance = null;
            const objectsLeft = [];
            const objectsRight = [];
            
            const imageWidth = image.width;
            const imageHeight = image.height;
            
            for (const pred of predictions) {
                const className = pred.class;
                const bbox = pred.bbox;
                
                // Calculate pixel height
                const pixelHeight = bbox[3]; // height
                const pixelWidth = bbox[2]; // width
                
                // Calculate distance
                const distance = this.calculateDistance(pixelHeight, className);
                
                if (distance !== null) {
                    // Check if too close
                    if (distance < CONFIG.VIBRATOR.DISTANCE_THRESHOLD) {
                        objectTooClose = true;
                        
                        if (closestDistance === null || distance < closestDistance) {
                            closestDistance = distance;
                        }
                        
                        // Determine side (left or right)
                        const centerX = bbox[0] + bbox[2] / 2;
                        if (centerX < imageWidth / 2) {
                            objectsLeft.push({ className, distance });
                        } else {
                            objectsRight.push({ className, distance });
                        }
                        
                        this.log(`${className}: ${distance}m [TOO CLOSE!]`);
                    } else {
                        this.log(`${className}: ${distance}m`);
                    }
                } else {
                    this.log(`${className}: distance unknown`);
                }
            }
            
            // Send vibrate signals if needed
            if (objectTooClose) {
                if (objectsLeft.length > 0) {
                    await this.sendVibrateSignal('left');
                }
                
                if (objectsRight.length > 0) {
                    await this.sendVibrateSignal('right');
                }
                
                const sideInfo = [];
                if (objectsLeft.length > 0) {
                    sideInfo.push(`LEFT (${objectsLeft.length} objek)`);
                }
                if (objectsRight.length > 0) {
                    sideInfo.push(`RIGHT (${objectsRight.length} objek)`);
                }
                
                this.log(`⚠ WARNING: Object detected at ${closestDistance}m (threshold: ${CONFIG.VIBRATOR.DISTANCE_THRESHOLD}m) [${sideInfo.join(' & ')}]`);
            }
            
            // Calculate FPS
            const currentTime = Date.now();
            const elapsed = currentTime - this.lastFrameTime;
            this.lastFrameTime = currentTime;
            this.fps = 1000 / elapsed;
            this.updateFPS(this.fps);
            
            this.frameCount++;
            
        } catch (error) {
            this.error(`Frame processing error: ${error.message}`);
        }
        
        // Schedule next frame
        if (this.isRunning) {
            setTimeout(() => this.processFrame(), CONFIG.CAMERA.FRAME_INTERVAL);
        }
    }
    
    // Start detection
    async start() {
        if (this.isRunning) {
            this.log('Already running');
            return;
        }
        
        this.log('Starting detector...');
        this.updateStatus('Initializing...');
        
        // Wait for Firebase to be ready
        let firebaseReady = false;
        let waitCount = 0;
        while (!firebaseReady && waitCount < 50) { // Wait max 5 seconds
            if (window.firebaseDatabase) {
                firebaseReady = true;
                this.log('Firebase ready');
            } else {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
        }
        
        if (!firebaseReady) {
            this.updateStatus('Firebase not ready', 'error');
            this.updateFirebaseStatus(false);
            this.error('Firebase not initialized. Please refresh the page.');
            return;
        }
        
        this.updateFirebaseStatus(true);
        
        // Load model
        const modelLoaded = await this.loadModel();
        if (!modelLoaded) {
            this.updateStatus('Failed to load model', 'error');
            this.updateModelStatus(false);
            return;
        }
        
        // Find camera (dengan retry)
        let cameraFound = false;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (!cameraFound && retryCount < maxRetries) {
            if (retryCount > 0) {
                this.log(`Retrying to find camera (attempt ${retryCount + 1}/${maxRetries})...`);
                this.updateStatus(`Finding camera (${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
            }
            
            cameraFound = await this.findCameraUrl();
            retryCount++;
        }
        
        if (!cameraFound) {
            this.updateStatus('Camera not found', 'error');
            this.updateCameraStatus(false);
            this.error('Cannot connect to ESP32-CAM. Please check:');
            this.error('1. ESP32-CAM is powered on');
            this.error('2. ESP32-CAM is connected to WiFi');
            this.error('3. IP address in config.js is correct: ' + CONFIG.CAMERA.IP_URL);
            this.error('4. Try accessing camera in browser: ' + CONFIG.CAMERA.IP_URL);
            return;
        }
        
        this.log(`Camera found: ${this.cameraUrl}`);
        this.updateStatus('Running...', 'success');
        this.updateCameraStatus(true);
        
        // Start processing
        this.isRunning = true;
        this.lastFrameTime = Date.now();
        this.processFrame();
        
        this.log('Detector started');
    }
    
    // Stop detection
    stop() {
        this.log('Stopping detector...');
        this.isRunning = false;
        this.updateStatus('Stopped');
    }
}

// ============================================================================
// INITIALIZE AND START
// ============================================================================

let detector = null;

// Start when page loads
window.addEventListener('DOMContentLoaded', async () => {
    detector = new ESP32CAMDetector();
    await detector.start();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (detector) {
        detector.stop();
    }
});


/**
 * YOLO Detector Integration untuk Aplikasi Map
 * Mengintegrasikan deteksi objek YOLO dengan aplikasi navigasi
 * Berjalan di background saat navigasi aktif
 */

(function() {
    'use strict';

    // Konfigurasi
    const BACKEND_URL = 'http://127.0.0.1:5000';
    const STATUS_CHECK_INTERVAL = 1000; // Check status setiap 1 detik
    const DETECTION_UPDATE_INTERVAL = 500; // Update deteksi setiap 0.5 detik

    // State
    let isActive = false;
    let isInitialized = false;
    let statusCheckInterval = null;
    let detectionUpdateInterval = null;
    let lastDetectionResult = null;
    let connectionStatus = {
        connected: false,
        method: null,
        url: null,
        error: null
    };

    /**
     * YOLO Detector API
     */
    window.YOLODetector = {
        /**
         * Initialize detector
         */
        init: function() {
            return new Promise((resolve, reject) => {
                if (isInitialized) {
                    console.log('[YOLODetector] Already initialized');
                    resolve(true);
                    return;
                }

                console.log('[YOLODetector] Initializing...');
                
                // Check backend connection
                this.checkBackendConnection()
                    .then(connected => {
                        if (connected) {
                            isInitialized = true;
                            console.log('[YOLODetector] ✅ Initialized successfully');
                            resolve(true);
                        } else {
                            console.error('[YOLODetector] ❌ Backend server not available');
                            reject(new Error('Backend server not available'));
                        }
                    })
                    .catch(error => {
                        console.error('[YOLODetector] ❌ Initialization failed:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Activate detector (start detection)
         */
        activate: function() {
            return new Promise((resolve, reject) => {
                if (!isInitialized) {
                    console.warn('[YOLODetector] Not initialized. Calling init() first...');
                    this.init()
                        .then(() => this.activate().then(resolve).catch(reject))
                        .catch(reject);
                    return;
                }

                if (isActive) {
                    console.log('[YOLODetector] Already active');
                    resolve(true);
                    return;
                }

                console.log('[YOLODetector] Activating...');
                
                fetch(`${BACKEND_URL}/api/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        isActive = true;
                        console.log('[YOLODetector] ✅ Activated successfully');
                        console.log('[YOLODetector] Camera URL:', data.camera_url);
                        
                        // Start status checking
                        this.startStatusChecking();
                        
                        // Start detection updates
                        this.startDetectionUpdates();
                        
                        resolve(true);
                    } else {
                        console.error('[YOLODetector] ❌ Activation failed:', data.error);
                        reject(new Error(data.error || 'Activation failed'));
                    }
                })
                .catch(error => {
                    console.error('[YOLODetector] ❌ Activation error:', error);
                    reject(error);
                });
            });
        },

        /**
         * Deactivate detector (stop detection)
         */
        deactivate: function() {
            return new Promise((resolve, reject) => {
                if (!isActive) {
                    console.log('[YOLODetector] Already inactive');
                    resolve(true);
                    return;
                }

                console.log('[YOLODetector] Deactivating...');
                
                fetch(`${BACKEND_URL}/api/stop`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        isActive = false;
                        console.log('[YOLODetector] ✅ Deactivated successfully');
                        
                        // Stop status checking
                        this.stopStatusChecking();
                        
                        // Stop detection updates
                        this.stopDetectionUpdates();
                        
                        resolve(true);
                    } else {
                        console.error('[YOLODetector] ❌ Deactivation failed:', data.error);
                        reject(new Error('Deactivation failed'));
                    }
                })
                .catch(error => {
                    console.error('[YOLODetector] ❌ Deactivation error:', error);
                    // Still mark as inactive even if request fails
                    isActive = false;
                    this.stopStatusChecking();
                    this.stopDetectionUpdates();
                    reject(error);
                });
            });
        },

        /**
         * Get current state
         */
        getState: function() {
            return {
                isInitialized: isInitialized,
                isActive: isActive,
                connection: connectionStatus,
                lastDetection: lastDetectionResult
            };
        },

        /**
         * Get detailed status
         */
        getDetailedStatus: function() {
            return new Promise((resolve, reject) => {
                fetch(`${BACKEND_URL}/api/status`)
                    .then(response => response.json())
                    .then(data => {
                        const status = {
                            initialized: isInitialized,
                            active: isActive,
                            backendRunning: data.running,
                            camera: {
                                connected: data.camera_url !== null,
                                url: data.camera_url
                            },
                            connection: connectionStatus,
                            lastDetection: data.last_result || lastDetectionResult
                        };
                        resolve(status);
                    })
                    .catch(error => {
                        console.error('[YOLODetector] Error getting detailed status:', error);
                        reject(error);
                    });
            });
        },

        /**
         * Check ESP32-CAM connection
         */
        checkESP32Connection: function() {
            return new Promise((resolve, reject) => {
                fetch(`${BACKEND_URL}/api/check-camera`)
                    .then(response => response.json())
                    .then(data => {
                        connectionStatus = {
                            connected: data.connected,
                            method: data.url ? (data.url.includes('senavision.local') ? 'mDNS' : 'IP') : null,
                            url: data.url,
                            error: data.connected ? null : 'Cannot connect to ESP32-CAM'
                        };
                        resolve(connectionStatus);
                    })
                    .catch(error => {
                        console.error('[YOLODetector] Error checking ESP32 connection:', error);
                        connectionStatus.error = error.message;
                        reject(error);
                    });
            });
        },

        /**
         * Check backend connection
         */
        checkBackendConnection: function() {
            return new Promise((resolve, reject) => {
                fetch(`${BACKEND_URL}/api/status`)
                    .then(response => {
                        if (response.ok) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    })
                    .catch(error => {
                        console.warn('[YOLODetector] Backend server not available:', error);
                        resolve(false);
                    });
            });
        },

        /**
         * Start status checking loop
         */
        startStatusChecking: function() {
            if (statusCheckInterval) {
                clearInterval(statusCheckInterval);
            }

            statusCheckInterval = setInterval(() => {
                this.checkESP32Connection().catch(() => {
                    // Ignore errors in background checking
                });
            }, STATUS_CHECK_INTERVAL);
        },

        /**
         * Stop status checking loop
         */
        stopStatusChecking: function() {
            if (statusCheckInterval) {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
            }
        },

        /**
         * Start detection updates loop
         */
        startDetectionUpdates: function() {
            if (detectionUpdateInterval) {
                clearInterval(detectionUpdateInterval);
            }

            detectionUpdateInterval = setInterval(() => {
                if (!isActive) return;

                fetch(`${BACKEND_URL}/api/detections`)
                    .then(response => response.json())
                    .then(data => {
                        lastDetectionResult = data;
                        
                        // Handle detections (misalnya untuk audio feedback)
                        if (data.status === 'running' && data.objects && data.objects.length > 0) {
                            const tooClose = data.objects_too_close;
                            if (tooClose && (tooClose.left || tooClose.right)) {
                                // Ada objek terlalu dekat - bisa trigger audio warning
                                this.handleCloseObjectWarning(data);
                            }
                        }
                    })
                    .catch(error => {
                        // Ignore errors in background updates
                        console.warn('[YOLODetector] Error updating detections:', error);
                    });
            }, DETECTION_UPDATE_INTERVAL);
        },

        /**
         * Stop detection updates loop
         */
        stopDetectionUpdates: function() {
            if (detectionUpdateInterval) {
                clearInterval(detectionUpdateInterval);
                detectionUpdateInterval = null;
            }
        },

        /**
         * Handle close object warning
         */
        handleCloseObjectWarning: function(detectionData) {
            // Koordinasi dengan SpeechCoordinator untuk audio feedback
            if (typeof window.SpeechCoordinator !== 'undefined') {
                const closest = detectionData.closest_distance;
                const side = detectionData.objects_too_close.left ? 'kiri' : 'kanan';
                
                // Queue warning message
                const message = `Peringatan: Objek terdeteksi di ${side} pada jarak ${closest.toFixed(1)} meter`;
                
                window.SpeechCoordinator.queueModeDetectorAnnouncement(message, 'warning');
            }
        }
    };

    // Auto-initialize saat halaman dimuat
    console.log('[YOLODetector] Module loaded. Call YOLODetector.init() to initialize.');

})();


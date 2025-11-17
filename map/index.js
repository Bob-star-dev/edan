// Init Leaflet Map - Start with a default location
// Expanded zoom levels for global navigation
const map = L.map('map', {
    center: [3.59, 98.67],
    zoom: 3, // Start with wider view (was 15)
    minZoom: 2, // Allow zoom out to see entire world
    maxZoom: 19 // Maximum detail level
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    minZoom: 2,
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Variables to track current user location
let currentUserPosition = null;
let currentAccuracy = null;
let hasPermission = false;
let locationInterval = null;
let isFirstLocationUpdate = true; // Track if this is the first location update

// CRITICAL: Track the BEST GPS location (highest accuracy)
// This prevents default/cached locations from overwriting accurate GPS data
let bestGPSLocation = null; // Store { lat, lng, accuracy }
const MAX_ACCEPTABLE_ACCURACY = 500; // Only accept GPS locations with accuracy < 500m

// Configuration for location update interval
// Options: 500ms (very fast), 1000ms (1s - realtime), 2000ms (2s), 3000ms (3s), 5000ms (5s)
// Note: Faster updates = more battery/data usage
const LOCATION_UPDATE_INTERVAL = 1000; // 1 second for realtime tracking

// Destination point (changeable via voice command)
// Format: [latitude, longitude] - e.g., Medan, Indonesia
let latLngB = null; // No default destination - user must set destination first
let destinationMarker = null; // No destination marker until user sets a destination

// Route control - will be created after we get user's location
let route = null;

// Speech Recognition Variables
let recognition = null;
let isListening = false;
let finalTranscript = '';
let hasUserInteraction = false; // Track if user has interacted (required for microphone access)

// Voice Directions Variables - AUTO ENABLED for blind users
let voiceDirectionsEnabled = true; // Automatically enabled for accessibility
let lastAnnouncedDirection = '';
let isSpeaking = false;
let announcementQueue = [];
// Track navigator speech state to prevent synthesized voice from being re-captured by microphone
let isNavigatorSpeaking = false;
let navigatorSpeechDepth = 0;
let suppressRecognitionUntil = 0;
let lastNavigatorIgnoreLog = 0;
let pendingAutoMicResume = false;
let pendingAutoMicResumeDelay = 1800;
let lastRouteSummarySpeech = '';
let lastRouteFirstInstructionSpeech = '';
let currentDestinationName = '';
let lastVoiceCommand = '';
let suppressMicActivationSpeech = false;

// Global Speech Coordinator - Koordinasi suara antara navigasi dan mode detector
// Prioritas: Collision Warning (mode detector) > Navigation Directions > Object Announcements (mode detector)
// Mode: Kedua suara bisa berbicara bergantian dengan cepat setelah navigasi dimulai
window.SpeechCoordinator = {
    // State tracking
    isNavigationSpeaking: false,
    isModeDetectorSpeaking: false,
    isModeDetectorWarning: false, // Collision warning (highest priority)
    isNavigating: false, // Flag untuk menandakan navigasi sedang aktif
    modeDetectorQueue: [], // Queue untuk mode detector announcements
    navigationQueue: [], // Queue untuk navigation announcements
    
    // Check if navigation is currently speaking
    isNavigationActive: function() {
        return this.isNavigationSpeaking || (typeof isSpeaking !== 'undefined' && isSpeaking);
    },
    
    // Check if mode detector is currently speaking
    isModeDetectorActive: function() {
        return this.isModeDetectorSpeaking || this.isModeDetectorWarning;
    },
    
    // Check if any speech is active
    isAnySpeechActive: function() {
        return this.isNavigationActive() || this.isModeDetectorActive();
    },
    
    // Set navigation active state
    setNavigating: function(active) {
        this.isNavigating = active;
        if (active) {
            console.log('[SpeechCoordinator] 🧭 Navigation mode activated - both voices can speak');
        } else {
            console.log('[SpeechCoordinator] 🧭 Navigation mode deactivated');
        }
    },
    
    // Request permission to speak (returns true if allowed)
    // priority: 'critical' (collision warning), 'high' (navigation), 'normal' (object announcement)
    requestSpeak: function(priority = 'normal') {
        // Critical priority (collision warning) - always allowed, cancel others
        if (priority === 'critical') {
            if (this.isNavigationActive()) {
                console.log('[SpeechCoordinator] 🚨 Critical warning - canceling navigation speech');
                if (typeof window.speechSynthesis !== 'undefined') {
                    window.speechSynthesis.cancel();
                }
                this.isNavigationSpeaking = false;
                if (typeof isSpeaking !== 'undefined') {
                    isSpeaking = false;
                }
            }
            this.isModeDetectorWarning = true;
            return true;
        }
        
        // High priority (navigation directions) - wait only for critical warnings
        if (priority === 'high') {
            // Only wait for critical warnings, navigation can interrupt normal mode detector speech
            if (this.isModeDetectorWarning) {
                // Check if warning is actually still active (not just stale state)
                const actuallyWarning = (typeof window.speechSynthesis !== 'undefined') && 
                                       window.speechSynthesis.speaking && 
                                       this.isModeDetectorWarning;
                if (actuallyWarning) {
                    console.log('[SpeechCoordinator] ⏸️ Navigation speech delayed - mode detector warning active');
                    return false; // Wait for critical warning to finish
                } else {
                    // Warning state is stale - reset it
                    console.log('[SpeechCoordinator] 🔄 Warning state is stale - resetting');
                    this.isModeDetectorWarning = false;
                }
            }
            // Navigation can always speak (can interrupt normal mode detector speech)
            // Cancel any normal mode detector speech if needed
            if (this.isModeDetectorSpeaking && !this.isModeDetectorWarning) {
                // Check if mode detector is actually speaking
                const actuallySpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                        window.speechSynthesis.speaking;
                if (actuallySpeaking) {
                    console.log('[SpeechCoordinator] 🔄 Navigation interrupting normal mode detector speech');
                    if (typeof window.speechSynthesis !== 'undefined') {
                        window.speechSynthesis.cancel();
                    }
                }
                this.isModeDetectorSpeaking = false;
            }
            this.isNavigationSpeaking = true;
            console.log('[SpeechCoordinator] ✅ Navigation speech allowed');
            return true;
        }
        
        // Normal priority (object announcements) - can speak immediately if navigation not speaking
        // During navigation, mode detector can speak right after navigation finishes
        if (priority === 'normal') {
            // Check if navigation is actually speaking (not just state flag)
            const speechSynthesisSpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                           window.speechSynthesis.speaking;
            
            // If speechSynthesis is not speaking, navigation definitely not speaking
            // Reset stale state flags and allow mode detector to speak immediately
            if (!speechSynthesisSpeaking) {
                if (this.isNavigationSpeaking) {
                    console.log('[SpeechCoordinator] 🔄 Navigation state is stale (no speech active) - resetting');
                    this.isNavigationSpeaking = false;
                    if (typeof isSpeaking !== 'undefined') {
                        isSpeaking = false;
                    }
                }
                // If no speech is active, allow mode detector to speak immediately
                if (!this.isModeDetectorWarning) {
                    this.isModeDetectorSpeaking = true;
                    console.log('[SpeechCoordinator] ✅ Mode detector speech allowed immediately (no active speech)');
                    return true;
                } else {
                    // Check if warning is actually active
                    if (!speechSynthesisSpeaking) {
                        console.log('[SpeechCoordinator] 🔄 Warning state is stale - resetting');
                        this.isModeDetectorWarning = false;
                        this.isModeDetectorSpeaking = true;
                        console.log('[SpeechCoordinator] ✅ Mode detector speech allowed (warning state reset)');
                        return true;
                    }
                }
            }
            
            // If speechSynthesis is speaking, check if it's navigation or mode detector
            if (speechSynthesisSpeaking) {
                // If navigation is speaking, mode detector can still speak (will queue and speak after)
                // But only if it's not a critical warning
                if (this.isNavigationActive() && !this.isModeDetectorWarning) {
                    // During navigation, allow mode detector to interrupt after a short delay
                    // This allows both voices to speak in quick succession
                    console.log('[SpeechCoordinator] ⏸️ Mode detector speech queued - navigation speaking, will speak after');
                    return false; // Queue it, will be processed when navigation ends
                }
                // If warning is active, wait for it
                if (this.isModeDetectorWarning) {
                    console.log('[SpeechCoordinator] ⏸️ Mode detector speech delayed - warning active');
                    return false; // Wait for warning to finish
                }
                // If mode detector is already speaking, don't allow another
                if (this.isModeDetectorSpeaking) {
                    console.log('[SpeechCoordinator] ⏸️ Mode detector already speaking');
                    return false;
                }
            }
            
            // Allow mode detector to speak
            this.isModeDetectorSpeaking = true;
            console.log('[SpeechCoordinator] ✅ Mode detector speech allowed');
            return true;
        }
        
        return false;
    },
    
    // Mark speech as finished
    markSpeechEnd: function(priority = 'normal') {
        if (priority === 'critical') {
            this.isModeDetectorWarning = false;
            console.log('[SpeechCoordinator] ✅ Critical warning ended');
            // After critical warning, allow queued speech to proceed
            this.processQueues();
        } else if (priority === 'high') {
            this.isNavigationSpeaking = false;
            if (typeof isSpeaking !== 'undefined') {
                isSpeaking = false;
            }
            console.log('[SpeechCoordinator] ✅ Navigation speech ended');
            // After navigation speech ends, immediately allow mode detector to speak if queued
            // This allows both voices to speak in quick succession during navigation
            if (this.isNavigating) {
                setTimeout(() => {
                    this.processQueues();
                }, 100); // Small delay to ensure speechSynthesis is ready
            }
        } else if (priority === 'normal') {
            this.isModeDetectorSpeaking = false;
            console.log('[SpeechCoordinator] ✅ Mode detector speech ended');
            // After mode detector speech ends, allow navigation to speak if queued
            if (this.isNavigating) {
                setTimeout(() => {
                    this.processQueues();
                }, 100);
            }
        }
    },
    
    // Process queued announcements
    processQueues: function() {
        const speechSynthesisSpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                       window.speechSynthesis.speaking;
        
        // If no speech is active, process queues
        if (!speechSynthesisSpeaking) {
            // Reset all states
            this.isNavigationSpeaking = false;
            this.isModeDetectorSpeaking = false;
            if (typeof isSpeaking !== 'undefined') {
                isSpeaking = false;
            }
            
            // Process mode detector queue first (if any)
            if (this.modeDetectorQueue.length > 0) {
                const item = this.modeDetectorQueue.shift();
                console.log('[SpeechCoordinator] 🔄 Processing queued mode detector speech');
                // Trigger mode detector to speak (will be handled by mode detector's retry logic)
                if (typeof window.ModeDetector !== 'undefined' && typeof window.ModeDetector.triggerQueuedSpeech === 'function') {
                    window.ModeDetector.triggerQueuedSpeech();
                }
            }
            
            // Process navigation queue (if any)
            if (this.navigationQueue.length > 0) {
                const item = this.navigationQueue.shift();
                console.log('[SpeechCoordinator] 🔄 Processing queued navigation speech');
                // Navigation will handle its own queue
            }
        }
    },
    
    // Cancel all speech
    cancelAll: function() {
        if (typeof window.speechSynthesis !== 'undefined') {
            window.speechSynthesis.cancel();
        }
        this.isNavigationSpeaking = false;
        this.isModeDetectorSpeaking = false;
        this.isModeDetectorWarning = false;
        if (typeof isSpeaking !== 'undefined') {
            isSpeaking = false;
        }
        console.log('[SpeechCoordinator] 🛑 All speech canceled');
    },
    
    // Reset all states (useful for debugging or recovery)
    reset: function() {
        this.isNavigationSpeaking = false;
        this.isModeDetectorSpeaking = false;
        this.isModeDetectorWarning = false;
        if (typeof isSpeaking !== 'undefined') {
            isSpeaking = false;
        }
        console.log('[SpeechCoordinator] 🔄 All states reset');
    },
    
    // Get current state for debugging
    getState: function() {
        return {
            isNavigationSpeaking: this.isNavigationSpeaking,
            isModeDetectorSpeaking: this.isModeDetectorSpeaking,
            isModeDetectorWarning: this.isModeDetectorWarning,
            isNavigationActive: this.isNavigationActive(),
            isModeDetectorActive: this.isModeDetectorActive(),
            speechSynthesisSpeaking: (typeof window.speechSynthesis !== 'undefined') ? window.speechSynthesis.speaking : false
        };
    }
};

// Navigation tracking variables
let currentRouteData = null; // Store current route details
let currentLegIndex = 0; // Track which instruction leg we're on
let lastAnnouncedInstruction = null; // Prevent duplicate announcements
let isNavigating = false; // Track if user is actively navigating
let announcedInstructions = []; // Track all instructions that have been announced
let shouldAnnounceRoute = false; // Flag to control when route should be announced
let pendingRouteAnnouncement = null; // Store pending route announcement data (routeId, startName, endName)

// Firebase / Firestore integration state
let firebaseDb = null; // Firestore db instance when available
let deviceId = null; // Stable per-device id (used when no auth)

// Debug Console Variables
let debugAutoScroll = true; // Auto-scroll to bottom when new logs are added
let debugLogs = []; // Store logs for filtering/searching if needed
const MAX_DEBUG_LOGS = 500; // Maximum number of log entries to keep

// Debug Console Functions
// Toggle debug panel visibility - similar to status panel toggle
// Updated to work with new sidebar navbar
function toggleDebugPanel() {
    // Use new sidebar navbar instead
    const navbar = document.getElementById('sideNavbar');
    if (navbar) {
        switchNavbarTab('debug');
        toggleSideNavbar();
    } else {
        // Fallback to old panel if navbar doesn't exist
        const debugPanel = document.getElementById('debugPanel');
        const toggleBtn = document.getElementById('debugToggleBtn');
        
        if (debugPanel && toggleBtn) {
            const isActive = debugPanel.classList.contains('active');
            
            if (isActive) {
                debugPanel.classList.remove('active');
                toggleBtn.textContent = '🐛 Debug';
            } else {
                debugPanel.classList.add('active');
                toggleBtn.textContent = '✖️ Tutup';
            }
        }
    }
}

// Clear all debug logs from the panel
function clearDebugLogs() {
    const debugLogsContainer = document.getElementById('debugLogs');
    if (debugLogsContainer) {
        debugLogsContainer.innerHTML = '<p class="debug-placeholder">Console logs will appear here...</p>';
        debugLogs = []; // Clear stored logs
    }
}

// Toggle auto-scroll feature
function toggleAutoScroll() {
    debugAutoScroll = !debugAutoScroll;
    const autoScrollBtn = document.getElementById('toggleAutoScrollBtn');
    if (autoScrollBtn) {
        if (debugAutoScroll) {
            autoScrollBtn.classList.add('active');
            autoScrollBtn.textContent = '📜 Auto';
        } else {
            autoScrollBtn.classList.remove('active');
            autoScrollBtn.textContent = '📜 Manual';
        }
    }
}

// Add log entry to debug panel
// This function formats and displays console logs in the debug panel
function addDebugLog(type, args) {
    const debugLogsContainer = document.getElementById('debugLogs');
    if (!debugLogsContainer) return;
    
    // Remove placeholder if it exists
    const placeholder = debugLogsContainer.querySelector('.debug-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
    
    // Create timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3
    });
    
    // Create log entry element
    const logEntry = document.createElement('div');
    logEntry.className = `debug-log-entry ${type}`;
    
    // Format log message - handle multiple arguments
    let message = '';
    try {
        // Convert arguments to string, handling objects
        message = Array.from(args).map(arg => {
            if (typeof arg === 'object' && arg !== null) {
                return JSON.stringify(arg, null, 2);
            }
            return String(arg);
        }).join(' ');
    } catch (e) {
        message = String(args);
    }
    
    // Create HTML structure
    logEntry.innerHTML = `
        <span class="debug-log-time">[${timeStr}]</span>
        <span class="debug-log-message">${escapeHtml(message)}</span>
    `;
    
    // Add to container
    debugLogsContainer.appendChild(logEntry);
    
    // Store log (for potential filtering/searching)
    debugLogs.push({ type, message, time: now });
    
    // Limit number of logs to prevent memory issues
    if (debugLogs.length > MAX_DEBUG_LOGS) {
        const firstEntry = debugLogsContainer.firstElementChild;
        if (firstEntry && firstEntry.classList.contains('debug-log-entry')) {
            firstEntry.remove();
        }
        debugLogs.shift();
    }
    
    // Auto-scroll to bottom if enabled
    if (debugAutoScroll) {
        debugLogsContainer.scrollTop = debugLogsContainer.scrollHeight;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Intercept console methods and display in debug panel
// This captures all console.log, console.warn, console.error, etc. calls
(function() {
    // Store original console methods
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;
    
    // Override console.log
    console.log = function(...args) {
        originalLog.apply(console, args); // Call original
        addDebugLog('log', args);
    };
    
    // Override console.info
    console.info = function(...args) {
        originalInfo.apply(console, args); // Call original
        addDebugLog('info', args);
    };
    
    // Override console.warn
    console.warn = function(...args) {
        originalWarn.apply(console, args); // Call original
        addDebugLog('warn', args);
    };
    
    // Override console.error
    console.error = function(...args) {
        originalError.apply(console, args); // Call original
        addDebugLog('error', args);
    };
    
    // Override console.debug
    console.debug = function(...args) {
        originalDebug.apply(console, args); // Call original
        addDebugLog('log', args); // Use 'log' style for debug
    };
    
    // Add initial log message
    setTimeout(() => {
        console.log('🐛 Debug console initialized. All console logs will appear here.');
    }, 100);
})();

// Mobile UI Toggle Function - Toggle status panel visibility on mobile
// This function is called when the mobile toggle button is clicked
// It shows/hides the status panel on mobile devices
// Updated to work with new sidebar navbar
function toggleStatusPanel() {
    // Use new sidebar navbar instead
    const navbar = document.getElementById('sideNavbar');
    if (navbar) {
        switchNavbarTab('status');
        toggleSideNavbar();
    } else {
        // Fallback to old panel if navbar doesn't exist
        const statusPanel = document.getElementById('statusPanel');
        const toggleBtn = document.getElementById('mobileToggleBtn');
        
        if (statusPanel && toggleBtn) {
            const isActive = statusPanel.classList.contains('active');
            
            if (isActive) {
                statusPanel.classList.remove('active');
                toggleBtn.textContent = '📍 Info Lokasi';
                toggleBtn.style.background = '#3b49df';
            } else {
                statusPanel.classList.add('active');
                toggleBtn.textContent = '✖️ Tutup';
                toggleBtn.style.background = '#dc3545';
            }
        }
    }
}

// Close status panel when clicking outside of it on mobile
// This improves user experience by allowing users to close panel by clicking map
document.addEventListener('DOMContentLoaded', function() {
    // Add click event listener to close panel when clicking on map (mobile only)
    const mapContainer = document.getElementById('map');
    const statusPanel = document.getElementById('statusPanel');
    const toggleBtn = document.getElementById('mobileToggleBtn');
    const debugPanel = document.getElementById('debugPanel');
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    
    // Initialize debug panel auto-scroll button state
    const autoScrollBtn = document.getElementById('toggleAutoScrollBtn');
    if (autoScrollBtn && debugAutoScroll) {
        autoScrollBtn.classList.add('active');
    }
    
    // Function to handle window resize - show panel on desktop, hide button
    function handleResize() {
        const closeBtn = document.getElementById('closePanelBtn');
        const closeDebugBtn = document.getElementById('closeDebugBtn');
        
        if (window.innerWidth > 768) {
            // Desktop: Show panels, hide toggle buttons, hide close buttons
            if (statusPanel) {
                statusPanel.classList.add('active');
                statusPanel.style.display = 'block';
            }
            if (debugPanel) {
                // Debug panel stays hidden by default on desktop unless manually opened
                // User can toggle it using the debug button
            }
            if (toggleBtn) {
                toggleBtn.style.display = 'none';
            }
            if (debugToggleBtn) {
                // Debug button always visible on desktop for easy access
                debugToggleBtn.style.display = 'block';
            }
            if (closeBtn) {
                closeBtn.style.display = 'none';
            }
            if (closeDebugBtn) {
                closeDebugBtn.style.display = 'none';
            }
        } else {
            // Mobile: Hide panels by default, show toggle buttons, show close buttons
            if (statusPanel) {
                statusPanel.classList.remove('active');
            }
            if (debugPanel) {
                debugPanel.classList.remove('active');
            }
            if (toggleBtn) {
                toggleBtn.style.display = 'block';
            }
            if (debugToggleBtn) {
                debugToggleBtn.style.display = 'block';
            }
            if (closeBtn) {
                closeBtn.style.display = 'flex';
            }
            if (closeDebugBtn) {
                closeDebugBtn.style.display = 'flex';
            }
        }
    }
    
    // Handle initial load
    handleResize();
    
    // Handle window resize events
    window.addEventListener('resize', handleResize);
    
    // Only add click-outside behavior on mobile devices
    if (mapContainer && statusPanel && toggleBtn) {
        mapContainer.addEventListener('click', function(e) {
            // Only apply this on mobile
            if (window.innerWidth <= 768) {
                // Handle status panel
                if (statusPanel.classList.contains('active')) {
                    const clickedElement = e.target;
                    const isClickOnPanel = statusPanel.contains(clickedElement);
                    const isClickOnButton = toggleBtn.contains(clickedElement);
                    
                    // Close panel if clicking on map (not panel or button)
                    if (!isClickOnPanel && !isClickOnButton) {
                        statusPanel.classList.remove('active');
                        if (toggleBtn) {
                            toggleBtn.textContent = '📍 Info Lokasi';
                            toggleBtn.style.background = '#3b49df';
                        }
                    }
                }
                
                // Handle debug panel
                if (debugPanel && debugPanel.classList.contains('active')) {
                    const clickedElement = e.target;
                    const isClickOnDebugPanel = debugPanel.contains(clickedElement);
                    const isClickOnDebugButton = debugToggleBtn && debugToggleBtn.contains(clickedElement);
                    
                    // Close debug panel if clicking on map (not panel or button)
                    if (!isClickOnDebugPanel && !isClickOnDebugButton) {
                        debugPanel.classList.remove('active');
                        if (debugToggleBtn) {
                            debugToggleBtn.textContent = '🐛 Debug';
                        }
                    }
                }
            }
        });
    }
});

// Function to handle when user's location is found
function onLocationFound(e) {
    // Hide permission popup when location is found
    hidePermissionPopup();
    
    // Mark permission granted but don't trigger welcome guide here
    // Welcome guide will be triggered by button click interaction
    if (!hasPermission) {
        hasPermission = true;
        console.log('✅ Location permission granted');
    }
    
    // CRITICAL: Verifikasi lokasi GPS sebelum digunakan
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const accuracy = e.accuracy || 50000; // Default jika tidak ada accuracy
    
    // Deteksi lokasi default/cached yang tidak akurat
    const isNearSurakarta = lat > -7.6 && lat < -7.5 && lng > 110.8 && lng < 110.9;
    const isLowAccuracy = accuracy > 10000; // Accuracy > 10km biasanya tidak akurat
    const isUnacceptableAccuracy = accuracy > MAX_ACCEPTABLE_ACCURACY; // Accuracy > 500m tidak diterima
    
    // CRITICAL: BLOCK lokasi default/cached - jangan update marker jika lokasi tidak akurat
    if (isNearSurakarta && isLowAccuracy) {
        console.warn('⚠️ WARNING: Possible default/cached location detected - IGNORING!');
        console.warn('📍 Lat:', lat.toFixed(6), 'Lng:', lng.toFixed(6), 'Accuracy:', accuracy.toFixed(0), 'm');
        console.warn('💡 Make sure GPS is enabled on your device and allow location access');
        
        // CRITICAL: Jangan update marker jika lokasi tidak akurat dan sudah ada lokasi yang lebih baik
        if (bestGPSLocation && bestGPSLocation.accuracy < accuracy) {
            console.log('🔒 Keeping existing accurate GPS location - ignoring default/cached location');
            return; // BLOCK update - jangan lanjutkan jika lokasi lebih buruk
        }
    } else if (isUnacceptableAccuracy) {
        console.warn('⚠️ WARNING: GPS accuracy too low (' + accuracy.toFixed(0) + 'm) - checking if better than existing...');
        
        // Hanya update jika tidak ada lokasi yang lebih baik, atau lokasi baru lebih akurat
        if (bestGPSLocation && bestGPSLocation.accuracy < accuracy) {
            console.log('🔒 Keeping existing accurate GPS location - ignoring low accuracy location');
            return; // BLOCK update
        }
    } else {
        console.log('✅ GPS location received:', lat.toFixed(6), lng.toFixed(6), 'Accuracy:', accuracy.toFixed(0), 'm');
        
        // Simpan lokasi GPS terbaik (akurasi tertinggi)
        if (!bestGPSLocation || accuracy < bestGPSLocation.accuracy) {
            bestGPSLocation = { lat: lat, lng: lng, accuracy: accuracy };
            console.log('✅ Best GPS location updated:', lat.toFixed(6), lng.toFixed(6), 'Accuracy:', accuracy.toFixed(0), 'm');
        }
    }
    
    // Update status display - REAL-TIME UPDATE setiap user bergerak
    const statusEl = document.getElementById('status');
    const coordsEl = document.getElementById('coordinates');
    const accuracyEl = document.getElementById('accuracy');
    
    // Update status dengan timestamp untuk menunjukkan update real-time
    if (statusEl) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (isNearSurakarta && isLowAccuracy) {
            statusEl.textContent = `⚠️ Location may not be accurate: ${timeStr}`;
        } else {
            statusEl.textContent = `✅ Location updated: ${timeStr}`;
        }
    }
    
    // Update koordinat secara real-time setiap user bergerak
    if (coordsEl) {
        coordsEl.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
        // Tambahkan highlight effect untuk menunjukkan update
        coordsEl.style.transition = 'background-color 0.3s';
        coordsEl.style.backgroundColor = '#e8f5e9';
        setTimeout(() => {
            if (coordsEl) coordsEl.style.backgroundColor = 'transparent';
        }, 300);
    }
    
    // Calculate accuracy dan update
    // Accuracy dari GPS (bisa sangat besar, misal 41904m)
    const actualAccuracy = e.accuracy / 2;
    
    // CRITICAL: Radius lingkaran accuracy Maksimal 1 kilometer (1000 meter)
    // Batasi radius lingkaran agar tidak terlalu besar dan tetap praktis
    const MAX_ACCURACY_RADIUS = 1000; // 1 kilometer
    const radius = Math.min(actualAccuracy, MAX_ACCURACY_RADIUS);
    
    if (accuracyEl) {
        // Tampilkan accuracy aktual dari GPS di UI (bisa > 1000m)
        accuracyEl.textContent = `Accuracy: ${actualAccuracy.toFixed(0)}m`;
        // Highlight accuracy juga untuk menunjukkan update
        accuracyEl.style.transition = 'background-color 0.3s';
        accuracyEl.style.backgroundColor = '#e8f5e9';
        setTimeout(() => {
            if (accuracyEl) accuracyEl.style.backgroundColor = 'transparent';
        }, 300);
    }
    
    // CRITICAL: Marker biru HARUS selalu berada di titik lokasi GPS yang AKURAT
    // Update markers HANYA jika lokasi akurat - JANGAN update dengan lokasi default/cached
    if (currentUserPosition) {
        // CRITICAL: Jangan update marker jika lokasi tidak akurat (default/cached)
        // Hanya update jika lokasi baru lebih akurat atau sudah sangat akurat
        const shouldUpdate = !isUnacceptableAccuracy || !bestGPSLocation || accuracy < bestGPSLocation.accuracy;
        
        if (!shouldUpdate) {
            console.log('🔒 Blocking marker update - keeping accurate GPS location');
            // Gunakan lokasi GPS terbaik yang sudah ada
            if (bestGPSLocation) {
                const bestLatLng = L.latLng(bestGPSLocation.lat, bestGPSLocation.lng);
                currentUserPosition.setLatLng(bestLatLng);
                currentUserPosition.setPopupContent("📍 Lokasi Anda (Akurasi GPS: " + bestGPSLocation.accuracy.toFixed(0) + "m)");
                
                // Update koordinat di UI dengan lokasi terbaik
                if (coordsEl) {
                    coordsEl.textContent = `Lat: ${bestGPSLocation.lat.toFixed(6)}, Lng: ${bestGPSLocation.lng.toFixed(6)}`;
                }
                
                // Update accuracy circle juga
                if (currentAccuracy) {
                    currentAccuracy.setLatLng(bestLatLng);
                    const bestRadius = Math.min(bestGPSLocation.accuracy / 2, 1000);
                    currentAccuracy.setRadius(bestRadius);
                }
            }
            return; // JANGAN lanjutkan - block update dari lokasi tidak akurat
        }
        
        // Update existing marker position ke lokasi saat ini (REAL-TIME)
        // setLatLng() memastikan marker selalu bergerak mengikuti lokasi GPS AKURAT
        const oldLatLng = currentUserPosition.getLatLng();
        currentUserPosition.setLatLng(e.latlng);
        // Tampilkan accuracy aktual di popup, bukan radius terbatas
        currentUserPosition.setPopupContent("📍 Lokasi Anda (Akurasi GPS: " + actualAccuracy.toFixed(0) + "m)");
        
        // Log untuk debugging - memastikan marker selalu update
        const distanceMoved = oldLatLng ? oldLatLng.distanceTo(e.latlng) : 0;
        if (distanceMoved > 1) { // Hanya log jika bergerak lebih dari 1 meter
            console.log('📍 Marker updated - moved ' + distanceMoved.toFixed(1) + 'm to:', e.latlng.lat.toFixed(6) + ', ' + e.latlng.lng.toFixed(6));
        }
        
        // Verifikasi marker benar-benar di posisi yang benar
        const currentMarkerPos = currentUserPosition.getLatLng();
        if (Math.abs(currentMarkerPos.lat - e.latlng.lat) > 0.000001 || 
            Math.abs(currentMarkerPos.lng - e.latlng.lng) > 0.000001) {
            console.warn('⚠️ Marker position mismatch detected - correcting...');
            currentUserPosition.setLatLng(e.latlng); // Force update jika ada mismatch
        }
    } else {
        // Create marker untuk pertama kali - PASTIKAN menggunakan lokasi GPS AKURAT
        // Jika ada lokasi GPS terbaik, gunakan yang terbaik; jika tidak, gunakan yang saat ini (jika akurat)
        const markerLocation = (bestGPSLocation && !isUnacceptableAccuracy) ? 
            L.latLng(bestGPSLocation.lat, bestGPSLocation.lng) : 
            (isUnacceptableAccuracy ? (bestGPSLocation ? L.latLng(bestGPSLocation.lat, bestGPSLocation.lng) : e.latlng) : e.latlng);
        
        const customIcon = L.divIcon({
            className: 'custom-user-marker',
            html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        
        // Buat marker tepat di lokasi GPS AKURAT
        currentUserPosition = L.marker(markerLocation, {
            icon: customIcon,
            draggable: false, // Tidak bisa digeser - selalu ikut GPS
            autoPan: false // Tidak auto-pan saat update
        }).addTo(map);
        
        const markerAccuracy = bestGPSLocation ? bestGPSLocation.accuracy : actualAccuracy;
        currentUserPosition.bindPopup("📍 Lokasi Anda (Akurasi GPS: " + markerAccuracy.toFixed(0) + "m)");
        
        console.log('✅ Marker biru dibuat di lokasi GPS:', markerLocation.lat.toFixed(6) + ', ' + markerLocation.lng.toFixed(6));
    }
    
    // Update accuracy circle HANYA jika lokasi akurat atau menggunakan lokasi GPS terbaik
    const circleLocation = (bestGPSLocation && isUnacceptableAccuracy) ? 
        L.latLng(bestGPSLocation.lat, bestGPSLocation.lng) : 
        e.latlng;
    const circleRadius = (bestGPSLocation && isUnacceptableAccuracy) ? 
        Math.min(bestGPSLocation.accuracy / 2, 1000) : 
        radius;
    
    if (currentAccuracy) {
        // Update existing accuracy circle dengan lokasi GPS AKURAT
        currentAccuracy.setLatLng(circleLocation);
        currentAccuracy.setRadius(circleRadius); // radius sudah dibatasi maksimal 1000m
        if (!isUnacceptableAccuracy || (bestGPSLocation && accuracy < bestGPSLocation.accuracy)) {
            console.log('📍 Accuracy circle updated - radius:', circleRadius.toFixed(0) + 'm (max 1km)');
        }
    } else {
        // Create accuracy circle dengan lokasi GPS AKURAT
        currentAccuracy = L.circle(circleLocation, circleRadius, {
            color: '#ffd700',
            fillColor: '#ffd700',
            fillOpacity: 0.2,
            stroke: true,
            weight: 3,
            strokeColor: '#ffd700',
            strokeOpacity: 1
        }).addTo(map);
        console.log('✅ Accuracy circle created - radius:', circleRadius.toFixed(0) + 'm (max 1km, actual GPS accuracy: ' + actualAccuracy.toFixed(0) + 'm)');
    }
    
    // Auto-center map to user location (only first time)
    // This makes the map automatically zoom to user's position when opened
    // Using zoom level 13 for wider view (was 16 for closer view)
    if (isFirstLocationUpdate) {
        map.setView(e.latlng, 13);
        isFirstLocationUpdate = false; // Reset flag after first update
    }
    
    // PASTIKAN marker biru selalu di lokasi saat ini - verifikasi dan pan map jika perlu
    // Ini memastikan marker selalu terlihat dan di posisi yang benar selama navigasi
    if (currentUserPosition) {
        const markerLatLng = currentUserPosition.getLatLng();
        const distanceMoved = e.latlng.distanceTo(markerLatLng);
        
        // Jika marker terlalu jauh dari lokasi GPS (lebih dari 50m), force update
        if (distanceMoved > 50) {
            console.warn('⚠️ Marker terlalu jauh dari GPS (' + distanceMoved.toFixed(0) + 'm) - force update');
            currentUserPosition.setLatLng(e.latlng);
        }
        
        // Auto-pan map untuk mengikuti marker saat navigasi aktif
        // Selama navigasi aktif, peta selalu mengikuti pergerakan user
        // Threshold dikurangi menjadi 5m agar peta lebih responsif dan selalu mengikuti pergerakan
        if (isNavigating && distanceMoved > 5) {
            map.panTo(e.latlng, { duration: 0.5 }); // Smooth pan mengikuti marker
            console.log('📍 Map following user movement during navigation:', distanceMoved.toFixed(0), 'm');
        }
    }
    
    // Don't create route automatically - wait for user to set destination
    // Route will be created when user sets destination via voice command
    if (latLngB && destinationMarker) {
        updateRoute(e.latlng);
    }
    
    // Hide permission popup if shown
    const popup = document.getElementById('permissionPopup');
    if (popup) popup.style.display = 'none';
    
    // Check for next navigation direction if navigating (Google Maps style)
    if (isNavigating) {
        // Check if user has arrived at destination (within 50 meters)
        if (latLngB && destinationMarker) {
            const destinationLatLng = L.latLng(latLngB[0], latLngB[1]);
            const distanceToDestination = e.latlng.distanceTo(destinationLatLng);
            
            if (distanceToDestination <= 50) {
                // User has arrived!
                console.log('✅ User arrived at destination! Distance:', distanceToDestination.toFixed(0) + 'm');
                
                // Stop navigation
                isNavigating = false;
                announcedInstructions = [];
                lastAnnouncedInstruction = null;
                
                // Nonaktifkan flag navigasi di SpeechCoordinator
                if (typeof window.SpeechCoordinator !== 'undefined') {
                    window.SpeechCoordinator.setNavigating(false);
                }
                
                // Deactivate Mode Detector saat navigasi berhenti
                if (typeof window.ModeDetector !== 'undefined') {
                    const modeDetectorState = window.ModeDetector.getState();
                    if (modeDetectorState.isActive) {
                        console.log('🔄 Deactivating Mode Detector - navigation ended');
                        window.ModeDetector.deactivate();
                        console.log('✅ Mode Detector deactivated');
                    }
                }
                
                // Announce arrival
                speakText('Anda sudah sampai di tujuan. Jika ingin melanjutkan lagi maka ucapkan Rute yang ingin anda tuju, Jika tidak maka ucapkan stop', 'id-ID', true, function() {
                    // Restart microphone for next command
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            try {
                                recognition.start();
                                isListening = true;
                                recognition._stopped = false;
                                console.log('🎤 Microphone reactivated after arrival');
                                updateVoiceStatus('✅ Sudah sampai tujuan - Ucapkan nama rute atau Stop');
                            } catch (error) {
                                console.error('Failed to restart microphone:', error);
                                recognition._stopped = true;
                            }
                        }
                    }, 500);
                });
                
                updateVoiceStatus('✅ Sudah sampai tujuan!');
                return; // Stop processing further navigation updates
            }
        }
        
        // Small delay to ensure DOM is ready
        setTimeout(function() {
            announceNextDirection();
        }, 500);
        
        // Update real-time instructions: jarak berkurang dan hapus yang sudah dilewati
        setTimeout(function() {
            updateRealTimeInstructions(e.latlng);
        }, 600);
    }
}

// Function to handle location errors
function onLocationError(e) {
    const statusEl = document.getElementById('status');
    const retryBtn = document.getElementById('retryBtn');
    
    let errorMessage = '❌ Error: ' + e.message;
    
    // Check if it's a secure origin error
    if (e.message.includes('secure origin') || e.message.includes('Only secure origins')) {
        errorMessage = '❌ Akses lokasi memerlukan HTTPS atau localhost!\n\nGunakan:\nhttp://localhost:8000\natau\nhttp://127.0.0.1:8000';
    }
    
    if (statusEl) statusEl.textContent = errorMessage;
    
    // Show retry button
    if (retryBtn) {
        retryBtn.style.display = 'block';
        retryBtn.onclick = function() {
            retryBtn.style.display = 'none';
            requestLocation();
        };
    }
    
    // Don't use default location - wait for real permission
    if (!hasPermission && !currentUserPosition) {
        showPermissionPopup();
    }
}

// Store last route hash to detect new routes
let lastRouteHash = null;
let isAnnouncingRoute = false; // Prevent duplicate announcements
let lastSpokenMessage = ''; // Track last spoken message to prevent duplicates
let lastAnnouncementTime = 0; // Track when last announcement was made

// Force update route - always recreate for new destination
function forceUpdateRoute(userLatLng) {
    console.log('🔄 FORCE updating route for new destination');
    
    // Stop microphone during route calculation
    if (isListening && recognition) {
        console.log('🔇 Stopping microphone during route calculation');
        recognition._stopped = true; // Set stopped flag before stopping
        recognition.stop();
        isListening = false;
    }
    
    // Remove old route completely
    if (route) {
        console.log('🗑️ Removing old route');
        map.removeControl(route);
        route = null;
    }
    
    // Always create fresh route with new destination
    console.log('✨ Creating NEW route to destination:', latLngB);
    // Ensure latLngB is correct: latLngB = [lat, lng]
    const endLat = latLngB[0];
    const endLng = latLngB[1];
    
    // Check if coordinates are valid
    if (isNaN(endLat) || isNaN(endLng)) {
        console.error('❌ Invalid destination coordinates:', latLngB);
        return;
    }
    
    // Debug: log coordinates being used
    console.log('📍 Creating route from:', userLatLng, 'to:', { lat: endLat, lng: endLng });
    
    route = L.Routing.control({
        waypoints: [
            L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]),
            L.latLng(endLat, endLng)
        ],
        lineOptions: {
            styles: [{color: '#3b49df', opacity: 0.7, weight: 5}]
        },
        createMarker: function() { return null; }
    }).addTo(map);
    
    // Handle routing errors
    route.on('routingerror', function(e) {
        console.error('❌ Routing error:', e);
        
        // Stop microphone first to prevent overlap
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        // Announce error
        speakText('Gagal menghitung rute. Server OSRM mungkin sedang bermasalah.', 'id-ID', true, function() {
            // After announcement, ask for destination again
            speakText('Sebutkan tujuan Anda lagi', 'id-ID', true, function() {
                // Restart microphone after announcement finishes
                setTimeout(function() {
                    if (recognition && !isListening) {
                        recognition.start();
                        isListening = true;
                        updateVoiceStatus('🎤 Mikrofon aktif kembali. Sebutkan tujuan Anda.');
                    }
                }, 500);
            });
        });
        
        updateVoiceStatus('⚠️ Error menghitung rute');
    });
    
    // Re-attach event listener
    route.on('routesfound', function(e) {
        console.log('✅✅✅ NEW ROUTE FOUND FOR NEW DESTINATION!');
        console.log('📍 Route distance:', e.routes[0].summary.totalDistance / 1000, 'km');
        console.log('⏱️ Route time:', e.routes[0].summary.totalTime / 60, 'minutes');
        
        // CRITICAL: Pastikan marker biru tetap di lokasi GPS user saat ini
        // JANGAN biarkan route creation mengubah marker position
        if (currentUserPosition && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function(position) {
                const currentGPSLocation = L.latLng(position.coords.latitude, position.coords.longitude);
                const markerLocation = currentUserPosition.getLatLng();
                const distance = currentGPSLocation.distanceTo(markerLocation);
                
                // Jika marker bergeser dari GPS location (> 10 meter), force kembali ke GPS
                if (distance > 10) {
                    console.warn('⚠️ Route found - marker shifted ' + distance.toFixed(0) + 'm from GPS, correcting...');
                    currentUserPosition.setLatLng(currentGPSLocation);
                    console.log('✅ Marker corrected to GPS location:', currentGPSLocation.lat.toFixed(6) + ', ' + currentGPSLocation.lng.toFixed(6));
                } else {
                    console.log('✅ Marker verified - still at GPS location');
                }
            }, function(error) {
                console.warn('⚠️ Could not verify marker position:', error);
                // Fallback: gunakan last known GPS location dari onLocationFound
            }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 });
        }
        
        // Save route data for navigation tracking
        const routeData = e.routes[0];
        currentLegIndex = 0;
        lastAnnouncedInstruction = null;
        announcedInstructions = []; // Reset announced instructions
        isNavigating = false; // Not navigating yet - wait for user command
        shouldAnnounceRoute = false; // Don't auto-announce route yet
        
        if (routeData && routeData.summary) {
            const sum = routeData.summary;
            const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
            const distanceSpeech = formatDistanceForSummary(sum.totalDistance);
            const durationSpeech = formatDurationSeconds(sum.totalTime);
            lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Jarak ' + distanceSpeech + ', perkiraan waktu ' + durationSpeech + '.';
        }
        
        if (routeData && routeData.instructions && routeData.instructions.length) {
            const firstMeaningfulInstruction = routeData.instructions.find(function(inst) {
                if (!inst || !inst.text) return false;
                const text = inst.text.toLowerCase();
                return inst.distance > 0 && !text.startsWith('head');
            });
            
            if (firstMeaningfulInstruction) {
                const instructionText = convertInstructionToNatural(firstMeaningfulInstruction.text);
                const distanceText = formatDistanceForInstruction(firstMeaningfulInstruction.distance);
                lastRouteFirstInstructionSpeech = distanceText
                    ? 'Dalam ' + distanceText + ', ' + instructionText
                    : instructionText;
            } else {
                lastRouteFirstInstructionSpeech = '';
            }
        } else {
            lastRouteFirstInstructionSpeech = '';
        }
        
        const routeHash = JSON.stringify(e.routes[0].coordinates);
        
        // Check if there's a pending route announcement (from handleRouteCommand)
        if (pendingRouteAnnouncement) {
            const pending = pendingRouteAnnouncement;
            const sum = e.routes[0].summary;
            const distanceKm = (sum.totalDistance / 1000).toFixed(1);
            const timeMinutes = Math.round(sum.totalTime / 60);
            
            // Format announcement sesuai requirement
            const announcement = 'Rute ' + pending.routeId + ', Anda dari ' + pending.startName + 
                ' menuju ' + pending.endName + '. Dengan Jarak ' + distanceKm + ' kilometer dan Waktu tempuh ' + 
                timeMinutes + ' menit. Ucapkan Navigasi untuk memulai, Jika tidak Ucapkan Ganti Rute.';
            
            console.log('✅✅✅ Route found - announcing route details');
            
            speakText(announcement, 'id-ID', true, function() {
                // Restart microphone untuk mendengarkan "Navigasi" atau "Ganti Rute" command
                setTimeout(function() {
                    if (recognition && !isListening) {
                        try {
                            recognition.start();
                            isListening = true;
                            recognition._waitingForNavigasi = true;
                            console.log('🎤 Microphone restarted - listening for "Navigasi" or "Ganti Rute" command');
                            
                            // Auto-stop after 10 seconds if no command
                            // Store timer ID so we can cancel it if user says "Ganti Rute" before timer expires
                            recognition._navigasiTimer = setTimeout(function() {
                                if (recognition && recognition._waitingForNavigasi && isListening) {
                                    recognition.stop();
                                    recognition._stopped = true;
                                    recognition._waitingForNavigasi = false;
                                    recognition._navigasiTimer = null;
                                    isListening = false;
                                    console.log('🔇 Microphone stopped - command window expired');
                                    updateVoiceStatus('✅ Rute dipilih - Ucapkan "Navigasi" atau "Ganti Rute"');
                                }
                            }, 10000);
                        } catch (error) {
                            console.error('Failed to restart microphone:', error);
                            recognition._stopped = true;
                        }
                    }
                }, 500);
            });
            
            // Clear pending announcement
            pendingRouteAnnouncement = null;
        } else {
            // No pending announcement - old behavior
            console.log('✅✅✅ Route found - waiting for user to say "Navigasi" to start');
        }
        
        // Translate instructions to Indonesian but don't announce yet
        translateRouteInstructions();
    });
}

// Function to update or create the route from user location to destination
function updateRoute(userLatLng) {
    // Don't create route if no destination is set
    if (!latLngB) {
        console.log('⚠️ No destination set yet - skipping route creation');
        return;
    }
    
    if (!route) {
        // Stop microphone during route creation
        if (isListening && recognition) {
            console.log('🔇 Stopping microphone during route creation');
            recognition._stopped = true; // Set stopped flag before stopping
            recognition.stop();
            isListening = false;
        }
        
        // Create route for the first time
        route = L.Routing.control({
            waypoints: [
                L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]),
                L.latLng(latLngB[0], latLngB[1])
            ],
            lineOptions: {
                styles: [{color: '#3b49df', opacity: 0.7, weight: 5}]
            },
            createMarker: function() { return null; } // Hide default markers
        }).addTo(map);
        
        // Handle routing errors
        route.on('routingerror', function(e) {
            console.error('❌ Routing error:', e);
            
            // Stop microphone first to prevent overlap
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            // Announce error
            speakText('Gagal menghitung rute. Server mungkin sedang bermasalah.', 'id-ID', true, function() {
                // After announcement, ask for destination again
                speakText('Sebutkan tujuan Anda lagi', 'id-ID', true, function() {
                    // Restart microphone after announcement finishes
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            recognition.start();
                            isListening = true;
                            updateVoiceStatus('🎤 Mikrofon aktif kembali. Sebutkan tujuan Anda.');
                        }
                    }, 500);
                });
            });
            
            updateVoiceStatus('⚠️ Error menghitung rute');
        });
        
        // Listen for route found events to announce directions
        route.on('routesfound', function(e) {
        // Save route data for navigation tracking
        const routeData = e.routes[0];
        currentLegIndex = 0;
        lastAnnouncedInstruction = null;
        announcedInstructions = []; // Reset announced instructions
        isNavigating = false; // Not navigating yet
        shouldAnnounceRoute = false;
        
        // Create route hash
        const routeHash = JSON.stringify(e.routes[0].coordinates);
        const now = Date.now();
        
        console.log('🗺️ Route found event triggered');
            console.log('  - lastRouteHash:', lastRouteHash ? 'exists' : 'null');
            console.log('  - isAnnouncingRoute:', isAnnouncingRoute);
            console.log('  - voiceDirectionsEnabled:', voiceDirectionsEnabled);
            
            // Check if enough time has passed since last announcement (prevent rapid triggers)
            const timeSinceLastAnnouncement = now - lastAnnouncementTime;
            const hasEnoughTimePassed = timeSinceLastAnnouncement > 1000; // 1 second minimum (reduced from 3)
            
            console.log('  - Time since last announcement:', timeSinceLastAnnouncement, 'ms');
            console.log('  - Has enough time passed:', hasEnoughTimePassed);
            
            // Only announce if this is a new route, not already announcing, and enough time has passed
            if (routeHash !== lastRouteHash && !isAnnouncingRoute && hasEnoughTimePassed) {
                lastRouteHash = routeHash;
                isAnnouncingRoute = true;
                lastAnnouncementTime = now;
                
                console.log('🗺️ Route calculated - waiting for user to say "Navigasi"');
                
                // Translate instructions but don't announce yet
                translateRouteInstructions();
            } else if (isAnnouncingRoute) {
                console.log('⚠️ Already announcing route, skipping...');
            } else if (!hasEnoughTimePassed) {
                console.log('⏱️ Too soon since last announcement, skipping...');
            } else if (routeHash === lastRouteHash) {
                console.log('ℹ️ Route unchanged (same hash), skipping announcement');
            }
        });
        
    } else {
        // Update existing route only if waypoints actually changed
        const waypoints = route.getWaypoints();
        if (waypoints && waypoints.length >= 2) {
            const currentStart = waypoints[0];
            const currentEnd = waypoints[1];
            const newStart = L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]);
            const newEnd = L.latLng(latLngB[0], latLngB[1]);
            
            // Compare coordinates - handle both function call and direct property access
            let currentStartLat, currentStartLng, currentEndLat, currentEndLng;
            
            // Try to get coordinates from current waypoints
            // Note: Leaflet Routing Machine returns waypoints that can be accessed directly
            
            // Check if waypoints are arrays (lat, lng format)
            if (Array.isArray(currentStart) && currentStart.length >= 2) {
                currentStartLat = currentStart[0];
                currentStartLng = currentStart[1];
            } else if (typeof currentStart.lat === 'function' && typeof currentStart.lng === 'function') {
                currentStartLat = currentStart.lat();
                currentStartLng = currentStart.lng();
            } else if (currentStart.lat !== undefined && currentStart.lng !== undefined) {
                currentStartLat = currentStart.lat;
                currentStartLng = currentStart.lng;
            } else {
                // If we can't get coordinates, use new coordinates without logging
                currentStartLat = newStart.lat;
                currentStartLng = newStart.lng;
            }
            
            if (Array.isArray(currentEnd) && currentEnd.length >= 2) {
                currentEndLat = currentEnd[0];
                currentEndLng = currentEnd[1];
            } else if (typeof currentEnd.lat === 'function' && typeof currentEnd.lng === 'function') {
                currentEndLat = currentEnd.lat();
                currentEndLng = currentEnd.lng();
            } else if (currentEnd.lat !== undefined && currentEnd.lng !== undefined) {
                currentEndLat = currentEnd.lat;
                currentEndLng = currentEnd.lng;
            } else {
                // If we can't get coordinates, use new coordinates without logging
                currentEndLat = newEnd.lat;
                currentEndLng = newEnd.lng;
            }
            
            // Validate extracted coordinates are numbers
            if (isNaN(currentStartLat) || isNaN(currentStartLng) || isNaN(currentEndLat) || isNaN(currentEndLng) ||
                isNaN(newStart.lat) || isNaN(newStart.lng) || isNaN(newEnd.lat) || isNaN(newEnd.lng)) {
                // If coordinates are invalid, just return to avoid update loop and logging spam
                // The route will update naturally on the next valid location update
                return;
            } else {
                // Calculate differences
                const startLatDiff = Math.abs(currentStartLat - newStart.lat);
                const startLngDiff = Math.abs(currentStartLng - newStart.lng);
                const endLatDiff = Math.abs(currentEndLat - newEnd.lat);
                const endLngDiff = Math.abs(currentEndLng - newEnd.lng);
                
                // Update threshold: ~11 meters for start, ~111 meters for end
                const startChanged = startLatDiff > 0.0001 || startLngDiff > 0.0001;
                const endChanged = endLatDiff > 0.001 || endLngDiff > 0.001;
                
                // Only log if there's a significant change
                if (startChanged || endChanged) {
                    console.log('📊 Waypoint comparison:', {
                        startChanged: startChanged,
                        endChanged: endChanged,
                        startDist: ((startLatDiff + startLngDiff) * 1000).toFixed(2) + 'm',
                        endDist: ((endLatDiff + endLngDiff) * 1000).toFixed(2) + 'm'
                    });
                }
                
                // Update if start location changed (user moved) or end location changed (destination changed)
                if (startChanged || endChanged) {
                    // If destination changed, recreate route completely
                    if (endChanged) {
                        console.log('🔄 Destination changed - recreating route');
                        console.log('📍 From:', { lat: currentEndLat, lng: currentEndLng }, 'To:', { lat: newEnd.lat, lng: newEnd.lng });
                        
                        // Remove old route and create new one to force update
                        if (route) {
                            console.log('🗑️ Removing old route');
                            map.removeControl(route);
                            route = null;
                        }
                        
                        // Create fresh route with new destination
                        console.log('✨ Creating new route to destination');
                        route = L.Routing.control({
                            waypoints: [newStart, newEnd],
                            lineOptions: {
                                styles: [{color: '#3b49df', opacity: 0.7, weight: 5}]
                            },
                            createMarker: function() { return null; }
                        }).addTo(map);
                        
                        // Re-attach event listener for new route
                        route.on('routesfound', function(e) {
                            console.log('✅✅✅ NEW ROUTE FOUND AFTER DESTINATION CHANGE!');
                            console.log('📍 Route distance:', e.routes[0].summary.totalDistance / 1000, 'km');
                            console.log('⏱️ Route time:', e.routes[0].summary.totalTime / 60, 'minutes');
                            
                            // CRITICAL: Pastikan marker biru tetap di lokasi GPS user saat ini
                            // JANGAN biarkan route creation mengubah marker position
                            if (currentUserPosition && navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(function(position) {
                                    const currentGPSLocation = L.latLng(position.coords.latitude, position.coords.longitude);
                                    const markerLocation = currentUserPosition.getLatLng();
                                    const distance = currentGPSLocation.distanceTo(markerLocation);
                                    
                                    // Jika marker bergeser dari GPS location (> 10 meter), force kembali ke GPS
                                    if (distance > 10) {
                                        console.warn('⚠️ Route found (destination change) - marker shifted ' + distance.toFixed(0) + 'm from GPS, correcting...');
                                        currentUserPosition.setLatLng(currentGPSLocation);
                                        console.log('✅ Marker corrected to GPS location:', currentGPSLocation.lat.toFixed(6) + ', ' + currentGPSLocation.lng.toFixed(6));
                                    }
                                }, function(error) {
                                    console.warn('⚠️ Could not verify marker position:', error);
                                }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 });
                            }
                            
                            // Save route data for navigation tracking
                            const routeData = e.routes[0];
                            currentLegIndex = 0;
                            lastAnnouncedInstruction = null;
                            announcedInstructions = []; // Reset announced instructions
                            isNavigating = false; // Not navigating yet - wait for user command
                            shouldAnnounceRoute = false; // Don't auto-announce route yet
                            
                            if (routeData && routeData.summary) {
                                const sum = routeData.summary;
                                const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
                                const distanceSpeech = formatDistanceForSummary(sum.totalDistance);
                                const durationSpeech = formatDurationSeconds(sum.totalTime);
                                lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Jarak ' + distanceSpeech + ', perkiraan waktu ' + durationSpeech + '.';
                            }
                            
                            if (routeData && routeData.instructions && routeData.instructions.length) {
                                const firstMeaningfulInstruction = routeData.instructions.find(function(inst) {
                                    if (!inst || !inst.text) return false;
                                    const text = inst.text.toLowerCase();
                                    return inst.distance > 0 && !text.startsWith('head');
                                });
                                
                                if (firstMeaningfulInstruction) {
                                    const instructionText = convertInstructionToNatural(firstMeaningfulInstruction.text);
                                    const distanceText = formatDistanceForInstruction(firstMeaningfulInstruction.distance);
                                    lastRouteFirstInstructionSpeech = distanceText
                                        ? 'Dalam ' + distanceText + ', ' + instructionText
                                        : instructionText;
                                } else {
                                    lastRouteFirstInstructionSpeech = '';
                                }
                            } else {
                                lastRouteFirstInstructionSpeech = '';
                            }
                            
                            const routeHash = JSON.stringify(e.routes[0].coordinates);
                            
                            // Check if there's a pending route announcement (from handleRouteCommand)
                            if (pendingRouteAnnouncement) {
                                const pending = pendingRouteAnnouncement;
                                const sum2 = e.routes[0].summary;
                                const distanceKm2 = (sum2.totalDistance / 1000).toFixed(1);
                                const timeMinutes2 = Math.round(sum2.totalTime / 60);
                                
                                // Format announcement sesuai requirement
                                const announcement2 = 'Rute ' + pending.routeId + ', Anda dari ' + pending.startName + 
                                    ' menuju ' + pending.endName + '. Dengan Jarak ' + distanceKm2 + ' kilometer dan Waktu tempuh ' + 
                                    timeMinutes2 + ' menit. Ucapkan Navigasi untuk memulai, Jika tidak Ucapkan Ganti Rute.';
                                
                                console.log('✅✅✅ Route found - announcing route details');
                                
                                speakText(announcement2, 'id-ID', true, function() {
                                    // Restart microphone untuk mendengarkan "Navigasi" atau "Ganti Rute" command
                                    setTimeout(function() {
                                        if (recognition && !isListening) {
                                            try {
                                                recognition.start();
                                                isListening = true;
                                                recognition._waitingForNavigasi = true;
                                                console.log('🎤 Microphone restarted - listening for "Navigasi" or "Ganti Rute" command');
                                                
                                                // Auto-stop after 10 seconds if no command
                                                // Store timer ID so we can cancel it if user says "Ganti Rute" before timer expires
                                                recognition._navigasiTimer = setTimeout(function() {
                                                    if (recognition && recognition._waitingForNavigasi && isListening) {
                                                        recognition.stop();
                                                        recognition._stopped = true;
                                                        recognition._waitingForNavigasi = false;
                                                        recognition._navigasiTimer = null;
                                                        isListening = false;
                                                        console.log('🔇 Microphone stopped - command window expired');
                                                        updateVoiceStatus('✅ Rute dipilih - Ucapkan "Navigasi" atau "Ganti Rute"');
                                                    }
                                                }, 10000);
                                            } catch (error) {
                                                console.error('Failed to restart microphone:', error);
                                                recognition._stopped = true;
                                            }
                                        }
                                    }, 500);
                                });
                                
                                // Clear pending announcement
                                pendingRouteAnnouncement = null;
                            } else {
                                // No pending announcement - old behavior
                                console.log('✅✅✅ Route found - waiting for user to say "Navigasi" to start');
                            }
                            
                            // Translate instructions to Indonesian but don't announce yet
                            translateRouteInstructions();
                        });
                    } else if (startChanged) {
                        // REAL-TIME: User location changed - update route smoothly without recreating
                        // This makes navigation follow user movement in real-time
                        console.log('📍 User location changed - updating route start point (REAL-TIME NAVIGATION)');
                        
                        try {
                            // Use setWaypoints() for efficient real-time updates
                            // This keeps route visible and smoothly follows user movement
                            route.setWaypoints([
                                newStart,  // Update start to current user location (real-time)
                                newEnd     // Keep destination unchanged
                            ]);
                            
                            console.log('✅ Route updated in real-time - following user movement');
                        } catch (error) {
                            console.error('Error updating waypoints (real-time):', error);
                            // Fallback: route will be updated on next location update
                        }
                    }
                } else {
                    console.log('ℹ️ Route waypoints unchanged, skipping update');
                }
            } // Close else block for valid coordinates
        } else {
            // Fallback: just update the route
            console.log('🔄 Updating route waypoints (fallback)');
            route.setWaypoints([
                L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]),
                L.latLng(latLngB[0], latLngB[1])
            ]);
        }
    }
}

// Set up event listeners for geolocation
map.on('locationfound', onLocationFound);
map.on('locationerror', onLocationError);

// Function to request location permission
// CRITICAL: Selalu request GPS fresh location, jangan gunakan cached/default
function requestLocation() {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '⏳ Requesting GPS location...';
    
    // Request location with options - SELALU dapatkan GPS fresh
    navigator.geolocation.getCurrentPosition(
        function(position) {
            // CRITICAL: Verifikasi bahwa lokasi ini adalah GPS aktual, bukan default/cached
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            
            // Deteksi jika lokasi adalah default location (misalnya Surakarta default)
            // Koordinat Surakarta umum: sekitar -7.575, 110.824
            const isNearSurakarta = lat > -7.6 && lat < -7.5 && lng > 110.8 && lng < 110.9;
            
            // Jika accuracy sangat besar (> 5000m) dan di area Surakarta, kemungkinan default location
            if (isNearSurakarta && accuracy > 5000) {
                console.warn('⚠️ WARNING: Detected possible default/cached location in Surakarta area');
                console.warn('📍 Coordinates:', lat, lng, 'Accuracy:', accuracy, 'm');
                console.warn('🔄 Attempting to get fresh GPS location...');
                
                // Request fresh location lagi dengan timeout lebih lama
                if (statusEl) statusEl.textContent = '⚠️ Getting fresh GPS location (please allow GPS access)...';
                
                navigator.geolocation.getCurrentPosition(
                    function(freshPosition) {
                        console.log('✅ Fresh GPS location received:', freshPosition.coords.latitude, freshPosition.coords.longitude);
                        map.fire('locationfound', {
                            latlng: L.latLng(freshPosition.coords.latitude, freshPosition.coords.longitude),
                            accuracy: freshPosition.coords.accuracy
                        });
                    },
                    function(error) {
                        console.error('❌ Failed to get fresh GPS:', error);
                        // Fallback: gunakan location yang ada tapi warn user
                        if (statusEl) statusEl.textContent = '⚠️ Using available location (may not be accurate)';
                        map.fire('locationfound', {
                            latlng: L.latLng(lat, lng),
                            accuracy: accuracy
                        });
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 20000, // Timeout lebih lama untuk GPS
                        maximumAge: 0 // SELALU fresh
                    }
                );
            } else {
                // Lokasi tampak valid - langsung gunakan
                map.fire('locationfound', {
                    latlng: L.latLng(lat, lng),
                    accuracy: accuracy
                });
            }
        },
        function(error) {
            // Error - trigger locationerror event
            map.fire('locationerror', {
                message: error.message
            });
        },
        {
            enableHighAccuracy: true, // SELALU gunakan GPS high accuracy
            timeout: 15000, // Timeout lebih lama untuk GPS
            maximumAge: 0 // JANGAN gunakan cached - SELALU request fresh GPS
        }
    );
}

// Function to start continuous location tracking
function startLocationTracking() {
    // Clear any existing interval
    if (locationInterval) {
        clearInterval(locationInterval);
    }
    
    // Try to locate immediately
    locate();
    
    // Continue locating at configured interval (default: 1 second for realtime)
    locationInterval = setInterval(locate, LOCATION_UPDATE_INTERVAL);
}

// Function to locate user using Leaflet
// CRITICAL: Selalu request GPS fresh, jangan gunakan cached location
function locate() {
    map.locate({
        setView: false, // Don't auto center - let user control
        watch: false,
        maxZoom: 16,
        enableHighAccuracy: true, // Gunakan GPS aktual, bukan network location
        timeout: 15000, // Timeout lebih lama untuk mendapatkan GPS akurat
        maximumAge: 0 // JANGAN gunakan cached location - selalu request fresh GPS
    });
}

// Function to show permission popup
function showPermissionPopup() {
    const popup = document.getElementById('permissionPopup');
    if (popup) {
        popup.style.display = 'block';
    }
}

// Function to hide permission popup
function hidePermissionPopup() {
    const popup = document.getElementById('permissionPopup');
    if (popup) {
        popup.style.display = 'none';
    }
}

// Check if geolocation is supported
if (!navigator.geolocation) {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '❌ Browser tidak mendukung geolocation';
    const popup = document.getElementById('permissionPopup');
    if (popup) popup.style.display = 'none';
} else {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupLocationTracking);
    } else {
        setupLocationTracking();
    }
}

// Global function for button onclick
function requestLocationPermission() {
    console.log('requestLocationPermission called');
    
    // Mark user interaction for Speech Synthesis
    hasUserInteraction = true;
    
    hidePermissionPopup();
    requestLocation();
    
    // Trigger welcome guide after button click (valid user interaction)
    setTimeout(function() {
        if (voiceDirectionsEnabled && isFirstLoad) {
            console.log('📢 Starting SENAVISION welcome guide after button click');
            announceWelcomeGuide();
        }
        startLocationTracking();
    }, 2000);
}

// Setup location tracking when DOM is ready
function setupLocationTracking() {
    const requestBtn = document.getElementById('requestPermissionBtn');
    const retryBtn = document.getElementById('retryBtn');
    
    // Setup request button - also add event listener as backup
    if (requestBtn) {
        requestBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('Button clicked via event listener!');
            requestLocationPermission();
        });
    }
    
    // Setup retry button
    if (retryBtn) {
        retryBtn.addEventListener('click', function() {
            retryBtn.style.display = 'none';
            requestLocation();
        });
    }
    
    // Check if we already have permission (user might have granted before)
    // Try to get location once on page load to see if we have permission
    navigator.geolocation.getCurrentPosition(
        function(position) {
            // We already have permission, hide popup and start tracking
            hidePermissionPopup();
            hasPermission = true;
            const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
            map.fire('locationfound', {
                latlng: latlng,
                accuracy: position.coords.accuracy
            });
            startLocationTracking();
            
            // If permission already exists, trigger welcome guide after click on page
            // This handles case where user already granted permission before
            document.body.addEventListener('click', function triggerWelcomeOnFirstClick() {
                if (!hasUserInteraction && voiceDirectionsEnabled && isFirstLoad) {
                    hasUserInteraction = true;
                    console.log('📢 Starting SENAVISION welcome guide after page click (permission already granted)');
                    announceWelcomeGuide();
                    document.body.removeEventListener('click', triggerWelcomeOnFirstClick);
                }
            }, { once: false });
        },
        function(error) {
            // No permission yet, show popup
            console.log('No location permission yet');
        }
    );
}

// ========== SPEECH RECOGNITION FUNCTIONS ==========

// Initialize speech recognition
function initSpeechRecognition() {
    // Check if browser supports speech recognition
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.log('Speech recognition not supported');
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) voiceBtn.style.display = 'none';
        return;
    }
    
    // Create speech recognition object
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    // Configure speech recognition
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'id-ID'; // Using Indonesian language
    
    // Handle speech recognition results
    recognition.onresult = function(event) {
        const now = Date.now();
        if (isNavigatorSpeaking || now < suppressRecognitionUntil) {
            // Ignore any recognition results produced while navigator speech is playing or shortly after
            if (now - lastNavigatorIgnoreLog > 500) {
                console.log('🎧 Ignoring speech recognition result during navigator speech', {
                    isNavigatorSpeaking,
                    suppressingForMs: Math.max(0, suppressRecognitionUntil - now)
                });
                lastNavigatorIgnoreLog = now;
            }
            finalTranscript = '';
            return;
        }
        let interimTranscript = '';
        
        // Process all results
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
                
                // CRITICAL: Check interim results for "Halo" to activate microphone immediately
                // This allows "Halo" to work even if microphone wasn't fully active
                const interimClean = transcript.toLowerCase().trim().replace(/[.,;:!?]/g, '');
                if (interimClean.includes('halo') || interimClean.includes('hello') || interimClean.includes('aktivasi') || interimClean.includes('activate')) {
                    console.log('🎤 "Halo" detected in interim results - activating microphone immediately');
                    if (recognition && recognition._stopped) {
                        recognition._stopped = false;
                        hasUserInteraction = true; // Mark interaction for browser security
                        console.log('🎤 Clearing stopped flag via interim "Halo" detection');
                    }
                    // Don't call handleVoiceCommand here, let final result handle it
                }
            }
        }
        
        // Update voice status display
        updateVoiceStatus(interimTranscript || finalTranscript);
        
        // Handle final transcript
        if (finalTranscript) {
            console.log('Final transcript:', finalTranscript);
            handleVoiceCommand(finalTranscript);
            finalTranscript = '';
        }
    };
    
    // Handle speech recognition errors
    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        
        // Handle specific error types with user-friendly messages
        if (event.error === 'not-allowed') {
            // Browser requires user interaction before accessing microphone
            // Set hasUserInteraction to true so next attempt will work
            hasUserInteraction = true;
            updateVoiceStatus('⚠️ Klik layar sekali untuk mengaktifkan mikrofon');
            console.log('⚠️ Microphone requires user interaction - please click page once');
            
            // After user clicks, try to start again automatically
            const clickHandler = function() {
                hasUserInteraction = true;
                try {
                    if (recognition && !isListening) {
                        recognition.start();
                        isListening = true;
                        console.log('🎤 Microphone started after click');
                        updateVoiceStatus('🎤 Mikrofon aktif. sebutkan tujuan.');
                        if (!suppressMicActivationSpeech && lastVoiceCommand && lastVoiceCommand !== 'navigasi') {
                            speakText('Mikrofon aktif. Ucapkan nama rute atau sebutkan tujuan Anda.', 'id-ID', true);
                        }
                    }
                } catch (err) {
                    console.error('Failed to start after click:', err);
                }
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('touchstart', clickHandler);
            };
            
            document.addEventListener('click', clickHandler, { once: true });
            document.addEventListener('touchstart', clickHandler, { once: true });
        } else if (event.error === 'no-speech') {
            // No speech detected - normal, just continue listening
            console.log('ℹ️ No speech detected, continuing to listen...');
            // Don't update status for no-speech, just silently continue
            return;
        } else if (event.error === 'aborted') {
            // Speech recognition was stopped intentionally
            console.log('ℹ️ Speech recognition stopped');
            return;
        } else {
            // Other errors
            updateVoiceStatus('❌ Error: ' + event.error);
        }
        
        isListening = false;
        updateVoiceButton();
    };
    
    // Handle speech recognition end
    recognition.onend = function() {
        console.log('Speech recognition ended');
        isListening = false;
        updateVoiceButton();
        
        // Auto-restart microphone if it was listening (for continuous operation)
        // But only if:
        // 1. It wasn't stopped intentionally (not _stopped)
        // 2. Navigation is not active (to prevent restart during navigation)
        // 3. User has already interacted (required for browser security)
        if (recognition && !isListening && !recognition._stopped && hasUserInteraction && !isNavigating) {
            // Small delay before restart to prevent rapid restart loops
            setTimeout(function() {
                // Only restart if navigation is not active and not manually stopped
                if (recognition && !isListening && !recognition._stopped && hasUserInteraction && !isNavigating) {
                    try {
                        recognition.start();
                        isListening = true;
                        console.log('🔄 Microphone auto-restarted');
                    } catch (error) {
                        // If restart fails (e.g., not-allowed), stop trying
                        console.log('⚠️ Could not restart microphone:', error.message);
                        recognition._stopped = true;
                    }
                } else if (isNavigating) {
                    console.log('ℹ️ Navigation active - microphone auto-restart disabled (say "Halo" to reactivate)');
                }
            }, 1000);
        } else if (isNavigating && !recognition._stopped) {
            console.log('ℹ️ Navigation active - microphone will not auto-restart (say "Halo" to reactivate)');
        }
    };
}

// Known cities and districts list - expanded for better coverage
const knownCities = {
    // Major Cities
    'jakarta': { lat: -6.2088, lng: 106.8456, name: 'Jakarta, Indonesia' },
    'surabaya': { lat: -7.2575, lng: 112.7521, name: 'Surabaya, Indonesia' },
    'bandung': { lat: -6.9175, lng: 107.6191, name: 'Bandung, Indonesia' },
    'medan': { lat: 3.5952, lng: 98.6722, name: 'Medan, Indonesia' },
    'makassar': { lat: -5.1477, lng: 119.4327, name: 'Makassar, Indonesia' },
    'semarang': { lat: -6.9932, lng: 110.4203, name: 'Semarang, Indonesia' },
    'palembang': { lat: -2.9761, lng: 104.7754, name: 'Palembang, Indonesia' },
    'denpasar': { lat: -8.6705, lng: 115.2126, name: 'Denpasar, Indonesia' },
    
    // Central Java
    'yogyakarta': { lat: -7.7956, lng: 110.3695, name: 'Yogyakarta, Indonesia' },
    'surakarta': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    'solo': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    // Districts in Surakarta
    'gilingan': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'gilingan surakarta': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'gilingan solo': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'pajang': { lat: -7.5700, lng: 110.8100, name: 'Pajang, Surakarta' },
    'pasarkliwon': { lat: -7.5760, lng: 110.8310, name: 'Pasarkliwon, Surakarta' },
    'jebres': { lat: -7.5600, lng: 110.8500, name: 'Jebres, Surakarta' },
    'banjarsari': { lat: -7.5560, lng: 110.8170, name: 'Banjarsari, Surakarta' },
    'laweyan': { lat: -7.5640, lng: 110.7950, name: 'Laweyan, Surakarta' },
    'serengan': { lat: -7.5680, lng: 110.8250, name: 'Serengan, Surakarta' },
    
    // Places of Worship - Surakarta
    'masjid sheikh zayed': { lat: -7.5575, lng: 110.8400, name: 'Masjid Sheikh Zayed, Surakarta' },
    'masjid sheikh zayed solo': { lat: -7.5575, lng: 110.8400, name: 'Masjid Sheikh Zayed, Surakarta' },
    'masjid agung surakarta': { lat: -7.5740, lng: 110.8365, name: 'Masjid Agung Surakarta' },
    
    // Universities - Surakarta
    'uns': { lat: -7.5600, lng: 110.8569, name: 'Universitas Sebelas Maret, Surakarta' },
    'universitas sebelas maret': { lat: -7.5600, lng: 110.8569, name: 'Universitas Sebelas Maret, Surakarta' },
    'gedung 1 fakultas teknik uns': { lat: -7.5617, lng: 110.8572, name: 'Gedung 1 Fakultas Teknik UNS' },
    'fakultas teknik uns': { lat: -7.5617, lng: 110.8572, name: 'Fakultas Teknik UNS' },
    'ft uns': { lat: -7.5617, lng: 110.8572, name: 'Fakultas Teknik UNS' },
    'kentingan': { lat: -7.5617, lng: 110.8572, name: 'Kentingan, Jebres, Surakarta' },
    'kampus uns': { lat: -7.5600, lng: 110.8569, name: 'Kampus UNS' },
    
    // Tourist Attractions - Surakarta
    'keraton surakarta': { lat: -7.5748, lng: 110.8253, name: 'Keraton Surakarta Hadiningrat' },
    'keraton solo': { lat: -7.5748, lng: 110.8253, name: 'Keraton Surakarta Hadiningrat' },
    'triwindu': { lat: -7.5622, lng: 110.8244, name: 'Pasar Triwindu Surakarta' },
    'pasar klewer': { lat: -7.5667, lng: 110.8269, name: 'Pasar Klewer Surakarta' },
    'batik laweyan': { lat: -7.5640, lng: 110.7950, name: 'Kampung Batik Laweyan' },
    'kampung batik': { lat: -7.5640, lng: 110.7950, name: 'Kampung Batik Laweyan' },
    'balai kota solo': { lat: -7.5644, lng: 110.8150, name: 'Balai Kota Surakarta' },
    'balai kota surakarta': { lat: -7.5644, lng: 110.8150, name: 'Balai Kota Surakarta' },
    
    // Shopping Malls - Surakarta
    'solo grand mall': { lat: -7.5392, lng: 110.8103, name: 'Solo Grand Mall' },
    'the park mall solo': { lat: -7.5450, lng: 110.8130, name: 'The Park Mall Solo' },
    'hartono mall': { lat: -7.5480, lng: 110.8220, name: 'Hartono Mall' },
    
    // Hospitals - Surakarta
    'rspad': { lat: -7.5580, lng: 110.8200, name: 'RSPAD Surakarta' },
    'rsud dr moewardi': { lat: -7.5550, lng: 110.8500, name: 'RSUD Dr. Moewardi' },
    'rumah sakit moewardi': { lat: -7.5550, lng: 110.8500, name: 'RSUD Dr. Moewardi' },
    
    // Schools - Surakarta
    'sma negeri 1 solo': { lat: -7.5720, lng: 110.8280, name: 'SMA Negeri 1 Surakarta' },
    'sma 1 solo': { lat: -7.5720, lng: 110.8280, name: 'SMA Negeri 1 Surakarta' },
    'sma negeri 3 solo': { lat: -7.5550, lng: 110.8100, name: 'SMA Negeri 3 Surakarta' },
    'sma 3 solo': { lat: -7.5550, lng: 110.8100, name: 'SMA Negeri 3 Surakarta' },
    
    // Government Offices - Surakarta
    'pemkot solo': { lat: -7.5644, lng: 110.8150, name: 'Pemerintah Kota Surakarta' },
    'pemkot surakarta': { lat: -7.5644, lng: 110.8150, name: 'Pemerintah Kota Surakarta' },
    
    // Restaurants & Food Places - Surakarta
    'rumah makan garuda': { lat: -7.5670, lng: 110.8290, name: 'Rumah Makan Garuda Solo' },
    'timlo solo': { lat: -7.5680, lng: 110.8240, name: 'Timlo Solo, Pasar Gede' },
    'selat solo': { lat: -7.5680, lng: 110.8250, name: 'Selat Solo' },
    'pecel pak sutar': { lat: -7.5660, lng: 110.8270, name: 'Pecel Pak Sutar' },
    
    // Transportation Hubs - Surakarta
    'stasiun purwosari': { lat: -7.5680, lng: 110.7980, name: 'Stasiun Purwosari' },
    'terminal tirtonadi': { lat: -7.5770, lng: 110.8400, name: 'Terminal Tirtonadi' },
    'terminal kertosono': { lat: -7.5750, lng: 110.8420, name: 'Terminal Kertosono' },
    'bandara adisumarmo': { lat: -7.5158, lng: 110.7531, name: 'Bandara Adisumarmo' },
    
    // Hotels - Surakarta
    'hotel alana': { lat: -7.5650, lng: 110.8270, name: 'Hotel Alana Solo' },
    'hotel alana solo': { lat: -7.5650, lng: 110.8270, name: 'Hotel Alana Solo' },
    'hotel solo': { lat: -7.5650, lng: 110.8270, name: 'Hotel Solo' },
    'hotel quality solo': { lat: -7.5630, lng: 110.8250, name: 'Hotel Quality Solo' },
    'novotel solo': { lat: -7.5580, lng: 110.8320, name: 'Novotel Solo' },
    'raden hotel': { lat: -7.5670, lng: 110.8300, name: 'Raden Hotel Solo' },
    'raden hotel solo': { lat: -7.5670, lng: 110.8300, name: 'Raden Hotel Solo' },
    
    // Gas Stations - Surakarta
    'pertamina': { lat: -7.5600, lng: 110.8150, name: 'Pertamina Surakarta' },
    'shell': { lat: -7.5450, lng: 110.8100, name: 'Shell Surakarta' },
    'total': { lat: -7.5700, lng: 110.8200, name: 'Total Surakarta' },
    
    // Traditional Markets - Surakarta
    'pasar gede': { lat: -7.5680, lng: 110.8290, name: 'Pasar Gede Bosch Surakarta' },
    'pasar grosir solo': { lat: -7.5600, lng: 110.8220, name: 'Pasar Grosir Solo' },
    'belanja batik': { lat: -7.5640, lng: 110.7950, name: 'Pusat Belanja Batik Laweyan' },
    
    // Parks & Recreation - Surakarta
    'taman balekambang': { lat: -7.5600, lng: 110.8100, name: 'Taman Balekambang Solo' },
    'taman sriwedari': { lat: -7.5680, lng: 110.8210, name: 'Taman Sriwedari Solo' },
    'air terjun grojogan sewu': { lat: -7.4400, lng: 110.9200, name: 'Air Terjun Grojogan Sewu' },
    
    // Universities - Jakarta & Bandung
    'ui': { lat: -6.3619, lng: 106.8250, name: 'Universitas Indonesia' },
    'itb': { lat: -6.8891, lng: 107.6105, name: 'Institut Teknologi Bandung' },
    'ugm': { lat: -7.7731, lng: 110.3773, name: 'Universitas Gadjah Mada' },
    'ipb': { lat: -6.5616, lng: 106.7226, name: 'Institut Pertanian Bogor' },
    
    // Popular Tourist Spots - Jakarta
    'monas': { lat: -6.1751, lng: 106.8650, name: 'Monumen Nasional Jakarta' },
    'ancol': { lat: -6.1277, lng: 106.8418, name: 'Taman Impian Jaya Ancol' },
    'dufan': { lat: -6.1256, lng: 106.8415, name: 'Dufan Ancol Jakarta' },
    'kota tua': { lat: -6.1352, lng: 106.8136, name: 'Kota Tua Jakarta' },
    
    'salatiga': { lat: -7.3307, lng: 110.5084, name: 'Salatiga, Indonesia' },
    'magelang': { lat: -7.4706, lng: 110.2178, name: 'Magelang, Indonesia' },
    'pekalongan': { lat: -6.8887, lng: 109.6753, name: 'Pekalongan, Indonesia' },
    'tegal': { lat: -6.8667, lng: 109.1333, name: 'Tegal, Indonesia' },
    
    // West Java
    'bogor': { lat: -6.5971, lng: 106.8060, name: 'Bogor, Indonesia' },
    'depok': { lat: -6.4025, lng: 106.7942, name: 'Depok, Indonesia' },
    'bekasi': { lat: -6.2383, lng: 106.9756, name: 'Bekasi, Indonesia' },
    'tangerang': { lat: -6.1783, lng: 106.6319, name: 'Tangerang, Indonesia' },
    'cimahi': { lat: -6.8856, lng: 107.5421, name: 'Cimahi, Indonesia' },
    'tasikmalaya': { lat: -7.3276, lng: 108.2208, name: 'Tasikmalaya, Indonesia' },
    'cirebon': { lat: -6.7320, lng: 108.5523, name: 'Cirebon, Indonesia' },
    
    // East Java
    'malang': { lat: -7.9666, lng: 112.6326, name: 'Malang, Indonesia' },
    'kediri': { lat: -7.8164, lng: 112.0122, name: 'Kediri, Indonesia' },
    'jember': { lat: -8.1845, lng: 113.6681, name: 'Jember, Indonesia' },
    'blitar': { lat: -8.0955, lng: 112.1609, name: 'Blitar, Indonesia' },
    'batu': { lat: -7.8714, lng: 112.5234, name: 'Batu, Indonesia' },
    
    // North Sumatra
    'binjai': { lat: 3.6001, lng: 98.4854, name: 'Binjai, Indonesia' },
    'pematangsiantar': { lat: 2.9694, lng: 99.0684, name: 'Pematangsiantar, Indonesia' },
    
    // South Sulawesi
    'parepare': { lat: -4.0143, lng: 119.6375, name: 'Parepare, Indonesia' },
    'palopo': { lat: -2.9935, lng: 120.1969, name: 'Palopo, Indonesia' },
    
    // Bali
    'batubulan': { lat: -8.5333, lng: 115.2833, name: 'Batubulan, Bali, Indonesia' },
    'ubud': { lat: -8.5069, lng: 115.2625, name: 'Ubud, Bali, Indonesia' },
    'kuta': { lat: -8.7074, lng: 115.1749, name: 'Kuta, Bali, Indonesia' }
};

// ========== SAVED ROUTES SYSTEM ==========
// System untuk menyimpan dan memuat rute-rute yang sudah ditetapkan
// Total 6 slot rute (Rute 1-6), Rute 1 adalah default, Rute 2-6 kosong dan bisa diisi user

// Struktur data rute:
// {
//   id: 1,
//   name: "Rute 1",
//   start: { lat: -7.5720, lng: 110.8280, name: "SMA Negeri 1 Surakarta" },
//   end: { lat: -7.5600, lng: 110.8569, name: "Universitas Sebelas Maret" }
// }

// Inisialisasi daftar rute dengan Rute 1 sebagai default
let savedRoutes = [];

// Initialize saved routes pada saat page load
async function initializeSavedRoutes() {
    // 1) Coba load dari Firestore jika user sudah login
    let loadedFromCloud = false;
    if (window.loadUserSavedRoutes && window.onAuthReady) {
        await new Promise(function(resolve) {
            window.onAuthReady(async function(user) {
                try {
                    if (user) {
                        const cloudRoutes = await window.loadUserSavedRoutes();
                        if (Array.isArray(cloudRoutes) && cloudRoutes.length > 0) {
                            savedRoutes = cloudRoutes;
                            loadedFromCloud = true;
                            console.log('✅ Loaded saved routes from Firestore:', savedRoutes.length, 'routes');
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Failed to load saved routes from Firestore:', e);
                } finally {
                    resolve();
                }
            });
        });
    }

    // 2) Jika belum ada, coba load dari localStorage
    if (!loadedFromCloud) {
        const savedRoutesData = localStorage.getItem('senavision_saved_routes');
    if (savedRoutesData) {
        try {
            savedRoutes = JSON.parse(savedRoutesData);
            console.log('✅ Loaded saved routes from localStorage:', savedRoutes.length, 'routes');
        } catch (error) {
            console.error('❌ Error loading saved routes:', error);
            savedRoutes = [];
            }
        }
    }
    
    // Inisialisasi dengan semua rute kosong (semua rute bisa diisi user, termasuk Rute 1)
    if (savedRoutes.length === 0) {
        // Semua rute kosong dan bisa diisi user
        savedRoutes = [
            { id: 1, name: 'Rute 1', start: null, end: null },
            { id: 2, name: 'Rute 2', start: null, end: null },
            { id: 3, name: 'Rute 3', start: null, end: null },
            { id: 4, name: 'Rute 4', start: null, end: null },
            { id: 5, name: 'Rute 5', start: null, end: null },
            { id: 6, name: 'Rute 6', start: null, end: null }
        ];
        
        // Simpan ke localStorage dan Firestore
        saveRoutesToLocalStorage();
        if (typeof saveRoutesToCloud === 'function') saveRoutesToCloud();
        console.log('✅ Initialized empty routes (all 6 routes are empty and can be filled by user)');
    } else {
        // Pastikan selalu ada 6 rute (isi yang kosong jika kurang)
        while (savedRoutes.length < 6) {
            savedRoutes.push({
                id: savedRoutes.length + 1,
                name: 'Rute ' + (savedRoutes.length + 1),
                start: null,
                end: null
            });
        }
        saveRoutesToLocalStorage();
        if (typeof saveRoutesToCloud === 'function') saveRoutesToCloud();
    }
    
    // Render route list setelah inisialisasi
    renderRouteList();

    // Try Firestore sync (non-blocking): if available, load cloud routes and refresh UI
    initializeFirestoreIfAvailable();
    loadRoutesFromFirestore().then(function(loaded) {
        if (loaded) {
            saveRoutesToLocalStorage();
            renderRouteList();
            console.log('✅ Routes synchronized from Firestore');
        }
    }).catch(function(err){
        // Silent fail, keep local cache
        console.warn('⚠️ Firestore load failed (using local cache):', err && err.message ? err.message : err);
    });
}

// Simpan rute ke localStorage (DISABLED - using Firestore only)
function saveRoutesToLocalStorage() {
    // DISABLED: Routes are now stored in Firestore only
    // localStorage no longer used for route persistence
    console.log('⚠️ saveRoutesToLocalStorage called but disabled (using Firestore)');
}

// ===== Firestore Helpers for Routes (Cloud Sync) =====
function initializeFirestoreIfAvailable() {
    try {
        if (window.firebase && firebase.apps && firebase.apps.length) {
            if (!firebaseDb) {
                firebaseDb = firebase.firestore();
                console.log('✅ Firestore ready');
            }
        }
    } catch (e) {
        console.warn('⚠️ Firestore init skipped:', e && e.message ? e.message : e);
    }
}

function getDeviceId() {
    try {
        if (!deviceId) {
            deviceId = localStorage.getItem('senavision_device_id');
            if (!deviceId) {
                deviceId = 'device-' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem('senavision_device_id', deviceId);
            }
        }
        return deviceId;
    } catch (e) {
        // Fallback if localStorage fails
        return 'device-' + Math.random().toString(36).slice(2, 10);
    }
}

function getRoutesCollectionRef() {
    if (!firebaseDb) return null;
    const uid = getDeviceId();
    return firebaseDb.collection('users').doc(uid).collection('routes');
}

async function loadRoutesFromFirestore() {
    const col = getRoutesCollectionRef();
    if (!col) return false;
    try {
        const snapshot = await col.get();
        // Start with 6 empty slots
        const cloudRoutes = [
            { id: 1, name: 'Rute 1', start: null, end: null },
            { id: 2, name: 'Rute 2', start: null, end: null },
            { id: 3, name: 'Rute 3', start: null, end: null },
            { id: 4, name: 'Rute 4', start: null, end: null },
            { id: 5, name: 'Rute 5', start: null, end: null },
            { id: 6, name: 'Rute 6', start: null, end: null }
        ];
        snapshot.forEach(function(doc){
            const data = doc.data() || {};
            const idNum = parseInt(doc.id, 10);
            if (idNum >= 1 && idNum <= 6) {
                cloudRoutes[idNum - 1] = {
                    id: idNum,
                    name: data.name || ('Rute ' + idNum),
                    start: data.start || null,
                    end: data.end || null
                };
            }
        });
        savedRoutes = cloudRoutes;
        return true;
    } catch (e) {
        console.warn('⚠️ Failed to load routes from Firestore:', e && e.message ? e.message : e);
        return false;
    }
}

async function saveRouteToFirestore(route) {
    const col = getRoutesCollectionRef();
    if (!col) return;
    const docRef = col.doc(String(route.id));
    const payload = {
        id: route.id,
        name: route.name || ('Rute ' + route.id),
        start: route.start || null,
        end: route.end || null,
        updatedAt: new Date().toISOString()
    };
    await docRef.set(payload, { merge: true });
}

async function deleteRouteFromFirestore(routeId) {
    const col = getRoutesCollectionRef();
    if (!col) return;
    const docRef = col.doc(String(routeId));
    await docRef.delete();
}

// Ambil rute berdasarkan ID
function getRouteById(routeId) {
    return savedRoutes.find(r => r.id === routeId);
}

// Set rute berdasarkan ID (untuk update/edit rute)
function setRoute(routeId, startLocation, endLocation) {
    const route = getRouteById(routeId);
    if (route) {
        route.start = startLocation;
        route.end = endLocation;
        
        // Save to Firestore via window.saveUserSavedRoutes (uses users/{uid}.savedRoutes)
        if (typeof window.saveUserSavedRoutes === 'function') {
            window.saveUserSavedRoutes(savedRoutes).catch(function(err){
                console.warn('⚠️ Failed to save routes to Firestore:', err && err.message ? err.message : err);
            });
        }
        
        // Also save individual route to users/{uid}/routes/{routeId} for compatibility
        saveRouteToFirestore(route).catch(function(err){
            console.warn('⚠️ Firestore save failed:', err && err.message ? err.message : err);
        });
        
        console.log('✅ Route', routeId, 'updated:', startLocation.name, '→', endLocation.name);
        
        // Update UI if panel is open
        const routePanel = document.getElementById('routeManagementPanel');
        if (routePanel && routePanel.classList.contains('active')) {
            renderRouteList();
        }
        
        return true;
    }
    return false;
}

// Handle command "Rute X" untuk memilih rute yang sudah disimpan
function handleRouteCommand(routeId) {
    pauseRecognitionForNavigatorSpeech({
        autoResume: false,
        suppressMs: 6000,
        statusMessage: '🔇 Mikrofon dimatikan sementara - menyiapkan rute'
    });

    const route = getRouteById(routeId);
    
    if (!route) {
        speakText('Rute ' + routeId + ' tidak ditemukan', 'id-ID', true);
        updateVoiceStatus('❌ Rute ' + routeId + ' tidak ditemukan');
        return;
    }
    
    // Check jika rute sudah diisi (start dan end tidak null)
    if (!route.start || !route.end) {
        speakText('Rute ' + routeId + ' belum diisi. Untuk membuat rute baru, ucapkan "Buat Rute ' + routeId + ' dari [lokasi start] ke [lokasi tujuan]"', 'id-ID', true);
        updateVoiceStatus('⚠️ Rute ' + routeId + ' masih kosong');
        return;
    }
    
    // Stop microphone untuk announcement
    if (isListening && recognition) {
        console.log('🔇 Stopping microphone for route announcement');
        recognition._stopped = true; // Set stopped flag before stopping
        recognition.stop();
        isListening = false;
        console.log('✅ Microphone stopped successfully');
    } else {
        console.log('⚠️ Cannot stop microphone - isListening:', isListening, 'recognition:', !!recognition);
    }
    
    // Set pending announcement data untuk di-announce setelah route calculation
    pendingRouteAnnouncement = {
        routeId: routeId,
        startName: route.start.name,
        endName: route.end.name
    };
    
    // Set destination - ini akan trigger route calculation
    updateDestination(route.end.lat, route.end.lng, route.end.name);
    
    updateVoiceStatus('⏳ Menghitung rute...');
}

// Handle command untuk membuat rute baru
// Format: "Buat Rute X dari [lokasi start] ke [lokasi tujuan]"
function handleCreateRouteCommand(routeId, startLocationName, endLocationName) {
    pauseRecognitionForNavigatorSpeech({
        autoResume: false,
        suppressMs: 6000,
        statusMessage: '🔇 Mikrofon dimatikan sementara - membuat rute baru'
    });

    console.log('🔨 Creating route:', routeId, 'from', startLocationName, 'to', endLocationName);
    
    // Geocode start location
    geocodeLocationForRoute(startLocationName, function(startLocation) {
        if (!startLocation) {
            speakText('Lokasi awal tidak ditemukan: ' + startLocationName, 'id-ID', true);
            updateVoiceStatus('❌ Lokasi awal tidak ditemukan: ' + startLocationName);
            return;
        }
        
        // Geocode end location
        geocodeLocationForRoute(endLocationName, function(endLocation) {
            if (!endLocation) {
                speakText('Lokasi tujuan tidak ditemukan: ' + endLocationName, 'id-ID', true);
                updateVoiceStatus('❌ Lokasi tujuan tidak ditemukan: ' + endLocationName);
                return;
            }
            
            // Set route
            if (setRoute(routeId, startLocation, endLocation)) {
                const route = getRouteById(routeId);
                const announcement = 'Rute ' + routeId + ' berhasil dibuat. Dari ' + 
                    startLocation.name + ' ke ' + endLocation.name + 
                    '. Ucapkan "Rute ' + routeId + '" untuk menggunakan rute ini.';
                
                speakText(announcement, 'id-ID', true);
                updateVoiceStatus('✅ Rute ' + routeId + ' dibuat: ' + startLocation.name + ' → ' + endLocation.name);
            } else {
                speakText('Gagal membuat Rute ' + routeId, 'id-ID', true);
                updateVoiceStatus('❌ Gagal membuat Rute ' + routeId);
            }
        });
    });
}

// Helper function untuk geocoding location untuk route creation
// Mirip dengan geocodeLocation tapi dengan callback
async function geocodeLocationForRoute(locationName, callback) {
    try {
        // Cek dulu di knownCities
        const cityKey = locationName.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            callback({
                lat: city.lat,
                lng: city.lng,
                name: city.name
            });
            return;
        }
        
        // Jika tidak ada, coba geocode dengan Nominatim - GLOBAL SEARCH
        // Removed countrycodes restriction to search worldwide
        const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=10&addressdetails=1&accept-language=id,en`;
        
        const response = await fetch(geocodeUrl);
        const data = await response.json();
        
        if (data && data.length > 0) {
            const result = data[0];
            callback({
                lat: parseFloat(result.lat),
                lng: parseFloat(result.lon),
                name: shortenAddress(result.display_name || result.name)
            });
        } else {
            callback(null);
        }
    } catch (error) {
        console.error('Geocoding error for route:', error);
        callback(null);
    }
}

// ========== ROUTE MANAGEMENT UI FUNCTIONS ==========

// Toggle route management panel visibility
// Updated to work with new sidebar navbar
function toggleRouteManagementPanel() {
    // Use new sidebar navbar instead
    const navbar = document.getElementById('sideNavbar');
    if (navbar) {
        switchNavbarTab('route');
        toggleSideNavbar();
        // Refresh route list when opening
        renderRouteList();
    } else {
        // Fallback to old panel if navbar doesn't exist
        const routePanel = document.getElementById('routeManagementPanel');
        const toggleBtn = document.getElementById('routeManagementToggleBtn');
        const closeBtn = document.getElementById('closeRoutePanelBtn');
        
        if (routePanel && toggleBtn) {
            const isActive = routePanel.classList.contains('active');
            
            if (isActive) {
                routePanel.classList.remove('active');
                toggleBtn.textContent = '🗺️ Kelola Rute';
                if (closeBtn) closeBtn.style.display = 'none';
            } else {
                routePanel.classList.add('active');
                toggleBtn.textContent = '✖️ Tutup';
                if (closeBtn && window.innerWidth <= 768) {
                    closeBtn.style.display = 'block';
                }
                // Refresh route list when opening
                renderRouteList();
            }
        }
    }
}

// Render route list in the UI
function renderRouteList() {
    const routeListContainer = document.getElementById('routeListContainer');
    if (!routeListContainer) return;
    
    // Clear existing content
    routeListContainer.innerHTML = '';
    
    // Render each route
    savedRoutes.forEach(function(route) {
        const routeItem = document.createElement('div');
        routeItem.className = 'route-item' + (route.start && route.end ? '' : ' empty');
        
        const isEmpty = !route.start || !route.end;
        
        routeItem.innerHTML = `
            <div class="route-item-header">
                <span class="route-item-name">${route.name}</span>
                <div class="route-item-actions">
                    <button class="route-item-btn" onclick="editRoute(${route.id})" title="Edit rute">✏️ Edit</button>
                    ${!isEmpty ? `<button class="route-item-btn delete" onclick="deleteRoute(${route.id})" title="Hapus rute">🗑️ Hapus</button>` : ''}
                </div>
            </div>
            <div class="route-item-content ${isEmpty ? 'empty-content' : ''}">
                ${isEmpty 
                    ? '<em>Rute kosong - Klik Edit untuk mengisi</em>' 
                    : `<div class="route-item-path"><strong>Dari:</strong> ${route.start.name}<br><strong>Ke:</strong> ${route.end.name}</div>`
                }
            </div>
        `;
        
        routeListContainer.appendChild(routeItem);
    });
}

// Edit route - load form with route data
function editRoute(routeId) {
    const route = getRouteById(routeId);
    if (!route) {
        console.error('Route not found:', routeId);
        return;
    }
    
    // Show form container
    const formContainer = document.getElementById('routeFormContainer');
    const formTitle = document.getElementById('routeFormTitle');
    const formId = document.getElementById('routeFormId');
    const formEnd = document.getElementById('routeEnd');
    const formStatus = document.getElementById('routeFormStatus');
    const currentLocationText = document.getElementById('currentLocationText');
    const locationSelectionList = document.getElementById('locationSelectionList');
    
    if (!formContainer || !formTitle || !formId || !formEnd) {
        console.error('Route form elements not found');
        return;
    }
    
    // Set form values
    formId.value = routeId;
    formTitle.textContent = `Edit ${route.name}`;
    
    // Update current location display
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        currentLocationText.textContent = `Lokasi saat ini (${userLatLng.lat.toFixed(6)}, ${userLatLng.lng.toFixed(6)})`;
    } else {
        currentLocationText.textContent = 'Menggunakan lokasi saat ini (GPS belum aktif)';
    }
    
    // Set end location
    if (route.end) {
        formEnd.value = route.end.name;
        // Set selected location if route already has end location
        window.selectedEndLocation = {
            lat: route.end.lat,
            lng: route.end.lng,
            name: route.end.name
        };
    } else {
        formEnd.value = '';
        window.selectedEndLocation = null;
    }
    formStatus.innerHTML = '';
    
    // Hide location selection list
    if (locationSelectionList) {
        locationSelectionList.style.display = 'none';
    }
    
    // Hide autocomplete initially
    const autocomplete = document.getElementById('locationAutocomplete');
    if (autocomplete) {
        autocomplete.style.display = 'none';
    }
    
    // Show form and scroll to it
    formContainer.style.display = 'block';
    formContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Update current location display periodically
    updateCurrentLocationDisplay();
    
    // Clear any existing interval first
    if (window.routeFormLocationInterval) {
        clearInterval(window.routeFormLocationInterval);
    }
    
    const locationUpdateInterval = setInterval(updateCurrentLocationDisplay, 2000);
    window.routeFormLocationInterval = locationUpdateInterval;
    
    // Setup autocomplete for route end input
    setupLocationAutocomplete(formEnd);
    
    // Focus on end input
    setTimeout(function() {
        formEnd.focus();
    }, 100);
}

// Update current location display
function updateCurrentLocationDisplay() {
    const currentLocationText = document.getElementById('currentLocationText');
    if (!currentLocationText) return;
    
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        currentLocationText.textContent = `Lokasi saat ini (${userLatLng.lat.toFixed(6)}, ${userLatLng.lng.toFixed(6)})`;
    } else {
        currentLocationText.textContent = 'Menggunakan lokasi saat ini (GPS belum aktif)';
    }
}

// Setup autocomplete for location input
function setupLocationAutocomplete(inputElement) {
    if (!inputElement) return;
    
    const autocomplete = document.getElementById('locationAutocomplete');
    const autocompleteOptions = document.getElementById('autocompleteOptions');
    let searchTimeout = null;
    let currentSuggestions = [];
    let selectedIndex = -1;
    
    if (!autocomplete || !autocompleteOptions) return;
    
    // Clear any existing handlers
    const oldInputHandler = inputElement._autocompleteInputHandler;
    const oldKeyHandler = inputElement._autocompleteKeyHandler;
    const oldBlurHandler = inputElement._autocompleteBlurHandler;
    
    if (oldInputHandler) inputElement.removeEventListener('input', oldInputHandler);
    if (oldKeyHandler) inputElement.removeEventListener('keydown', oldKeyHandler);
    if (oldBlurHandler) inputElement.removeEventListener('blur', oldBlurHandler);
    
    // Input handler with debounce
    const inputHandler = function(e) {
        const query = e.target.value.trim();
        
        // Clear selected location when user types
        window.selectedEndLocation = null;
        
        // Hide old location selection list if exists
        const locationSelectionList = document.getElementById('locationSelectionList');
        if (locationSelectionList) {
            locationSelectionList.style.display = 'none';
        }
        
        // Clear timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        // Hide autocomplete if query is too short
        if (query.length < 2) {
            autocomplete.style.display = 'none';
            currentSuggestions = [];
            selectedIndex = -1;
            return;
        }
        
        // Show loading
        autocomplete.style.display = 'block';
        autocompleteOptions.innerHTML = '<div class="autocomplete-loading">⏳ Mencari lokasi...</div>';
        
        // Debounce search (wait 500ms after user stops typing)
        searchTimeout = setTimeout(async function() {
            try {
                // Search with expanded limit (50 results)
                const results = await geocodeLocationMultiple(query, 50);
                
                if (!results || results.length === 0) {
                    autocompleteOptions.innerHTML = '<div class="autocomplete-no-results">Tidak ada lokasi ditemukan</div>';
                    currentSuggestions = [];
                    selectedIndex = -1;
                    return;
                }
                
                // Store suggestions (limit display to 30 for better performance, but keep all for selection)
                currentSuggestions = results;
                selectedIndex = -1;
                
                // Render suggestions (show first 30, but allow scrolling if more)
                const displayResults = results.slice(0, 30);
                renderAutocompleteOptions(displayResults, results.length > 30 ? results.length : 0);
                
            } catch (error) {
                console.error('Autocomplete error:', error);
                autocompleteOptions.innerHTML = '<div class="autocomplete-no-results">Error: ' + error.message + '</div>';
                currentSuggestions = [];
                selectedIndex = -1;
            }
        }, 500);
    };
    
    // Keyboard navigation handler
    const keyHandler = function(e) {
        if (!autocomplete || autocomplete.style.display === 'none') return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, currentSuggestions.length - 1);
            updateSelectedOption();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelectedOption();
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            selectLocation(currentSuggestions[selectedIndex]);
        } else if (e.key === 'Escape') {
            autocomplete.style.display = 'none';
            selectedIndex = -1;
        }
    };
    
    // Blur handler (hide autocomplete when focus is lost)
    const blurHandler = function(e) {
        // Delay to allow click events on suggestions
        setTimeout(function() {
            if (!autocomplete.contains(document.activeElement)) {
                autocomplete.style.display = 'none';
            }
        }, 200);
    };
    
    // Update selected option visual
    function updateSelectedOption() {
        const options = autocompleteOptions.querySelectorAll('.autocomplete-option');
        options.forEach(function(option, index) {
            if (index === selectedIndex) {
                option.classList.add('selected');
                option.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                option.classList.remove('selected');
            }
        });
    }
    
    // Render autocomplete options
    function renderAutocompleteOptions(results, totalCount = 0) {
        autocompleteOptions.innerHTML = '';
        
        results.forEach(function(location, index) {
            const option = document.createElement('div');
            option.className = 'autocomplete-option';
            option.dataset.index = index;
            
            // Add country badge if available
            const countryBadge = location.country ? `<span class="country-badge">${location.country}</span>` : '';
            
            option.innerHTML = `
                <div class="autocomplete-option-header">
                    <div class="autocomplete-option-name">${location.name}</div>
                    ${countryBadge}
                </div>
                <div class="autocomplete-option-address">${location.full_address}</div>
            `;
            
            option.addEventListener('click', function() {
                selectLocation(location);
            });
            
            option.addEventListener('mouseenter', function() {
                selectedIndex = index;
                updateSelectedOption();
            });
            
            autocompleteOptions.appendChild(option);
        });
        
        // Show count if there are more results
        if (totalCount > results.length) {
            const moreInfo = document.createElement('div');
            moreInfo.className = 'autocomplete-more-info';
            moreInfo.textContent = `Menampilkan ${results.length} dari ${totalCount} hasil. Scroll untuk melihat lebih banyak.`;
            autocompleteOptions.appendChild(moreInfo);
        }
    }
    
    // Select location from autocomplete
    function selectLocation(location) {
        // Set input value
        inputElement.value = location.name;
        
        // Store selected location
        window.selectedEndLocation = {
            lat: location.lat,
            lng: location.lng,
            name: location.name
        };
        
        // Hide autocomplete
        autocomplete.style.display = 'none';
        selectedIndex = -1;
        
        // Focus back to input
        inputElement.focus();
    }
    
    // Store handlers
    inputElement._autocompleteInputHandler = inputHandler;
    inputElement._autocompleteKeyHandler = keyHandler;
    inputElement._autocompleteBlurHandler = blurHandler;
    
    // Add event listeners
    inputElement.addEventListener('input', inputHandler);
    inputElement.addEventListener('keydown', keyHandler);
    inputElement.addEventListener('blur', blurHandler);
}

// Cancel route form
function cancelRouteForm() {
    const formContainer = document.getElementById('routeFormContainer');
    if (formContainer) {
        formContainer.style.display = 'none';
        
        // Reset form
        const form = document.getElementById('routeForm');
        if (form) form.reset();
        
        const formStatus = document.getElementById('routeFormStatus');
        if (formStatus) formStatus.innerHTML = '';
        
        // Hide location selection list
        const locationSelectionList = document.getElementById('locationSelectionList');
        if (locationSelectionList) {
            locationSelectionList.style.display = 'none';
        }
        
        // Hide autocomplete
        const autocomplete = document.getElementById('locationAutocomplete');
        if (autocomplete) {
            autocomplete.style.display = 'none';
        }
        
        // Clear selected location
        window.selectedEndLocation = null;
        
        // Clear location update interval
        if (window.routeFormLocationInterval) {
            clearInterval(window.routeFormLocationInterval);
            window.routeFormLocationInterval = null;
        }
    }
}

// Save route from form
async function saveRouteFromForm(event) {
    event.preventDefault();
    
    const formId = document.getElementById('routeFormId');
    const formEnd = document.getElementById('routeEnd');
    const formStatus = document.getElementById('routeFormStatus');
    const locationSelectionList = document.getElementById('locationSelectionList');
    
    if (!formId || !formEnd || !formStatus) {
        console.error('Form elements not found');
        return;
    }
    
    const routeId = parseInt(formId.value);
    const endName = formEnd.value.trim();
    
    // Check if user has selected a location from multiple results
    if (window.selectedEndLocation) {
        // User selected from multiple results, use selected location
        const startLocation = getCurrentLocationAsStart();
        if (!startLocation) {
            formStatus.innerHTML = '❌ Lokasi GPS belum aktif. Pastikan GPS aktif dan izin lokasi diberikan.';
            formStatus.className = 'route-form-status error';
            return;
        }
        
        const endLocation = window.selectedEndLocation;
        
        // Save route
        if (setRoute(routeId, startLocation, endLocation)) {
            formStatus.innerHTML = '✅ Rute berhasil disimpan!';
            formStatus.className = 'route-form-status success';
            
            renderRouteList();
            
            setTimeout(function() {
                cancelRouteForm();
                const route = getRouteById(routeId);
                if (route) {
                    speakText(route.name + ' berhasil disimpan. Dari lokasi saat ini ke ' + endLocation.name, 'id-ID', true);
                }
            }, 1500);
        } else {
            formStatus.innerHTML = '❌ Gagal menyimpan rute';
            formStatus.className = 'route-form-status error';
        }
        return;
    }
    
    // If no selection made, check if end location is filled
    if (!endName) {
        formStatus.innerHTML = '❌ Lokasi tujuan harus diisi! Pilih dari daftar yang muncul saat mengetik.';
        formStatus.className = 'route-form-status error';
        return;
    }
    
    // If user typed but didn't select from autocomplete, prompt to select
    if (!window.selectedEndLocation) {
        formStatus.innerHTML = '❌ Silakan pilih lokasi dari daftar yang muncul saat mengetik. Ketik minimal 2 karakter untuk melihat pilihan.';
        formStatus.className = 'route-form-status error';
        
        // Show autocomplete if hidden
        const autocomplete = document.getElementById('locationAutocomplete');
        const formEnd = document.getElementById('routeEnd');
        if (autocomplete && formEnd && formEnd.value.trim().length >= 2) {
            // Trigger search again
            if (formEnd._autocompleteInputHandler) {
                formEnd._autocompleteInputHandler({ target: formEnd });
            }
        }
        return;
    }
    
    // Get current location as start
    const startLocation = getCurrentLocationAsStart();
    if (!startLocation) {
        formStatus.innerHTML = '❌ Lokasi GPS belum aktif. Pastikan GPS aktif dan izin lokasi diberikan.';
        formStatus.className = 'route-form-status error';
        return;
    }
    
    // Use selected location from autocomplete
    const endLocation = window.selectedEndLocation;
    
    // Show loading status
    formStatus.innerHTML = '⏳ Menyimpan rute...';
    formStatus.className = 'route-form-status loading';
    
    // Disable form
    const form = document.getElementById('routeForm');
    if (form) {
        const inputs = form.querySelectorAll('input, button');
        inputs.forEach(function(input) {
            input.disabled = true;
        });
    }
    
    try {
        // Save route
        if (setRoute(routeId, startLocation, endLocation)) {
            formStatus.innerHTML = '✅ Rute berhasil disimpan!';
            formStatus.className = 'route-form-status success';
            
            renderRouteList();
            
            setTimeout(function() {
                cancelRouteForm();
                const route = getRouteById(routeId);
                if (route) {
                    speakText(route.name + ' berhasil disimpan. Dari lokasi saat ini ke ' + endLocation.name, 'id-ID', true);
                }
            }, 1500);
        } else {
            throw new Error('Gagal menyimpan rute');
        }
    } catch (error) {
        console.error('Error saving route:', error);
        formStatus.innerHTML = '❌ ' + error.message;
        formStatus.className = 'route-form-status error';
    } finally {
        // Re-enable form
        if (form) {
            const inputs = form.querySelectorAll('input, button');
            inputs.forEach(function(input) {
                input.disabled = false;
            });
        }
    }
}

// Get current location as start location object
function getCurrentLocationAsStart() {
    if (!currentUserPosition) {
        return null;
    }
    
    const userLatLng = currentUserPosition.getLatLng();
    return {
        lat: userLatLng.lat,
        lng: userLatLng.lng,
        name: 'Lokasi Saat Ini'
    };
}

// Display location options for user to select
function displayLocationOptions(locations, routeId, startLocation) {
    const locationSelectionList = document.getElementById('locationSelectionList');
    const locationOptions = document.getElementById('locationOptions');
    
    if (!locationSelectionList || !locationOptions) {
        console.error('Location selection elements not found');
        return;
    }
    
    // Clear previous options
    locationOptions.innerHTML = '';
    
    // Create option for each location
    locations.forEach(function(location, index) {
        const option = document.createElement('div');
        option.className = 'location-option';
        option.dataset.index = index;
        
        option.innerHTML = `
            <div class="location-option-name">${location.name}</div>
            <div class="location-option-address">${location.full_address}</div>
        `;
        
        option.addEventListener('click', function() {
            // Remove previous selection
            locationOptions.querySelectorAll('.location-option').forEach(function(opt) {
                opt.classList.remove('selected');
            });
            
            // Mark as selected
            option.classList.add('selected');
            
            // Store selected location
            window.selectedEndLocation = {
                lat: location.lat,
                lng: location.lng,
                name: location.name
            };
            
            // Auto-save route after selection
            const formStatus = document.getElementById('routeFormStatus');
            if (formStatus) {
                formStatus.innerHTML = '⏳ Menyimpan rute...';
                formStatus.className = 'route-form-status loading';
            }
            
            // Save route
            if (setRoute(routeId, startLocation, window.selectedEndLocation)) {
                if (formStatus) {
                    formStatus.innerHTML = '✅ Rute berhasil disimpan!';
                    formStatus.className = 'route-form-status success';
                }
                
                renderRouteList();
                
                setTimeout(function() {
                    cancelRouteForm();
                    const route = getRouteById(routeId);
                    if (route) {
                        speakText(route.name + ' berhasil disimpan. Dari lokasi saat ini ke ' + window.selectedEndLocation.name, 'id-ID', true);
                    }
                }, 1500);
            } else {
                if (formStatus) {
                    formStatus.innerHTML = '❌ Gagal menyimpan rute';
                    formStatus.className = 'route-form-status error';
                }
            }
        });
        
        locationOptions.appendChild(option);
    });
    
    // Show selection list
    locationSelectionList.style.display = 'block';
    locationSelectionList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Delete route
function deleteRoute(routeId) {
    const route = getRouteById(routeId);
    if (!route) {
        console.error('Route not found:', routeId);
        return;
    }
    
    // Confirm deletion
    if (!confirm('Apakah Anda yakin ingin menghapus ' + route.name + '?\n\n' + 
                'Dari: ' + route.start.name + '\n' + 
                'Ke: ' + route.end.name)) {
        return;
    }
    
    // Clear route data
    route.start = null;
    route.end = null;
    
    // Save to Firestore via window.saveUserSavedRoutes (uses users/{uid}.savedRoutes)
    if (typeof window.saveUserSavedRoutes === 'function') {
        window.saveUserSavedRoutes(savedRoutes).catch(function(err){
            console.warn('⚠️ Failed to save routes to Firestore:', err && err.message ? err.message : err);
        });
    }
    
    // Also remove individual route from users/{uid}/routes/{routeId} for compatibility
    deleteRouteFromFirestore(routeId).catch(function(err){
        console.warn('⚠️ Firestore delete failed:', err && err.message ? err.message : err);
    });
    
    // Refresh route list
    renderRouteList();
    
    // Announce deletion
    speakText(route.name + ' telah dihapus', 'id-ID', true);
    console.log('✅ Route', routeId, 'deleted');
}

// Helper function: Geocode location and return Promise (single result)
function geocodeLocationPromise(locationName) {
    return new Promise(function(resolve, reject) {
        // Check known cities first
        const cityKey = locationName.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            resolve({
                lat: city.lat,
                lng: city.lng,
                name: city.name
            });
            return;
        }
        
        // Try geocoding with Nominatim - GLOBAL SEARCH
        // Removed countrycodes restriction to search worldwide
        // Increased limit for better results
        const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=10&addressdetails=1&accept-language=id,en`;
        
        fetch(geocodeUrl)
            .then(function(response) {
                return response.json();
            })
            .then(function(data) {
                if (data && data.length > 0) {
                    const result = data[0];
                    resolve({
                        lat: parseFloat(result.lat),
                        lng: parseFloat(result.lon),
                        name: shortenAddress(result.display_name || result.name)
                    });
                } else {
                    reject(new Error('Lokasi tidak ditemukan: ' + locationName));
                }
            })
            .catch(function(error) {
                console.error('Geocoding error:', error);
                reject(new Error('Error saat mencari lokasi: ' + error.message));
            });
    });
}

// Helper function: Geocode location and return multiple results (for selection)
// Expanded to search globally with more results
function geocodeLocationMultiple(locationName, limit = 100) {
    return new Promise(function(resolve, reject) {
        // Check known cities first
        const cityKey = locationName.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            resolve([{
                lat: city.lat,
                lng: city.lng,
                name: city.name,
                display_name: city.name,
                full_address: city.name
            }]);
            return;
        }
        
        // Try geocoding with Nominatim - EXPANDED SEARCH
        // Removed countrycodes restriction to search globally
        // Increased limit to 50 results for more options
        // Added addressdetails=1 for better address information
        const geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=${limit}&addressdetails=1&extratags=1&accept-language=id,en`;
        
        fetch(geocodeUrl, {
            headers: {
                'User-Agent': 'SenaVision Navigation App'
            }
        })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Geocoding service error: ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                if (data && data.length > 0) {
                    // Sort results: prioritize Indonesia, then nearby countries, then others
                    const sortedData = data.sort(function(a, b) {
                        const aIsIndonesia = (a.address && a.address.country_code === 'id') || 
                                           (a.address && a.address.country === 'Indonesia');
                        const bIsIndonesia = (b.address && b.address.country_code === 'id') || 
                                           (b.address && b.address.country === 'Indonesia');
                        
                        if (aIsIndonesia && !bIsIndonesia) return -1;
                        if (!aIsIndonesia && bIsIndonesia) return 1;
                        return 0;
                    });
                    
                    const results = sortedData.map(function(result) {
                        // Build better address string
                        let addressParts = [];
                        if (result.address) {
                            if (result.address.road) addressParts.push(result.address.road);
                            if (result.address.suburb || result.address.neighbourhood) {
                                addressParts.push(result.address.suburb || result.address.neighbourhood);
                            }
                            if (result.address.city || result.address.town || result.address.village) {
                                addressParts.push(result.address.city || result.address.town || result.address.village);
                            }
                            if (result.address.state) addressParts.push(result.address.state);
                            if (result.address.country) addressParts.push(result.address.country);
                        }
                        
                        const fullAddress = addressParts.length > 0 
                            ? addressParts.join(', ') 
                            : (result.display_name || result.name);
                        
                        return {
                            lat: parseFloat(result.lat),
                            lng: parseFloat(result.lon),
                            name: shortenAddress(result.display_name || result.name),
                            display_name: result.display_name || result.name,
                            full_address: fullAddress,
                            country: result.address ? (result.address.country || '') : '',
                            type: result.type || result.class || ''
                        };
                    });
                    resolve(results);
                } else {
                    reject(new Error('Lokasi tidak ditemukan: ' + locationName));
                }
            })
            .catch(function(error) {
                console.error('Geocoding error:', error);
                reject(new Error('Error saat mencari lokasi: ' + error.message));
            });
    });
}

// Initialize routes saat page load
initializeSavedRoutes();

// Handle voice commands
function handleVoiceCommand(transcript) {
    // Convert transcript to lowercase and clean up for easier matching
    let command = transcript.toLowerCase().trim();
    
    // Remove punctuation for better matching
    const cleanCommand = command.replace(/[.,;:!?]/g, '').trim();
    
    console.log('Handling voice command. Original:', transcript, '| Cleaned:', cleanCommand);
    
    // Show what was recognized
    updateVoiceStatus('🎤 Aku mendengar: "' + transcript + '"');
    
    // Voice trigger commands - "Halo" is required to activate microphone
    // This is the primary way to activate microphone (works even during navigation)
    if (cleanCommand === 'halo' || cleanCommand === 'hello' || cleanCommand === 'aktivasi' || cleanCommand === 'activate' || cleanCommand === 'buka mikrofon' || cleanCommand === 'aktifkan') {
        // Mark user interaction when voice command is received (voice counts as interaction)
        hasUserInteraction = true;
        console.log('✅ "Halo" command detected - hasUserInteraction set to true');
        
        if (!recognition) {
            console.log('🔧 Initializing speech recognition...');
            initSpeechRecognition();
        }
        
        pauseRecognitionForNavigatorSpeech({
            autoResume: true,
            resumeDelay: 1600,
            suppressMs: 2000,
            statusMessage: '🔇 Navigator menjelaskan - mikrofon akan aktif setelah suara selesai'
        });
        
        const resumeStatus = isNavigating
            ? '🎤 Mikrofon aktif kembali. Sebutkan tujuan baru atau ucapkan nama rute.'
            : '🎤 Mikrofon aktif. Ucapkan nama rute atau sebutkan tujuan Anda.';
        const resumeSpeech = isNavigating
            ? 'Mikrofon aktif kembali. Sebutkan tujuan baru atau ucapkan nama rute untuk mengubah rute'
            : 'Mikrofon aktif. Ucapkan nama rute seperti "Rute Satu" atau sebutkan nama kota atau lokasi tujuan Anda';
        
        speakText(resumeSpeech, 'id-ID', true, function() {
            updateVoiceStatus(resumeStatus);
        });
        
        return;
    }
    
    // Check for route commands - "Rute X" untuk memilih rute yang sudah disimpan
    // Pattern: "rute 1", "rute satu", "rute 2", "rute dua", dll.
    // Support both numbers (1-6) and Indonesian words (satu, dua, tiga, empat, lima, enam)
    const routeNumberMap = {
        'satu': 1, '1': 1,
        'dua': 2, '2': 2,
        'tiga': 3, '3': 3,
        'empat': 4, '4': 4,
        'lima': 5, '5': 5,
        'enam': 6, '6': 6
    };
    
    // Try to match "rute [number or word]"
    const routeMatch = cleanCommand.match(/^rute\s+(satu|dua|tiga|empat|lima|enam|\d+)$/);
    if (routeMatch) {
        const routeWord = routeMatch[1].toLowerCase();
        const routeId = routeNumberMap[routeWord];
        
        if (routeId) {
            console.log('✅ Route command detected: Rute', routeId);
            handleRouteCommand(routeId);
            return;
        }
    }
    
    // Also try simple number pattern as fallback
    const routeMatchNumber = cleanCommand.match(/^rute\s*(\d+)$/);
    if (routeMatchNumber) {
        const routeId = parseInt(routeMatchNumber[1]);
        console.log('✅ Route command detected (number): Rute', routeId);
        if (routeId >= 1 && routeId <= 6) {
            handleRouteCommand(routeId);
            return;
        } else {
            speakText('Rute hanya tersedia dari Rute Satu sampai Rute Enam', 'id-ID', true);
            updateVoiceStatus('❌ Rute hanya 1-6');
            return;
        }
    }
    
    // Check for create route commands - "Buat Rute X dari [start] ke [end]"
    // Pattern: "buat rute 2 dari jakarta ke bandung" or "buat rute dua dari jakarta ke bandung"
    const createRouteMatch = cleanCommand.match(/^buat\s+rute\s+(satu|dua|tiga|empat|lima|enam|\d+)\s+dari\s+(.+?)\s+ke\s+(.+)$/);
    if (createRouteMatch) {
        const routeWord = createRouteMatch[1].toLowerCase();
        const routeId = routeNumberMap[routeWord] || parseInt(routeWord);
        const startLocation = createRouteMatch[2].trim();
        const endLocation = createRouteMatch[3].trim();
        console.log('✅ Create route command detected: Rute', routeId, 'from', startLocation, 'to', endLocation);
        
        if (routeId >= 1 && routeId <= 6) {
            handleCreateRouteCommand(routeId, startLocation, endLocation);
            return;
        } else {
            speakText('Rute hanya tersedia dari Rute Satu sampai Rute Enam', 'id-ID', true);
            updateVoiceStatus('❌ Rute hanya 1-6');
            return;
        }
    }
    
    // Check for "Ganti Rute" command
    if (cleanCommand === 'ganti rute' || cleanCommand === 'ganti' || cleanCommand.includes('ubah rute')) {
        console.log('✅ Ganti Rute command detected:', cleanCommand);
        
        pauseRecognitionForNavigatorSpeech({
            autoResume: false,
            suppressMs: 3000,
            statusMessage: '🔇 Mikrofon dimatikan sementara - mengganti rute'
        });
        
        // Stop microphone untuk announcement
        if (isListening && recognition) {
            console.log('🔇 Stopping microphone for "Ganti Rute" announcement');
            recognition.stop();
            isListening = false;
        }
        
        // Clear any existing waiting flags and cancel timer to prevent old timers from interfering
        // This prevents old 10-second auto-stop timers from stopping the mic after "Ganti Rute"
        if (recognition) {
            recognition._waitingForNavigasi = false;
            // Cancel old timer if it exists
            if (recognition._navigasiTimer) {
                clearTimeout(recognition._navigasiTimer);
                recognition._navigasiTimer = null;
                console.log('🛑 Cancelled old navigasi timer');
            }
            // Clear stopped flag to allow restart after announcement
            recognition._stopped = false;
        }
        
        speakText('Berganti Rute. Sebutkan Rute yang ingin anda tuju', 'id-ID', true, function() {
            console.log('✅ "Ganti Rute" announcement finished - restarting microphone');
            // Restart microphone untuk mendengarkan nama rute baru
            setTimeout(function() {
                if (recognition && !isListening) {
                    try {
                        recognition.start();
                        isListening = true;
                        console.log('🎤 Microphone restarted - listening for route selection');
                        
                        // No auto-stop timer here - user can take as long as needed to say route number
                        // Timer will only stop if user says a valid route command (handled elsewhere)
                    } catch (error) {
                        console.error('Failed to restart microphone:', error);
                        recognition._stopped = true;
                    }
                }
            }, 500);
        });
        
        return;
    }
    
    // Check for "Mode 2" command - redirect to mode-detector page
    if (cleanCommand === 'mode 2' || cleanCommand === 'mode dua' || cleanCommand === 'mode detector') {
        console.log('✅ Mode 2 command detected:', cleanCommand);
        
        pauseRecognitionForNavigatorSpeech({
            autoResume: false,
            suppressMs: 2000,
            statusMessage: '🔇 Mengarahkan ke Mode Detektor...'
        });
        
        // Stop microphone first
        if (isListening && recognition) {
            recognition._stopped = true;
            recognition.stop();
            isListening = false;
        }
        
        // Announce redirect and then navigate to mode-detector page
        speakText('Mengarahkan ke Mode Detektor', 'id-ID', true, function() {
            // Redirect to mode-detector page
            // Path relative from map/map.html to mode-detector/index.html
            const modeDetectorPath = '../mode-detector/index.html';
            console.log('🔄 Redirecting to mode-detector:', modeDetectorPath);
            
            // Use window.location for navigation
            window.location.href = modeDetectorPath;
        });
        
        return;
    }
    
    // Check for "Stop" command - behavior depends on navigation state
    if (cleanCommand === 'stop' || cleanCommand === 'selesai' || cleanCommand === 'keluar') {
        console.log('✅ Stop command detected:', cleanCommand);
        
        // Stop microphone first
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        // Check if navigation is active
        if (isNavigating) {
            // CANCEL NAVIGATION - Return to Activation point 2
            console.log('🚫 Canceling active navigation');
            isNavigating = false;
            announcedInstructions = [];
            lastAnnouncedInstruction = null;
            
            // Nonaktifkan flag navigasi di SpeechCoordinator
            if (typeof window.SpeechCoordinator !== 'undefined') {
                window.SpeechCoordinator.setNavigating(false);
            }
            
            // Deactivate Mode Detector saat navigasi dibatalkan
            if (typeof window.ModeDetector !== 'undefined') {
                const modeDetectorState = window.ModeDetector.getState();
                if (modeDetectorState.isActive) {
                    console.log('🔄 Deactivating Mode Detector - navigation cancelled');
                    window.ModeDetector.deactivate();
                    console.log('✅ Mode Detector deactivated');
                }
            }
            
            // Announce cancellation
            speakText('Navigasi Di Batalkan', 'id-ID', true, function() {
                // Restart microphone for new commands (without additional speech)
                setTimeout(function() {
                    if (recognition && !isListening) {
                        try {
                            recognition.start();
                            isListening = true;
                            recognition._stopped = false;
                            suppressMicActivationSpeech = false;
                            console.log('🎤 Microphone reactivated after navigation cancellation');
                            updateVoiceStatus('🎤 Mikrofon aktif - Pilih rute atau tujuan');
                        } catch (error) {
                            console.error('Failed to restart microphone:', error);
                            recognition._stopped = true;
                        }
                    }
                }, 500);
            });
            
            updateVoiceStatus('🚫 Navigasi dibatalkan');
            return;
        } else {
            // TURN OFF SenaVision completely
            console.log('🔴 Turning off SenaVision');
            if (recognition) {
                recognition._stopped = true;
            }
            
            // Announce app is off
            speakText('Senavision Off', 'id-ID', true);
            updateVoiceStatus('🔴 Senavision Off');
        }
        
        return;
    }
    
    // Check for navigation commands - "Navigasi" will STOP microphone
    console.log('🔍 Checking navigation command. cleanCommand:', cleanCommand);
    
    if (cleanCommand === 'navigasi' || cleanCommand === 'mulai' || 
        cleanCommand.includes('mulai rute') || cleanCommand.includes('mulai navigasi') || cleanCommand.includes('ikut rute')) {
        console.log('✅ Navigation command detected:', cleanCommand);
        
        pauseRecognitionForNavigatorSpeech({
            autoResume: false,
            suppressMs: 6000,
            statusMessage: '🔇 Mikrofon dimatikan sementara - menyiapkan navigasi'
        });
        
        suppressMicActivationSpeech = true;
        
        // CRITICAL: Jangan clear stopped flag di sini
        // Mikrofon akan di-set sebagai stopped di startTurnByTurnNavigation()
        // Mikrofon MATI setelah "Navigasi" - user harus ucapkan "Halo" atau klik untuk restart
        
        startTurnByTurnNavigation();
        return;
    }
    
    console.log('❌ Not a navigation command, continuing to city check...');
    
    // Check if command is a known city name directly
    // Use cleanCommand that already has punctuation removed
    const cityKey = cleanCommand;
    console.log('Checking for city:', cityKey);
    console.log('Known cities:', Object.keys(knownCities));
    
    if (knownCities[cityKey]) {
        console.log('Found city:', cityKey, knownCities[cityKey]);
        const city = knownCities[cityKey];
        
        // Stop microphone briefly to announce destination, then restart for "Navigasi" command
        // Keep microphone active for 10 seconds to listen for "Navigasi" command
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        // Announce destination for known cities
        speakText('Tujuan Anda adalah ' + city.name, 'id-ID', true, function() {
            // After announcing destination, give instruction before asking for "Navigasi" command
            speakText('Jika ingin mengganti tujuan sebutkan lokasi dan jika tidak katakan navigasi untuk memulai perjalanan', 'id-ID', true, function() {
                // Restart microphone to listen for "Navigasi" command (window of 10 seconds)
                setTimeout(function() {
                    if (recognition && !isListening) {
                        try {
                            recognition.start();
                            isListening = true;
                            recognition._waitingForNavigasi = true; // Flag to mark waiting for Navigasi
                            console.log('🎤 Microphone restarted - listening for "Navigasi" command (10 second window)');
                            
                            // Auto-stop after 10 seconds if "Navigasi" not said
                            // Store timer ID so we can cancel it if user says "Ganti Rute" before timer expires
                            recognition._navigasiTimer = setTimeout(function() {
                                if (recognition && recognition._waitingForNavigasi && isListening) {
                                    recognition.stop();
                                    recognition._stopped = true;
                                    recognition._waitingForNavigasi = false;
                                    recognition._navigasiTimer = null;
                                    isListening = false;
                                    console.log('🔇 Microphone stopped - "Navigasi" window expired, say "Halo" to restart');
                                    updateVoiceStatus('✅ Tujuan: ' + city.name + ' - Ucapkan "Halo" lalu "Navigasi" untuk memulai');
                                }
                            }, 10000); // 10 second window
                        } catch (error) {
                            console.error('Failed to restart microphone:', error);
                            recognition._stopped = true;
                        }
                    }
                }, 500);
            });
        });
        
        updateDestination(city.lat, city.lng, city.name);
        updateVoiceStatus('✅ Tujuan: ' + city.name + ' - Ucapkan "Navigasi" untuk memulai');
        return;
    } else {
        console.log('City NOT found:', cityKey);
    }
    
    // Try to extract location from command (supports both English and Indonesian)
    // English: "go to <location>", "navigate to <location>"
    // Indonesian: "pergi ke <location>", "navigasi ke <location>", "ke <location>"
    let location = extractLocation(command);
    
    if (location) {
        // Get current user location if available
        let userLatLng = null;
        if (currentUserPosition) {
            userLatLng = currentUserPosition.getLatLng();
            console.log('📍 Searching near user location:', userLatLng);
        }
        
        // Geocode the location with proximity to user location
        geocodeLocation(location, userLatLng);
        
        // Keep microphone listening for more commands (hands-free for blind users)
        // Don't auto-stop - user can give more voice commands
    } else {
        updateVoiceStatus('❓ Tidak mengerti lokasi. Coba sebutkan nama daerah, desa, atau kota seperti: "Jakarta", "Bogor", "Ubud"');
    }
}

// Start route navigation
function startRouteNavigation() {
    if (!route) {
        speakText('Rute belum ditetapkan. Silakan sebutkan tujuan terlebih dahulu.', 'id-ID', true);
        updateVoiceStatus('⚠️ Setel tujuan terlebih dahulu');
        return;
    }
    
    speakText('Memulai navigasi. Ikuti petunjuk arah.', 'id-ID', true);
    updateVoiceStatus('📍 Navigasi dimulai');
    
    // Keep microphone listening for more commands (hands-free for blind users)
    // Don't auto-stop - user can change destination or ask for help
}

// Start turn-by-turn navigation with real-time voice directions (Google Maps style)
function startTurnByTurnNavigation() {
    pendingAutoMicResume = false;

    // Check if route data exists
    if (!route) {
        suppressMicActivationSpeech = false;
        speakText('Rute belum ditetapkan. Silakan sebutkan tujuan terlebih dahulu.', 'id-ID', true);
        updateVoiceStatus('⚠️ Setel tujuan terlebih dahulu');
        return;
    }
    
    if (!currentUserPosition) {
        suppressMicActivationSpeech = false;
        speakText('Lokasi Anda tidak terdeteksi. Pastikan GPS aktif.', 'id-ID', true);
        updateVoiceStatus('⚠️ Lokasi tidak terdeteksi');
        return;
    }
    
    // CRITICAL: Setelah "Navigasi" dikatakan, mikrofon HARUS MATI
    // Mikrofon hanya bisa diaktifkan lagi dengan "Halo" atau klik layar
    if (recognition) {
        // Set stopped flag - mikrofon mati setelah "Navigasi"
        recognition._stopped = true;
        console.log('🔇 Microphone stopped after "Navigasi" command - user must say "Halo" or click to reactivate');
        
        if (recognition._waitingForNavigasi) {
            recognition._waitingForNavigasi = false; // Clear waiting flag - we got Navigasi command
            // Also cancel the timer if it exists
            if (recognition._navigasiTimer) {
                clearTimeout(recognition._navigasiTimer);
                recognition._navigasiTimer = null;
            }
            console.log('✅ "Navigasi" command received - canceling auto-stop timer');
        }
    }
    
    // Stop microphone - mikrofon MATI setelah "Navigasi"
    if (isListening && recognition) {
        recognition.stop();
        isListening = false;
        console.log('🔇 Microphone stopped - navigation started, say "Halo" or click to reactivate');
    }
    
    // Aktifkan flag navigasi di SpeechCoordinator - memungkinkan kedua suara berbicara bergantian
    if (typeof window.SpeechCoordinator !== 'undefined') {
        window.SpeechCoordinator.setNavigating(true);
    }
    
    // Aktifkan Mode Detector di background saat navigasi dimulai
    // Mode detector akan berjalan bersamaan dengan navigasi GPS
    if (typeof window.ModeDetector !== 'undefined') {
        console.log('🔄 Activating Mode Detector in background for navigation...');
        const modeDetectorState = window.ModeDetector.getState();
        
        if (!modeDetectorState.isActive) {
            // Initialize dan activate mode detector jika belum aktif
            window.ModeDetector.init().then(function(initSuccess) {
                if (initSuccess) {
                    window.ModeDetector.activate().then(function(activateSuccess) {
                        if (activateSuccess) {
                            console.log('✅ Mode Detector activated in background - running alongside navigation');
                            // Tidak perlu announce - mode detector berjalan silent di background
                        } else {
                            console.warn('⚠️ Failed to activate Mode Detector - navigation will continue without object detection');
                        }
                    }).catch(function(error) {
                        console.error('❌ Error activating Mode Detector:', error);
                        // Navigation tetap berjalan meskipun mode detector gagal
                    });
                } else {
                    console.warn('⚠️ Failed to initialize Mode Detector - navigation will continue without object detection');
                }
            }).catch(function(error) {
                console.error('❌ Error initializing Mode Detector:', error);
                // Navigation tetap berjalan meskipun mode detector gagal
            });
        } else {
            console.log('✅ Mode Detector already active - will continue running during navigation');
        }
    } else {
        console.log('ℹ️ Mode Detector not available - navigation will continue without object detection');
    }
    
    // CRITICAL: Fokus peta ke lokasi user saat ini saat navigasi dimulai
    // Ini memastikan user selalu melihat posisi mereka di peta
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        map.setView(userLatLng, 16, { animate: true, duration: 0.5 });
        console.log('📍 Map focused on user location at start of navigation:', userLatLng.lat.toFixed(6), userLatLng.lng.toFixed(6));
    }
    
    // Announce start of navigation and read full route details
    speakText('Memulai navigasi.', 'id-ID', true, function() {
        // Announce full route summary (distance, time, and directions)
        announceRouteDirections(true, function() {
            // After route announced, announce first few instructions
            announceFirstDirections(function() {
                // MODIFIED: Setelah semua announcement selesai, restart mikrofon untuk menerima command "Mode 2"
                // Tunggu hingga semua announcement benar-benar selesai (termasuk queue)
                // Kita perlu menunggu beberapa kali untuk memastikan queue benar-benar kosong
                let consecutiveEmptyChecks = 0;
                const requiredEmptyChecks = 3; // Butuh 3 check berturut-turut yang kosong untuk memastikan benar-benar selesai
                
                const waitForAllSpeechComplete = function(checkCount = 0) {
                    const maxChecks = 120; // Maximum 60 seconds (120 * 500ms)
                    
                    // Check if speech synthesis is still speaking OR if queue is not empty
                    const speechSynthesisSpeaking = (typeof window.speechSynthesis !== 'undefined') ? window.speechSynthesis.speaking : false;
                    const queueLength = (typeof announcementQueue !== 'undefined') ? announcementQueue.length : 0;
                    const queueEmpty = queueLength === 0;
                    const isSpeakingVar = (typeof isSpeaking !== 'undefined') ? isSpeaking : false;
                    const pendingUtterances = (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.pending !== undefined) ? window.speechSynthesis.pending : false;
                    
                    // Check if everything is really done
                    const allDone = !speechSynthesisSpeaking && queueEmpty && !isSpeakingVar && !pendingUtterances;
                    
                    if (allDone) {
                        consecutiveEmptyChecks++;
                        console.log('✅ Speech appears complete (check ' + consecutiveEmptyChecks + '/' + requiredEmptyChecks + ')', {
                            speechSynthesisSpeaking: speechSynthesisSpeaking,
                            queueLength: queueLength,
                            isSpeaking: isSpeakingVar,
                            pendingUtterances: pendingUtterances
                        });
                        
                        // Need multiple consecutive checks to be sure
                        if (consecutiveEmptyChecks >= requiredEmptyChecks) {
                            console.log('✅✅✅ All speech confirmed complete after ' + consecutiveEmptyChecks + ' consecutive empty checks');
                            restartMicrophoneAfterNavigasi();
                            return;
                        }
                    } else {
                        // Reset counter if something is still active
                        consecutiveEmptyChecks = 0;
                        console.log('⏳ Waiting for all speech to complete...', {
                            check: checkCount + '/' + maxChecks,
                            speechSynthesisSpeaking: speechSynthesisSpeaking,
                            queueLength: queueLength,
                            isSpeaking: isSpeakingVar,
                            pendingUtterances: pendingUtterances
                        });
                    }
                    
                    // Continue checking
                    if (checkCount < maxChecks) {
                        setTimeout(function() {
                            waitForAllSpeechComplete(checkCount + 1);
                        }, 500);
                    } else {
                        console.warn('⚠️ Speech check timeout after ' + maxChecks + ' checks - proceeding anyway');
                        console.warn('⚠️ Final state:', {
                            speechSynthesisSpeaking: speechSynthesisSpeaking,
                            queueLength: queueLength,
                            isSpeaking: isSpeakingVar,
                            pendingUtterances: pendingUtterances
                        });
                        // Even on timeout, try to restart microphone
                        restartMicrophoneAfterNavigasi();
                    }
                };
                
                // Helper function to restart microphone
                function restartMicrophoneAfterNavigasi() {
                    console.log('🔄 Attempting to restart microphone after all announcements complete...');
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            try {
                                recognition._stopped = false; // Clear stopped flag agar mikrofon bisa menerima command
                                recognition.start();
                                isListening = true;
                                console.log('✅✅✅ Microphone restarted after "Navigasi" - listening for "Mode 2" command');
                                updateVoiceStatus('🎤 Mikrofon aktif - Ucapkan "Mode 2" untuk deteksi objek');
                                
                                // Set flag bahwa mikrofon siap menerima "Mode 2"
                                recognition._waitingForMode2 = true;
                            } catch (error) {
                                console.error('❌ Failed to restart microphone after Navigasi:', error);
                                // Retry setelah delay lebih lama
                                setTimeout(function() {
                                    if (recognition && !isListening) {
                                        try {
                                            recognition._stopped = false;
                                            recognition.start();
                                            isListening = true;
                                            recognition._waitingForMode2 = true;
                                            console.log('✅✅✅ Microphone restarted (retry) - listening for "Mode 2" command');
                                            updateVoiceStatus('🎤 Mikrofon aktif - Ucapkan "Mode 2" untuk deteksi objek');
                                        } catch (retryError) {
                                            console.error('❌ Failed to restart microphone (retry):', retryError);
                                            recognition._stopped = true;
                                            updateVoiceStatus('📍 Navigasi aktif - Ucapkan "Halo" untuk aktivasi mikrofon');
                                        }
                                    }
                                }, 2000);
                            }
                        } else {
                            console.warn('⚠️ Cannot restart microphone:', {
                                recognition: !!recognition,
                                isListening: isListening
                            });
                            // If microphone is already listening, just update status
                            if (isListening && recognition) {
                                recognition._waitingForMode2 = true;
                                updateVoiceStatus('🎤 Mikrofon aktif - Ucapkan "Mode 2" untuk deteksi objek');
                                console.log('✅ Microphone already listening - updated status for "Mode 2"');
                            } else if (!recognition) {
                                console.error('❌ Recognition object not available');
                                updateVoiceStatus('📍 Navigasi aktif - Ucapkan "Halo" untuk aktivasi mikrofon');
                            }
                        }
                    }, 1000); // Delay 1 second setelah semua speech selesai untuk memastikan
                }
                
                // Start waiting for all speech to complete (wait 2 seconds first to let callback complete)
                console.log('⏳ Starting wait for all speech to complete (will check queue and speechSynthesis)...');
                setTimeout(function() {
                    waitForAllSpeechComplete();
                }, 2000);
            });
            
            // Start turn-by-turn navigation
            isNavigating = true;
        });
    });
    
    updateVoiceStatus('📍 Memulai navigasi...');
}

// Announce first few navigation instructions like beginner Google Maps
// onComplete: callback function to call after announcement finishes
function announceFirstDirections(onComplete = null) {
    if (!voiceDirectionsEnabled || !route) {
        if (lastRouteFirstInstructionSpeech) {
            speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
        } else if (onComplete) {
            onComplete();
        }
        return;
    }
    
    try {
        const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
        if (!routingContainer) {
            if (lastRouteFirstInstructionSpeech) {
                speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
            } else if (onComplete) {
                onComplete();
            }
            return;
        }
        
        const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
        if (!activeRoute) {
            if (lastRouteFirstInstructionSpeech) {
                speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
            } else if (onComplete) {
                onComplete();
            }
            return;
        }
        
        const instructionRows = activeRoute.querySelectorAll('tbody tr');
        if (!instructionRows.length) {
            if (lastRouteFirstInstructionSpeech) {
                speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
            } else if (onComplete) {
                onComplete();
            }
            return;
        }
        
        let firstInstruction = null;
        
        // Get only the first meaningful instruction
        for (let i = 0; i < Math.min(10, instructionRows.length); i++) {
            const row = instructionRows[i];
            const cells = row.querySelectorAll('td');
            
            if (cells.length < 3) continue;
            
            let instructionText = row.querySelector('.leaflet-routing-instruction-text');
            let instructionDistance = row.querySelector('.leaflet-routing-instruction-distance');
            
            if (!instructionText && cells.length >= 2) {
                instructionText = cells[1];
            }
            if (!instructionDistance && cells.length >= 3) {
                instructionDistance = cells[2];
            }
            
            if (!instructionText) continue;
            
            const text = convertInstructionToNatural(instructionText.textContent.trim());
            const distance = instructionDistance ? instructionDistance.textContent.trim() : '';
            
            // Skip if already announced or empty
            if (!text || text === lastAnnouncedInstruction) {
                continue;
            }
            
            // Skip generic "Head" instructions
            if (text.toLowerCase().includes('head') || text.toLowerCase().includes('berangkat')) {
                continue;
            }
            
            // Take only the first meaningful instruction
            if (distance && !firstInstruction) {
                const distanceInMeters = parseDistance(distance);
                firstInstruction = {
                    instruction: text,
                    distance: distanceInMeters
                };
                // Mark as announced
                announcedInstructions.push(text);
                break; // Stop after finding first instruction
            }
        }
        
        // Announce first instruction only
        if (firstInstruction) {
            let announcement = firstInstruction.instruction;
            if (firstInstruction.distance > 0) {
                const distanceText = formatDistanceForInstruction(firstInstruction.distance);
                announcement = distanceText ? 'Dalam ' + distanceText + ', ' + announcement : announcement;
            }
            
            // Speak with callback - when speech ends, call onComplete
            speakText(announcement, 'id-ID', true, onComplete);
            lastRouteFirstInstructionSpeech = announcement;
        } else {
            if (lastRouteFirstInstructionSpeech) {
                speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
            } else if (onComplete) {
                onComplete();
            }
        }
    } catch (error) {
        console.error('Error in announceFirstDirections:', error);
        // Even on error, call callback to ensure microphone restarts
        if (lastRouteFirstInstructionSpeech) {
            speakText(lastRouteFirstInstructionSpeech, 'id-ID', true, onComplete || null);
        } else if (onComplete) {
            onComplete();
        }
    }
}

// Shorten address to remove country and province if present
function shortenAddress(fullAddress) {
    if (!fullAddress) return fullAddress;
    
    // Remove common suffix patterns like "Indonesia", "Jawa Tengah", etc
    let shortAddress = fullAddress;
    
    // Remove country name (usually at the end)
    const countryPatterns = [
        /,\s*Indonesia$/i,
        /,\s*Indonesia,.*$/i
    ];
    
    for (const pattern of countryPatterns) {
        shortAddress = shortAddress.replace(pattern, '');
    }
    
    shortAddress = shortAddress.trim();
    
    // If address is too long, take only first 3-4 parts
    const parts = shortAddress.split(',').map(p => p.trim());
    if (parts.length > 4) {
        shortAddress = parts.slice(0, 4).join(', ');
    }
    
    return shortAddress.trim();
}

// Extract location from voice command
function extractLocation(command) {
    // Remove common prefixes (English and Indonesian)
    const prefixes = [
        'pergi ke', 'navigasi ke', 'tujuan ke', 'ke',
        'go to', 'navigate to', 'set destination', 'go', 'navigate', 'destination'
    ];
    
    for (const prefix of prefixes) {
        if (command.startsWith(prefix)) {
            return command.substring(prefix.length).trim();
        }
    }
    
    // If no prefix found, return the whole command as location
    return command;
}

// Geocode location - supports cities, villages, districts, and all locations in Indonesia
// userLatLng: current user location for proximity search (optional)
async function geocodeLocation(location, userLatLng = null) {
    try {
        // Update status with proximity info if available
        if (userLatLng) {
            updateVoiceStatus('🔍 Mencari: ' + location + ' di sekitar Anda');
            speakText('Mencari ' + location + ' di sekitar lokasi Anda...', 'id-ID', true);
        } else {
            updateVoiceStatus('🔍 Mencari: ' + location);
            speakText('Mencari lokasi ' + location + ' di Indonesia...', 'id-ID', true);
        }
        
        // Get current user location for bounded search
        let boundedSearch = false;
        let geocodeUrl = '';
        
        if (currentUserPosition) {
            const userLatLng = currentUserPosition.getLatLng();
            const userLat = userLatLng.lat;
            const userLng = userLatLng.lng;
            
            // Define search radius (expanded to 200km from user location for wider coverage)
            const radius = 1.8; // ~200km in degrees (was 0.45 = 50km)
            const minLat = userLat - radius;
            const maxLat = userLat + radius;
            const minLng = userLng - radius;
            const maxLng = userLng + radius;
            
            // Use Nominatim API with bounded search around user location - GLOBAL SEARCH
            // Removed countrycodes restriction, increased limit, expanded radius
            geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=20&bounded=1&viewbox=${minLng},${maxLat},${maxLng},${minLat}&addressdetails=1&accept-language=id,en`;
            boundedSearch = true;
            console.log('🔍 Bounded search:', userLat + ',' + userLng, 'radius: ~200km (expanded)');
        } else {
            // If no user location, use global search (no country restriction)
            geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=20&addressdetails=1&accept-language=id,en`;
            console.log('🔍 Global search (no user location, no country restriction)');
        }
        
        try {
            const response = await fetch(geocodeUrl);
            const data = await response.json();
            
            console.log('📊 Geocoding results:', data.results ? data.results.length : 0, 'results found');
            
            if (data && data.length > 0) {
                // If bounded search, find closest result to user location
                let result = data[0];
                
                if (boundedSearch && currentUserPosition) {
                    const userLatLng = currentUserPosition.getLatLng();
                    
                    // Find closest result to user location
                    let minDistance = Infinity;
                    data.forEach(function(item) {
                        const dist = Math.sqrt(
                            Math.pow(item.lat - userLatLng.lat, 2) + 
                            Math.pow(item.lon - userLatLng.lng, 2)
                        );
                        if (dist < minDistance) {
                            minDistance = dist;
                            result = item;
                        }
                    });
                    
                    console.log('📍 Found closest result:', result.display_name, 'distance:', (minDistance * 111).toFixed(1) + 'km');
                }
                
                const newLat = parseFloat(result.lat);
                const newLng = parseFloat(result.lon);
                const fullName = result.display_name || result.name;
                const shortName = shortenAddress(fullName);
                
                // Stop microphone briefly to announce destination, then restart for "Navigasi" command
                // Keep microphone active for 10 seconds to listen for "Navigasi" command
                if (isListening && recognition) {
                    recognition.stop();
                    isListening = false;
                }
                
                // Announce shortened destination name
                speakText('Tujuan Anda adalah ' + shortName, 'id-ID', true, function() {
                    // After announcing destination, give instruction before asking for "Navigasi" command
                    speakText('Jika ingin mengganti tujuan sebutkan lokasi dan jika tidak katakan navigasi untuk memulai perjalanan', 'id-ID', true, function() {
                        // Restart microphone to listen for "Navigasi" command (window of 10 seconds)
                        setTimeout(function() {
                            if (recognition && !isListening) {
                                try {
                                    recognition.start();
                                    isListening = true;
                                    recognition._waitingForNavigasi = true; // Flag to mark waiting for Navigasi
                                    console.log('🎤 Microphone restarted - listening for "Navigasi" command (10 second window)');
                                    
                                    // Auto-stop after 10 seconds if "Navigasi" not said
                                    setTimeout(function() {
                                        if (recognition && recognition._waitingForNavigasi && isListening) {
                                            recognition.stop();
                                            recognition._stopped = true;
                                            recognition._waitingForNavigasi = false;
                                            isListening = false;
                                            console.log('🔇 Microphone stopped - "Navigasi" window expired, say "Halo" to restart');
                                            updateVoiceStatus('✅ Tujuan: ' + shortName + ' - Ucapkan "Halo" lalu "Navigasi" untuk memulai');
                                        }
                                    }, 10000); // 10 second window
                                } catch (error) {
                                    console.error('Failed to restart microphone:', error);
                                    recognition._stopped = true;
                                }
                            }
                        }, 500);
                    });
                });
                
                // Update destination with full name
                updateDestination(newLat, newLng, fullName);
                updateVoiceStatus('✅ Tujuan: ' + shortName + ' - Ucapkan "Navigasi" untuk memulai');
                return;
            }
        } catch (nominatimError) {
            console.log('Nominatim failed:', nominatimError);
        }
        
        // Fallback to hardcoded cities for Indonesia
        // Clean up the location name - remove punctuation and extra spaces
        const cityKey = location.toLowerCase().trim().replace(/[.,;:!?]/g, '').trim();
        console.log('Looking for city:', cityKey);
        
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            
            // Stop microphone briefly to announce destination, then restart for "Navigasi" command
            // Keep microphone active for 10 seconds to listen for "Navigasi" command
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            // Announce destination for fallback cities
            speakText('Tujuan Anda adalah ' + city.name, 'id-ID', true, function() {
                // After announcing destination, give instruction before asking for "Navigasi" command
                speakText('Jika ingin mengganti tujuan sebutkan lokasi dan jika tidak katakan navigasi untuk memulai perjalanan', 'id-ID', true, function() {
                    // Restart microphone to listen for "Navigasi" command (window of 10 seconds)
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            try {
                                recognition.start();
                                isListening = true;
                                recognition._waitingForNavigasi = true; // Flag to mark waiting for Navigasi
                                console.log('🎤 Microphone restarted - listening for "Navigasi" command (10 second window)');
                                
                                // Auto-stop after 10 seconds if "Navigasi" not said
                                setTimeout(function() {
                                    if (recognition && recognition._waitingForNavigasi && isListening) {
                                        recognition.stop();
                                        recognition._stopped = true;
                                        recognition._waitingForNavigasi = false;
                                        isListening = false;
                                        console.log('🔇 Microphone stopped - "Navigasi" window expired, say "Halo" to restart');
                                        updateVoiceStatus('✅ Tujuan: ' + city.name + ' - Ucapkan "Navigasi" untuk memulai');
                                    }
                                }, 10000); // 10 second window
                            } catch (error) {
                                console.error('Failed to restart microphone:', error);
                                recognition._stopped = true;
                            }
                        }
                    }, 500);
                });
            });
            
            updateDestination(city.lat, city.lng, city.name);
            updateVoiceStatus('✅ Tujuan: ' + city.name + ' - Ucapkan "Navigasi" untuk memulai');
        } else {
            console.log('City not found:', cityKey, 'Available cities:', Object.keys(knownCities));
            
            // Stop microphone untuk announcement
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            // Announce location not found
            speakText('Lokasi tidak ditemukan: ' + location + '. Silahkan Ucapkan Rute tujuan anda lagi', 'id-ID', true, function() {
                // Restart microphone untuk mendengarkan perintah baru
                setTimeout(function() {
                    if (recognition && !isListening) {
                        try {
                            recognition.start();
                            isListening = true;
                            recognition._stopped = false;
                            console.log('🎤 Microphone restarted after location not found');
                            updateVoiceStatus('🎤 Mikrofon aktif - Sebutkan rute atau tujuan');
                        } catch (error) {
                            console.error('Failed to restart microphone:', error);
                            recognition._stopped = true;
                        }
                    }
                }, 500);
            });
            
            updateVoiceStatus('❌ Lokasi tidak ditemukan: ' + location);
        }
        
    } catch (error) {
        console.error('Geocoding error:', error);
        
        // Stop microphone untuk announcement
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        speakText('Error saat mencari lokasi. Silahkan Ucapkan Rute tujuan anda lagi', 'id-ID', true, function() {
            // Restart microphone untuk mendengarkan perintah baru
            setTimeout(function() {
                if (recognition && !isListening) {
                    try {
                        recognition.start();
                        isListening = true;
                        recognition._stopped = false;
                        console.log('🎤 Microphone restarted after geocoding error');
                        updateVoiceStatus('🎤 Mikrofon aktif - Sebutkan rute atau tujuan');
                    } catch (error) {
                        console.error('Failed to restart microphone:', error);
                        recognition._stopped = true;
                    }
                }
            }, 500);
        });
        
        updateVoiceStatus('❌ Error saat mencari lokasi');
    }
}

// Update destination marker and route
function updateDestination(lat, lng, name) {
    // Remove old marker if it exists
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
    }
    
    // Create new marker
    latLngB = [lat, lng];
    destinationMarker = L.marker(latLngB).addTo(map)
        .bindPopup(name || 'Destination').openPopup();
    
    // Adjust map view to show both user location and destination
    // This ensures long-distance routes are visible
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        const destLatLng = L.latLng(lat, lng);
        
        // Calculate distance between user and destination
        const distance = userLatLng.distanceTo(destLatLng); // in meters
        
        // Create bounds to fit both locations
        const bounds = L.latLngBounds([userLatLng, destLatLng]);
        
        // Add padding to bounds for better view
        bounds.pad(0.1); // 10% padding
        
        // Fit map to show both locations
        // For very long distances (>1000km), use wider zoom
        if (distance > 1000000) {
            // Very long distance - use wider view
            map.fitBounds(bounds, { 
                padding: [50, 50],
                maxZoom: 6 // Don't zoom in too much for long distances
            });
        } else if (distance > 100000) {
            // Long distance (100-1000km) - moderate zoom
            map.fitBounds(bounds, { 
                padding: [50, 50],
                maxZoom: 8
            });
        } else {
            // Normal distance - fit bounds with reasonable zoom
            map.fitBounds(bounds, { 
                padding: [50, 50],
                maxZoom: 13
            });
        }
        
        console.log('📍 Map adjusted to show route - distance:', (distance / 1000).toFixed(1) + 'km');
    } else {
        // If no user location, just center on destination with appropriate zoom
        const destLatLng = L.latLng(lat, lng);
        map.setView(destLatLng, 10); // Zoom level 10 for city-level view
    }
    
    // Save destination change to Firestore (if available)
    if (window.saveUserRouteUpdate) {
        try {
            window.saveUserRouteUpdate({
                type: 'destination_set',
                destination: { lat: lat, lng: lng, name: name || null }
            });
        } catch (e) {
            console.warn('Failed to save destination to Firestore:', e);
        }
    }
    
    // Note: Destination announcement is handled in geocodeLocation/knownCities
    // No announcement here to avoid duplicate
    
    // Reset navigation state when destination changes - allows user to set new destination anytime
    // This ensures that old navigation instructions don't interfere with new destination
    if (isNavigating) {
        console.log('🔄 Destination changed during navigation - resetting navigation state');
        isNavigating = false;
        announcedInstructions = []; // Clear old announcements
        lastAnnouncedInstruction = null;
    }
    
    // Reset route hash to force new announcement
    lastRouteHash = null;
    isAnnouncingRoute = false; // Reset announcement flag for new destination
    lastAnnouncementTime = 0; // Reset timing for new destination
    
    // Update route if user location exists
    // ALWAYS force update route when destination changes
    if (currentUserPosition && latLngB) {
        const userLatLng = currentUserPosition.getLatLng();
        forceUpdateRoute(userLatLng);
    }
    
    // CRITICAL: PASTIKAN marker biru tetap di lokasi GPS user, tidak ikut pan ke destination
    // Map view sudah diatur dengan fitBounds di atas untuk menampilkan kedua lokasi
    if (currentUserPosition && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(position) {
            const currentGPSLocation = L.latLng(position.coords.latitude, position.coords.longitude);
            const markerLocation = currentUserPosition.getLatLng();
            const distance = currentGPSLocation.distanceTo(markerLocation);
            
            // Jika marker tidak di GPS location, paksa kembali
            if (distance > 1) {
                console.warn('⚠️ Destination set - marker not at GPS, correcting...');
                currentUserPosition.setLatLng(currentGPSLocation);
                console.log('✅ Marker forced to GPS location:', currentGPSLocation.lat.toFixed(6) + ', ' + currentGPSLocation.lng.toFixed(6));
            }
        }, function(error) {
            // Jika GPS tidak bisa diakses, hanya log warning
            console.warn('⚠️ Could not verify marker after destination set:', error);
        }, { enableHighAccuracy: true, timeout: 3000, maximumAge: 1000 });
    }
}

// Toggle voice listening
function toggleVoiceListening() {
    if (!recognition) {
        initSpeechRecognition();
        recognition = recognition; // Re-assign in case it was created
    }
    
    if (isListening) {
        // Stop listening
        recognition.stop();
        isListening = false;
    } else {
            // Start listening
            finalTranscript = '';
            recognition.start();
            isListening = true;
            updateVoiceStatus('🎤 Mendengarkan... Ucapkan tujuan Anda');
            speakText('Mendengarkan, ucapkan tujuan Anda', 'id-ID', true);
        }
        updateVoiceButton();
    }

// Update voice status display
function updateVoiceStatus(message) {
    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus) {
        voiceStatus.textContent = message;
    }
}

// Update voice button appearance (button is hidden for blind users)
function updateVoiceButton() {
    // Button is now hidden - this function is kept for compatibility
    // Status updates are shown in voiceStatus text instead
    // Blind users control everything via voice commands
}

// Initialize speech recognition on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initSpeechRecognition();
        initSpeechSynthesis();
    });
} else {
    initSpeechRecognition();
    initSpeechSynthesis();
}

// Function to announce SENAVISION welcome and user guide
let isFirstLoad = true; // Track if this is the first time page loads
function announceWelcomeGuide() {
    // Only announce on first load
    if (!isFirstLoad) {
        console.log('⚠️ Welcome guide already announced, skipping');
        return;
    }
    isFirstLoad = false;
    
    // Check if we're in the middle of the page load sequence
    // Don't announce if speech synthesis is not ready
    if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not available yet');
        return;
    }
    
    const welcomeText = 'Senavision Siap, Panduan Penggunaan: ' +
        'Isilah rute terlebih dahulu, Ucapkan Rute 1 atau Rute 2 dan seterusnya untuk menuju Lokasi yang anda Tuju. ' +
        'Untuk Mode Deteksi Objek, ucapkan Mode 2. Mode Deteksi akan berjalan di latar belakang tanpa mengganggu navigasi. Selamat menikmati Perjalanan';
    
    console.log('📢 Starting welcome guide announcement');
    updateVoiceStatus('📢 Memutar panduan penggunaan...');
    
    // Set hasUserInteraction to true so we can use speech synthesis
    hasUserInteraction = true;
    
    speakText(welcomeText, 'id-ID', true, function() {
        // After welcome message finishes, announce microphone is activated
        console.log('✅ Welcome guide finished - activating microphone');
        
        // Initialize speech recognition if not already done
        if (!recognition) {
            initSpeechRecognition();
        }
        
        // Clear stopped flag if any
        if (recognition && recognition._stopped) {
            recognition._stopped = false;
        }
        
        // Start microphone to listen for user commands (without additional speech)
        if (!isListening && recognition) {
            try {
                recognition.start();
                isListening = true;
                suppressMicActivationSpeech = false;
                console.log('✅ Microphone activated after welcome guide');
                updateVoiceStatus('🎤 Mikrofon aktif. Sebutkan tujuan Anda.');
            } catch (error) {
                console.error('❌ Failed to activate microphone:', error);
                updateVoiceStatus('⚠️ Error mengaktifkan mikrofon. Klik layar untuk mencoba lagi.');
            }
        }
    });
}

// Initialize speech synthesis voices
function initSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
        console.warn('Speech Synthesis tidak didukung');
        return;
    }
    
    // Load voices when available
    let voices = window.speechSynthesis.getVoices();
    
    function loadVoices() {
        voices = window.speechSynthesis.getVoices();
        
        // Log available voices for debugging
        console.log('Available voices:', voices.length);
        if (voices.length > 0) {
            console.log('Sample voice:', voices[0].name);
        }
        
        // Try to find Indonesian voice
        const indonesianVoices = voices.filter(v => v.lang.startsWith('id-'));
        if (indonesianVoices.length > 0) {
            console.log('Found Indonesian voice:', indonesianVoices[0].name);
        } else {
            console.log('No Indonesian voice found, will use default');
        }
    }
    
    // Load voices (some browsers load them async)
    if (voices.length === 0) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    } else {
        loadVoices();
    }
}

// ========== VOICE DIRECTIONS FUNCTIONS ==========

// Toggle voice directions on/off
function toggleVoiceDirections() {
    voiceDirectionsEnabled = !voiceDirectionsEnabled;
    
    const btn = document.getElementById('voiceDirectionsBtn');
    if (btn) {
        if (voiceDirectionsEnabled) {
            btn.innerHTML = '🔇 Disable Voice Directions';
            btn.style.background = '#dc3545';
            
            // Test voice first with priority
            speakText('Panduan suara diaktifkan', 'id-ID', true);
            
            // Wait for speech to complete, then announce route
            setTimeout(function() {
                announceRouteDirections(true);
            }, 1500);
            
        } else {
            btn.innerHTML = '🔊 Enable Voice Directions';
            btn.style.background = '#28a745';
            
            // Cancel any ongoing speech and clear queue
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                announcementQueue = [];
            }
        }
    }
}

// Speak text using browser's built-in Web Speech API (works offline, no CORS issues)
function speakText(text, lang = 'id-ID', priority = false, onComplete = null) {
    if (!('speechSynthesis' in window)) {
        console.error('Browser tidak mendukung Text-to-Speech');
        return;
    }
    
    // Skip if this exact message was just spoken (prevent duplicate announcements)
    if (text === lastSpokenMessage && !priority) {
        console.log('⏭️ Duplicate message skipped:', text);
        return;
    }
    
    // Use SpeechCoordinator to check if we can speak (if available)
    // If SpeechCoordinator not available, allow navigation to speak directly
    let canSpeak = true;
    if (typeof window.SpeechCoordinator !== 'undefined') {
        const speechPriority = 'high'; // Navigation always high priority
        canSpeak = window.SpeechCoordinator.requestSpeak(speechPriority);
        
        if (!canSpeak) {
            // If cannot speak now (only if critical warning is active), queue it
            // But if it's just normal mode detector speech, we can interrupt it
            if (window.SpeechCoordinator.isModeDetectorWarning) {
                announcementQueue.push({ text, lang, onComplete, priority });
                console.log('[Navigation] ⏸️ Speech queued - waiting for critical warning to finish:', text.substring(0, 50));
                return;
            } else {
                // If it's just normal mode detector speech, allow navigation to interrupt
                console.log('[Navigation] 🔄 Navigation interrupting normal mode detector speech');
                if (typeof window.speechSynthesis !== 'undefined') {
                    window.speechSynthesis.cancel();
                }
                window.SpeechCoordinator.isModeDetectorSpeaking = false;
                window.SpeechCoordinator.isNavigationSpeaking = true;
                canSpeak = true; // Allow navigation to proceed
            }
        }
    } else {
        // SpeechCoordinator not available - use old behavior (allow navigation to speak)
        console.log('[Navigation] ⚠️ SpeechCoordinator not available - using direct speech');
    }
    
    // If there's ongoing speech and this is priority, cancel current speech
    if (isSpeaking && priority) {
        window.speechSynthesis.cancel();
    }
    
    // Cancel any pending speech (except critical warnings)
    if (typeof window.SpeechCoordinator !== 'undefined') {
        if (!window.SpeechCoordinator.isModeDetectorWarning) {
            window.speechSynthesis.cancel();
        }
    } else {
        // Fallback: cancel all speech if SpeechCoordinator not available
        window.speechSynthesis.cancel();
    }
    
    // Wait a bit before creating new utterance
    setTimeout(function() {
        // Create speech utterance
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Try to set language, but fallback if not available
        try {
            utterance.lang = lang;
        } catch(e) {
            utterance.lang = 'en-US'; // Fallback to English
        }
        
        utterance.rate = 0.85; // Slower for clarity
        utterance.pitch = 1;
        utterance.volume = 1;
        
        // Add event handlers
        utterance.onstart = function() {
            markNavigatorSpeechStart();
            isSpeaking = true;
            window.SpeechCoordinator.isNavigationSpeaking = true;
            lastSpokenMessage = text; // Remember this message
            // Only log short preview to avoid cluttering console
            const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
            console.log('[Navigation] 🔊 Speech started:', preview);
        };
        utterance.onerror = function(event) {
            markNavigatorSpeechEnd();
            window.SpeechCoordinator.markSpeechEnd('high');
            if (event.error !== 'interrupted') {
                console.error('Speech error:', event.error);
            }
            isSpeaking = false;
            // Process next in queue
            processAnnouncementQueue();
        };
        utterance.onend = function() {
            markNavigatorSpeechEnd();
            window.SpeechCoordinator.markSpeechEnd('high');
            console.log('[Navigation] ✅ Speech ended');
            isSpeaking = false;
            
            // Clear lastSpokenMessage after 5 seconds to allow same message again later
            setTimeout(function() {
                lastSpokenMessage = '';
            }, 5000);
            
            // Call onComplete callback if provided
            if (onComplete) {
                setTimeout(onComplete, 100);
            }
            
            // Process next in queue
            processAnnouncementQueue();
        };
        
        // Speak
        try {
            window.speechSynthesis.speak(utterance);
        } catch(error) {
            console.error('Error speaking:', error);
            isSpeaking = false;
        }
    }, 100);
}

// Process announcement queue
function processAnnouncementQueue() {
    if (announcementQueue.length > 0 && !isSpeaking) {
        const next = announcementQueue.shift();
        speakText(next.text, next.lang, false, next.onComplete || null);
    }
}

// Announce detailed route directions like Google Maps/Assistant
function announceRouteDirections(priority = false, onComplete = null) {
    if (!voiceDirectionsEnabled) {
        if (onComplete) onComplete();
        return;
    }
    
    // Find the routing control container
    const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
    if (!routingContainer) {
        if (lastRouteSummarySpeech) {
            speakText(lastRouteSummarySpeech, 'id-ID', priority, function() {
                if (onComplete) onComplete();
            });
        } else if (onComplete) {
            onComplete();
        }
        return;
    }
    
    // Get the first (active) route
    const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
    if (!activeRoute) {
        if (lastRouteSummarySpeech) {
            speakText(lastRouteSummarySpeech, 'id-ID', priority, function() {
                if (onComplete) onComplete();
            });
        } else if (onComplete) {
            onComplete();
        }
        return;
    }
    
    // Get h2 (nama jalan) and h3 (jarak dan waktu)
    const routeName = activeRoute.querySelector('h2'); // Nama jalan
    const routeInfo = activeRoute.querySelector('h3'); // Jarak dan waktu
    
    // Build announcement: hanya h2 dan h3 saja
    let announcement = '';
    
    // Ambil nama jalan dari h2
    if (routeName) {
        const roadName = routeName.textContent.trim();
        console.log('🛣️ Nama jalan (h2):', roadName);
        announcement = roadName + '. '; // Ucapkan nama jalan
    }
    
    // Ambil jarak dan waktu dari h3
    if (routeInfo) {
        const info = convertDistanceToIndonesian(routeInfo.textContent.trim());
        console.log('📏 Jarak dan waktu (h3):', info);
        announcement += info; // Ucapkan jarak dan waktu
    }
    
    // Jika tidak ada data, beri pesan default
    if (!announcement && lastRouteSummarySpeech) {
        console.log('⚠️ No route data found in DOM - using stored summary');
        announcement = lastRouteSummarySpeech;
    } else if (!announcement) {
        console.log('⚠️ No route data found in h2 or h3');
        announcement = 'Rute sedang dimuat...';
    }
    
    // Debug: log the announcement to be spoken
    console.log('📢 Announcement to be spoken (h2 + h3 only):');
    console.log('=========================================');
    console.log(announcement);
    console.log('=================================');
    
    // Callback after announcement is done
    function afterRouteAnnouncement() {
        console.log('✓ Route announcement completed');
        
        // Keep microphone listening for blind users (hands-free operation)
        // Microphone remains active so user can give more commands
        
        // Update status with instructions for user
        updateVoiceStatus('📍 Navigasi aktif - Klik mikrofon untuk perintah');
        
        // Call onComplete callback if provided (for starting turn-by-turn navigation)
        if (onComplete && typeof onComplete === 'function') {
            onComplete();
        } else {
            // Only announce microphone availability if not starting turn-by-turn navigation
            setTimeout(function() {
                console.log('✓ Announcing microphone availability');
                speakText('Navigasi sudah aktif. Ucapkan perintah lain kapan saja.', 'id-ID', false);
            }, 2000); // Wait 2 seconds after route announcement
        }
    }
    
    // Speak the announcement using browser's Web Speech API with priority
    speakText(announcement, 'id-ID', priority, afterRouteAnnouncement);
}

// Convert distance to Indonesian format
function convertDistance(distance) {
    distance = distance.trim();
    
    // Convert meters to Indonesian
    if (distance.includes('km')) {
        const km = distance.replace('km', '').trim();
        return km + ' kilometer';
    } else if (distance.includes('m')) {
        const m = distance.replace('m', '').trim();
        if (parseInt(m) >= 1000) {
            return (parseInt(m) / 1000).toFixed(1) + ' kilometer';
        } else if (parseInt(m) >= 100) {
            return Math.round(parseInt(m) / 100) + ' ratus meter';
        } else {
            return m + ' meter';
        }
    }
    
    return distance;
}

// Convert route info to Indonesian
function convertDistanceToIndonesian(info) {
    // Example: "9.8 km, 1 h 12 min" -> "Jarak 9 koma 8 kilometer, perkiraan waktu 1 jam 12 menit"
    let result = info;
    
    // Extract distance
    const kmMatch = info.match(/([\d.]+)\s*km/);
    if (kmMatch) {
        const km = kmMatch[1];
        result = 'Jarak ' + km + ' kilometer';
    }
    
    // Extract time - handle both hours and minutes
    let timeText = '';
    const hourMatch = info.match(/(\d+)\s*h/);
    const minMatch = info.match(/(\d+)\s*min/);
    
    if (hourMatch || minMatch) {
        timeText += ', perkiraan waktu ';
        
        if (hourMatch) {
            const hours = hourMatch[1];
            timeText += hours + ' jam';
            
            if (minMatch) {
                const mins = minMatch[1];
                timeText += ' ' + mins + ' menit';
            }
        } else if (minMatch) {
            const mins = parseInt(minMatch[1]);
            // Convert to hours if more than 60 minutes
            if (mins >= 60) {
                const hours = Math.floor(mins / 60);
                const remainingMinutes = mins % 60;
                timeText += hours + ' jam';
                if (remainingMinutes > 0) {
                    timeText += ' ' + remainingMinutes + ' menit';
                }
            } else {
                timeText += mins + ' menit';
            }
        }
    }
    
    result += timeText;
    
    return result || info;
}

// Translate route instructions in DOM to Indonesian
function translateRouteInstructions() {
    console.log('🌐 Translating route instructions to Indonesian');
    
    // Retry multiple times to catch dynamic content
    let retryCount = 0;
    const maxRetries = 5;
    
    function attemptTranslate() {
        // Find all instruction text cells
        const instructionCells = document.querySelectorAll('.leaflet-routing-instruction-text');
        
        if (instructionCells.length === 0 && retryCount < maxRetries) {
            retryCount++;
            console.log('⏳ Waiting for instructions to load... retry', retryCount);
            setTimeout(attemptTranslate, 500);
            return;
        }
        
        console.log('Found', instructionCells.length, 'instructions to translate');
        
        let translatedCount = 0;
        instructionCells.forEach(function(cell, index) {
            const originalText = cell.textContent.trim();
            if (originalText && originalText.length > 0 && !originalText.toLowerCase().includes('berangkat') && !originalText.toLowerCase().includes('belok')) {
                const translatedText = convertInstructionToNatural(originalText);
                if (translatedText !== originalText) {
                    cell.textContent = translatedText;
                    translatedCount++;
                    if (index < 3) { // Log first 3 translations
                        console.log('  ✓', originalText, '→', translatedText);
                    }
                }
            }
        });
        
        console.log('✅ Translated', translatedCount, 'instructions');
        
        // Also translate h3 summary
        const routeSummary = document.querySelector('.leaflet-routing-alt h3');
        if (routeSummary) {
            const summary = routeSummary.textContent.trim();
            console.log('📊 Route summary:', summary);
        }
    }
    
    attemptTranslate();
}

// Convert instruction to natural Indonesian like Google Maps
function convertInstructionToNatural(text) {
    text = String(text || '');
    
    // Handle specific patterns
    const patterns = [
        { pattern: /^Head (.+)$/i, replacement: 'Berangkat $1' },
        { pattern: /^Turn right$/i, replacement: 'Belok kanan' },
        { pattern: /^Turn left$/i, replacement: 'Belok kiri' },
        { pattern: /^Turn right onto (.+)$/i, replacement: 'Belok kanan ke $1' },
        { pattern: /^Turn left onto (.+)$/i, replacement: 'Belok kiri ke $1' },
        { pattern: /^Turn left to stay on (.+)$/i, replacement: 'Belok kiri tetap di $1' },
        { pattern: /^Go straight$/i, replacement: 'Lurus terus' },
        { pattern: /^Go straight onto (.+)$/i, replacement: 'Lurus terus ke $1' },
        { pattern: /^Continue onto (.+)$/i, replacement: 'Lanjutkan ke $1' },
        { pattern: /^Continue straight to stay on (.+)$/i, replacement: 'Lurus terus tetap di $1' },
        { pattern: /^Continue straight$/i, replacement: 'Lurus terus' },
        { pattern: /^Keep right onto (.+)$/i, replacement: 'Tetap di kanan ke $1' },
        { pattern: /^Keep left onto (.+)$/i, replacement: 'Tetap di kiri ke $1' },
        { pattern: /^Keep left towards (.+)$/i, replacement: 'Tetap di kiri menuju $1' },
        { pattern: /^Keep right towards (.+)$/i, replacement: 'Tetap di kanan menuju $1' },
        { pattern: /^Take the ramp on the left towards (.+)$/i, replacement: 'Ambil jalan keluar kiri menuju $1' },
        { pattern: /^Take the ramp on the left$/i, replacement: 'Ambil jalan keluar kiri' },
        { pattern: /^Take the ramp onto (.+)$/i, replacement: 'Ambil jalan keluar ke $1' },
        { pattern: /^Take the ramp$/i, replacement: 'Ambil jalan keluar' },
        { pattern: /^Merge right onto (.+)$/i, replacement: 'Bergabung kanan ke $1' },
        { pattern: /^Merge left towards (.+)$/i, replacement: 'Bergabung kiri menuju $1' },
        { pattern: /^Merge right towards (.+)$/i, replacement: 'Bergabung kanan menuju $1' },
        { pattern: /^Make a slight left to stay on (.+)$/i, replacement: 'Sedikit ke kiri tetap di $1' },
        { pattern: /^Make a slight right to stay on (.+)$/i, replacement: 'Sedikit ke kanan tetap di $1' },
        { pattern: /^Make a slight left onto (.+)$/i, replacement: 'Sedikit ke kiri ke $1' },
        { pattern: /^Make a slight right onto (.+)$/i, replacement: 'Sedikit ke kanan ke $1' },
        { pattern: /^Make a slight left$/i, replacement: 'Sedikit ke kiri' },
        { pattern: /^Make a slight right$/i, replacement: 'Sedikit ke kanan' },
        { pattern: /^Keep right at the fork$/i, replacement: 'Tetap kanan di persimpangan' },
        { pattern: /^Keep left at the fork$/i, replacement: 'Tetap kiri di persimpangan' },
        { pattern: /^Enter the traffic circle and take the (\d+)(?:st|nd|rd|th) exit onto (.+)$/i, replacement: 'Masuk bundaran dan ambil jalan keluar ke-$1 ke $2' },
        { pattern: /^Enter (.+) and take the (.+) exit onto (.+)$/i, replacement: 'Masuk $1 dan ambil $2 ke $3' },
        { pattern: /^Exit the traffic circle onto (.+)$/i, replacement: 'Keluar bundaran ke $1' },
        { pattern: /^You have arrived at your destination, (.+)$/i, replacement: 'Anda telah tiba di tujuan, $1' },
        { pattern: /^You have arrived$/i, replacement: 'Anda telah tiba' }
    ];
    
    // Try to match patterns
    for (let i = 0; i < patterns.length; i++) {
        const match = text.match(patterns[i].pattern);
        if (match) {
            return patterns[i].replacement.replace(/\$(\d+)/g, function(m, n) {
                return match[parseInt(n)] || '';
            });
        }
    }
    
    // Default translations
    text = text.replace(/Turn right/gi, 'Belok kanan');
    text = text.replace(/Turn left/gi, 'Belok kiri');
    text = text.replace(/Go straight/gi, 'Lurus terus');
    text = text.replace(/straight/gi, 'lurus');
    text = text.replace(/Continue/gi, 'Lanjutkan');
    text = text.replace(/Keep right/gi, 'Tetap kanan');
    text = text.replace(/Keep left/gi, 'Tetap kiri');
    text = text.replace(/onto/gi, 'ke');
    text = text.replace(/traffic circle/gi, 'bundaran');
    text = text.replace(/and take the/gi, 'dan ambil');
    text = text.replace(/exit/gi, 'keluar');
    text = text.replace(/Merge/gi, 'Bergabung');
    text = text.replace(/Take the ramp/gi, 'Ambil jalan keluar');
    text = text.replace(/Make a/gi, 'Buat');
    text = text.replace(/slight/gi, 'sedikit');
    
    return text;
}

// Function to speak turn-by-turn directions based on user position (Google Maps style)
function announceNextDirection() {
    if (!voiceDirectionsEnabled || !route || !isNavigating || !currentRouteData || !currentUserPosition) return;
    
    try {
        // Get route instructions from DOM
        const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
        if (!routingContainer) return;
        
        const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
        if (!activeRoute) return;
        
        const instructionRows = activeRoute.querySelectorAll('tbody tr');
        if (!instructionRows.length) return;
        
        // Get current user position
        const userLatLng = currentUserPosition.getLatLng();
        
        // Calculate distance to next turn (look at first few instructions)
        for (let i = 0; i < Math.min(5, instructionRows.length); i++) {
            const row = instructionRows[i];
            const cells = row.querySelectorAll('td');
            
            if (cells.length < 3) continue;
            
            // Get instruction text and distance
            let instructionText = row.querySelector('.leaflet-routing-instruction-text');
            let instructionDistance = row.querySelector('.leaflet-routing-instruction-distance');
            
            if (!instructionText && cells.length >= 2) {
                instructionText = cells[1];
            }
            if (!instructionDistance && cells.length >= 3) {
                instructionDistance = cells[2];
            }
            
            if (!instructionText) continue;
            
            const text = convertInstructionToNatural(instructionText.textContent.trim());
            const distance = instructionDistance ? instructionDistance.textContent.trim() : '';
            
            // Skip if already announced or empty
            // Check if this instruction was already announced (prevent repeat)
            if (!text || text === lastAnnouncedInstruction || announcedInstructions.includes(text)) {
                continue;
            }
            
            // Skip generic instructions
            if (text.toLowerCase().includes('head') || text.toLowerCase().includes('berangkat')) {
                continue;
            }
            
            // Parse distance - announce if within 200 meters
            if (distance) {
                const distanceInMeters = parseDistance(distance);
                
                // Announce if within 200 meters and is a turn instruction
                if (distanceInMeters <= 200 && distanceInMeters > 0) {
                    console.log('📍 Next turn:', text, 'in', distance);
                    
                    // Only announce if not previously announced
                    if (text !== lastAnnouncedInstruction && !announcedInstructions.includes(text)) {
                        lastAnnouncedInstruction = text;
                        announcedInstructions.push(text); // Mark as announced
                        
                        // Announce the turn instruction (optimized for visually impaired users)
                        if (distanceInMeters >= 2) {
                            // Format: "Setelah X meter Belok kiri" (for easier understanding)
                            speakText('Setelah ' + Math.round(distanceInMeters) + ' meter ' + text, 'id-ID', true);
                        } else {
                            // Very close to turn (< 2m) - announce immediate action
                            speakText(text + ' sekarang', 'id-ID', true);
                        }
                    }
                    break; // Only announce one instruction at a time
                }
            }
        }
    } catch (error) {
        console.error('Error in announceNextDirection:', error);
    }
}

// Helper function to parse distance from text (e.g., "150 m" -> 150)
function parseDistance(distanceText) {
    if (!distanceText) return 0;
    
    // Remove extra spaces and convert to lowercase
    const text = distanceText.trim().toLowerCase();
    
    // Check for km
    if (text.includes('km')) {
        const km = parseFloat(text.replace('km', '').trim());
        return km * 1000;
    }
    
    // Check for m
    if (text.includes('m')) {
        const m = parseFloat(text.replace('m', '').trim());
        return m;
    }
    
    return 0;
}

// Format distance untuk display (meter ke "150 m" atau "1.5 km")
function formatDistance(meters) {
    if (meters >= 1000) {
        const km = (meters / 1000).toFixed(1);
        return km + ' km';
    } else {
        return Math.round(meters) + ' m';
    }
}

// Update real-time instructions: jarak berkurang dan hapus yang sudah dilewati
function updateRealTimeInstructions(userLatLng) {
    if (!isNavigating || !currentRouteData || !route) {
        return;
    }
    
    try {
        // Get route instructions from DOM
        const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
        if (!routingContainer) return;
        
        const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
        if (!activeRoute) return;
        
        const instructionRows = activeRoute.querySelectorAll('tbody tr');
        if (!instructionRows.length) return;
        
        // Get route coordinates - ini adalah array semua titik di route
        const routeCoordinates = currentRouteData.coordinates;
        if (!routeCoordinates || routeCoordinates.length === 0) return;
        
        // Cari coordinate terdekat dengan user position di route
        let nearestRouteIndex = 0;
        let minDistance = Infinity;
        
        for (let i = 0; i < routeCoordinates.length; i++) {
            const coord = routeCoordinates[i];
            const coordLatLng = L.latLng(coord.lat, coord.lng);
            const distance = userLatLng.distanceTo(coordLatLng);
            if (distance < minDistance) {
                minDistance = distance;
                nearestRouteIndex = i;
            }
        }
        
        // Hitung jarak kumulatif dari start ke nearest point (posisi user di route)
        let distanceTraveled = 0;
        for (let i = 1; i <= nearestRouteIndex && i < routeCoordinates.length; i++) {
            const prevCoord = routeCoordinates[i - 1];
            const currentCoord = routeCoordinates[i];
            distanceTraveled += L.latLng(prevCoord.lat, prevCoord.lng)
                .distanceTo(L.latLng(currentCoord.lat, currentCoord.lng));
        }
        
        // CRITICAL: Simpan jarak kumulatif untuk setiap instruction row
        // Setiap instruction memiliki jarak dari start ke instruction point tersebut
        // Kita perlu menyimpan jarak original saat pertama kali route ditemukan
        // Atau hitung ulang berdasarkan route coordinates dan instruction points
        
        // Get instructions dari route data jika tersedia
        const routeInstructions = currentRouteData.instructions || [];
        
        // Hitung jarak kumulatif ke setiap instruction point
        let cumulativeDist = 0;
        const instructionCumulativeDistances = [];
        
        for (let i = 0; i < routeInstructions.length; i++) {
            const instruction = routeInstructions[i];
            const instructionIndex = instruction.index;
            
            // Hitung jarak kumulatif dari start ke instruction point ini
            if (instructionIndex > 0 && instructionIndex < routeCoordinates.length) {
                // Hitung jarak dari previous instruction (atau start) ke instruction ini
                const prevIndex = i > 0 ? routeInstructions[i - 1].index : 0;
                for (let j = prevIndex + 1; j <= instructionIndex; j++) {
                    if (j < routeCoordinates.length) {
                        const prevCoord = routeCoordinates[j - 1];
                        const currCoord = routeCoordinates[j];
                        cumulativeDist += L.latLng(prevCoord.lat, prevCoord.lng)
                            .distanceTo(L.latLng(currCoord.lat, currCoord.lng));
                    }
                }
            }
            
            instructionCumulativeDistances.push(cumulativeDist);
        }
        
        // Update setiap instruction row di DOM
        const PASSED_THRESHOLD = 50; // Hapus instruction jika sudah dilewati < 50 meter
        
        instructionRows.forEach(function(row, rowIndex) {
            // Skip jika row sudah di-hide
            if (row.style.display === 'none') return;
            
            // Get distance cell
            let instructionDistance = row.querySelector('.leaflet-routing-instruction-distance');
            const cells = row.querySelectorAll('td');
            if (!instructionDistance && cells.length >= 3) {
                instructionDistance = cells[2];
            }
            
            if (!instructionDistance) return;
            
            // Baca jarak original dari DOM (jarak dari start ke instruction point ini)
            const currentDistanceText = instructionDistance.textContent.trim();
            let originalDistanceFromStart = parseDistance(currentDistanceText);
            
            // Jika tidak bisa parse, gunakan data dari route instructions
            if (originalDistanceFromStart === 0 && rowIndex > 0 && rowIndex <= instructionCumulativeDistances.length) {
                originalDistanceFromStart = instructionCumulativeDistances[rowIndex - 1];
            }
            
            // Hitung jarak tersisa (remaining distance) dari user ke instruction point ini
            // Jarak tersisa = jarak kumulatif ke instruction - jarak yang sudah ditempuh user
            let remainingDistance = 0;
            
            if (rowIndex === 0) {
                // Depart instruction - user sudah di start atau sudah melewati
                // Jarak tersisa = 0 jika sudah melewati, atau jarak ke start jika belum
                remainingDistance = Math.max(0, -distanceTraveled); // Negative = sudah melewati
                if (distanceTraveled > PASSED_THRESHOLD) {
                    remainingDistance = 0; // Sudah melewati start point
                }
            } else {
                // Instruction lainnya - jarak tersisa = jarak ke instruction point - jarak yang sudah ditempuh
                remainingDistance = Math.max(0, originalDistanceFromStart - distanceTraveled);
            }
            
            // Update jarak di DOM dengan jarak tersisa yang sudah disesuaikan
            instructionDistance.textContent = formatDistance(Math.max(0, remainingDistance));
            
            // Hapus instruction jika sudah dilewati (< 50 meter)
            if (remainingDistance < PASSED_THRESHOLD && remainingDistance >= 0) {
                row.style.display = 'none';
                console.log('✅ Hiding instruction row', rowIndex, '- already passed (remaining:', Math.round(remainingDistance), 'm)');
            } else {
                // Pastikan row visible jika masih ada jarak tersisa
                row.style.display = '';
            }
        });
        
        // Log untuk debugging (hanya jika user dekat dengan route)
        if (minDistance < 100) {
            console.log('📍 Real-time update - nearest route point:', nearestRouteIndex, 
                '/', routeCoordinates.length, 'distance to route:', Math.round(minDistance), 'm',
                'distance traveled:', Math.round(distanceTraveled), 'm');
        }
        
    } catch (error) {
        console.error('❌ Error in updateRealTimeInstructions:', error);
    }
}

// ========== SIDE NAVBAR FUNCTIONS ==========

// Toggle sidebar visibility
function toggleSideNavbar() {
    const navbar = document.getElementById('sideNavbar');
    const toggleBtn = document.getElementById('navbarToggleBtn');
    
    if (navbar) {
        const isActive = navbar.classList.contains('active');
        
        if (isActive) {
            navbar.classList.remove('active');
            navbar.classList.add('collapsed');
            if (toggleBtn) {
                toggleBtn.style.display = 'flex';
            }
        } else {
            navbar.classList.add('active');
            navbar.classList.remove('collapsed');
            if (toggleBtn) {
                toggleBtn.style.display = 'none';
            }
        }
    }
}

// Switch between navbar tabs
function switchNavbarTab(tabName) {
    // Update tab buttons
    const tabs = document.querySelectorAll('.navbar-tab');
    tabs.forEach(tab => {
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Update tab content
    const contents = document.querySelectorAll('.navbar-tab-content');
    contents.forEach(content => {
        if (content.id === 'navbarTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
    
    // Auto-open navbar if collapsed
    const navbar = document.getElementById('sideNavbar');
    if (navbar && navbar.classList.contains('collapsed')) {
        navbar.classList.remove('collapsed');
        navbar.classList.add('active');
        const toggleBtn = document.getElementById('navbarToggleBtn');
        if (toggleBtn) {
            toggleBtn.style.display = 'none';
        }
    }
}

// Initialize drag/swipe functionality for sidebar
(function() {
    let isDragging = false;
    let startY = 0;
    let currentY = 0;
    let startTransform = 0;
    let navbar = null;
    let dragHandle = null;
    
    function initSidebarDrag() {
        navbar = document.getElementById('sideNavbar');
        dragHandle = document.getElementById('navbarDragHandle');
        
        if (!navbar || !dragHandle) return;
        
        // Touch events for mobile
        dragHandle.addEventListener('touchstart', handleDragStart, { passive: false });
        dragHandle.addEventListener('touchmove', handleDragMove, { passive: false });
        dragHandle.addEventListener('touchend', handleDragEnd, { passive: false });
        
        // Mouse events for desktop
        dragHandle.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        
        // Click on drag handle to toggle
        dragHandle.addEventListener('click', function(e) {
            if (!isDragging) {
                toggleSideNavbar();
            }
        });
    }
    
    function handleDragStart(e) {
        if (!navbar) return;
        
        isDragging = true;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startY = clientY;
        
        // Get current transform value
        const style = window.getComputedStyle(navbar);
        const matrix = new DOMMatrix(style.transform);
        startTransform = matrix.m42; // translateY value
        
        navbar.style.transition = 'none'; // Disable transition during drag
        e.preventDefault();
    }
    
    function handleDragMove(e) {
        if (!isDragging || !navbar) return;
        
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        currentY = clientY - startY;
        
        // Calculate new transform
        const newTransform = startTransform + currentY;
        const maxTransform = 0; // Fully visible
        const minTransform = navbar.offsetHeight - 60; // Only drag handle visible
        
        // Clamp transform value
        const clampedTransform = Math.max(minTransform, Math.min(maxTransform, newTransform));
        
        navbar.style.transform = `translateY(${clampedTransform}px)`;
        e.preventDefault();
    }
    
    function handleDragEnd(e) {
        if (!isDragging || !navbar) return;
        
        isDragging = false;
        navbar.style.transition = ''; // Re-enable transition
        
        const threshold = navbar.offsetHeight * 0.3; // 30% of navbar height
        const currentTransform = parseFloat(navbar.style.transform.replace('translateY(', '').replace('px)', '')) || 0;
        
        // Determine final state based on drag distance
        if (currentY < -threshold) {
            // Dragged up significantly - open fully
            navbar.classList.add('active');
            navbar.classList.remove('collapsed');
            navbar.style.transform = 'translateY(0)';
            const toggleBtn = document.getElementById('navbarToggleBtn');
            if (toggleBtn) {
                toggleBtn.style.display = 'none';
            }
        } else if (currentY > threshold) {
            // Dragged down significantly - collapse
            navbar.classList.remove('active');
            navbar.classList.add('collapsed');
            navbar.style.transform = `translateY(calc(100% - 60px))`;
            const toggleBtn = document.getElementById('navbarToggleBtn');
            if (toggleBtn) {
                toggleBtn.style.display = 'flex';
            }
        } else {
            // Snap back to current state
            if (navbar.classList.contains('active')) {
                navbar.style.transform = 'translateY(0)';
            } else {
                navbar.style.transform = `translateY(calc(100% - 60px))`;
            }
        }
        
        e.preventDefault();
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            initSidebarDrag();
            initSidebarState();
        });
    } else {
        initSidebarDrag();
        initSidebarState();
    }
    
    // Initialize sidebar state based on screen size
    function initSidebarState() {
        const navbar = document.getElementById('sideNavbar');
        if (!navbar) return;
        
        // On mobile, start collapsed (only drag handle visible)
        // On desktop, always visible
        if (window.innerWidth <= 768) {
            navbar.classList.remove('active');
            navbar.classList.add('collapsed');
            navbar.style.transform = 'translateY(calc(100% - 60px))';
            const toggleBtn = document.getElementById('navbarToggleBtn');
            if (toggleBtn) {
                toggleBtn.style.display = 'flex';
            }
        } else {
            navbar.classList.add('active');
            navbar.classList.remove('collapsed');
            navbar.style.transform = 'translateY(0)';
            const toggleBtn = document.getElementById('navbarToggleBtn');
            if (toggleBtn) {
                toggleBtn.style.display = 'none';
            }
        }
        
        // Handle window resize
        window.addEventListener('resize', function() {
            if (window.innerWidth <= 768) {
                // Mobile: allow collapsing
                if (!navbar.classList.contains('active') && !navbar.classList.contains('collapsed')) {
                    navbar.classList.add('collapsed');
                }
            } else {
                // Desktop: always visible
                navbar.classList.add('active');
                navbar.classList.remove('collapsed');
                navbar.style.transform = 'translateY(0)';
                const toggleBtn = document.getElementById('navbarToggleBtn');
                if (toggleBtn) {
                    toggleBtn.style.display = 'none';
                }
            }
        });
    }
})();

// Function to navigate to home page (index.html)
function goToHomePage() {
    // Try multiple path options to ensure it works
    const paths = [
        '../index.html',
        '/index.html',
        window.location.origin + '/index.html'
    ];
    
    // Try the first path (relative)
    try {
        window.location.href = '../index.html';
    } catch (error) {
        console.error('Error navigating to home:', error);
        // Fallback to absolute path
        window.location.href = window.location.origin + '/index.html';
    }
}

// Helper functions to track navigator speech lifecycle
function markNavigatorSpeechStart() {
    navigatorSpeechDepth++;
    isNavigatorSpeaking = true;
    // Extend suppression window slightly so we ignore recognition results triggered by speaker output
    suppressRecognitionUntil = Date.now() + 1500;
}

function markNavigatorSpeechEnd() {
    if (navigatorSpeechDepth > 0) {
        navigatorSpeechDepth--;
    }
    if (navigatorSpeechDepth <= 0) {
        navigatorSpeechDepth = 0;
        // Suppress recognition briefly after speech stops to avoid capturing trailing audio/echo
        suppressRecognitionUntil = Date.now() + 1500;
        setTimeout(function() {
            if (navigatorSpeechDepth === 0) {
                isNavigatorSpeaking = false;
                if (pendingAutoMicResume && recognition && !isListening) {
                    const resumeDelay = Math.max(pendingAutoMicResumeDelay, 600);
                    setTimeout(function() {
                        if (!pendingAutoMicResume) return; // Might have been cleared by custom flow
                        if (navigatorSpeechDepth === 0 && Date.now() >= suppressRecognitionUntil) {
                            try {
                                recognition._stopped = false;
                                recognition.start();
                                isListening = true;
                                console.log('🎙️ Microphone auto-resumed after navigator speech');
                                updateVoiceStatus('🎤 Mikrofon aktif kembali');
                            } catch (error) {
                                console.error('❌ Failed to auto-resume microphone:', error);
                                recognition._stopped = true;
                            } finally {
                                pendingAutoMicResume = false;
                            }
                        }
                    }, resumeDelay);
                } else {
                    pendingAutoMicResume = false;
                }
            }
        }, 600);
    }
 }

// Pause microphone to prevent navigator speech from being re-captured.
function pauseRecognitionForNavigatorSpeech(options = {}) {
    const {
        autoResume = false,
        resumeDelay = 1800,
        suppressMs = 1800,
        statusMessage = '🔇 Mikrofon nonaktif sementara'
    } = options;
    pendingAutoMicResume = autoResume;
    pendingAutoMicResumeDelay = resumeDelay;
    if (statusMessage) {
        updateVoiceStatus(statusMessage);
    }
    const suppressUntil = Date.now() + suppressMs;
    if (suppressUntil > suppressRecognitionUntil) {
        suppressRecognitionUntil = suppressUntil;
    }
    if (recognition) {
        recognition._stopped = true;
        recognition._waitingForMode2 = false;
        if (isListening) {
            try {
                recognition.stop();
            } catch (error) {
                console.warn('⚠️ Error stopping recognition for navigator speech pause:', error);
            }
            isListening = false;
        }
    }
}

function formatDistanceForSummary(meters) {
    if (!meters || isNaN(meters)) return '';
    if (meters >= 1000) {
        const km = meters / 1000;
        const formatted = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
        return formatted.toString().replace('.', ',') + ' kilometer';
    }
    return Math.round(meters) + ' meter';
}

function formatDistanceForInstruction(meters) {
    if (!meters || isNaN(meters)) return '';
    if (meters >= 1000) {
        const km = meters / 1000;
        const formatted = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
        return formatted.toString().replace('.', ',') + ' kilometer';
    }
    if (meters >= 100) {
        return Math.round(meters / 50) * 50 + ' meter';
    }
    return Math.max(10, Math.round(meters / 10) * 10) + ' meter';
}

function formatDurationSeconds(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    const minutesTotal = Math.round(seconds / 60);
    const hours = Math.floor(minutesTotal / 60);
    const minutes = minutesTotal % 60;
    let parts = [];
    if (hours > 0) {
        parts.push(hours + ' jam');
    }
    if (minutes > 0) {
        parts.push(minutes + ' menit');
    }
    if (!parts.length) {
        parts.push('kurang dari satu menit');
    }
    return parts.join(' ');
}
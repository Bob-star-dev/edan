// Define requestLocationPermission early so it's available for inline onclick
window.requestLocationPermission = function requestLocationPermission() {
    console.log('requestLocationPermission called');
    
    // Mark user interaction for Speech Synthesis
    if (typeof hasUserInteraction !== 'undefined') {
        hasUserInteraction = true;
    }
    
    if (typeof hidePermissionPopup === 'function') {
        hidePermissionPopup();
    }
    
    if (typeof requestLocation === 'function') {
        requestLocation();
    }
    
    // Trigger welcome guide after button click (valid user interaction)
    setTimeout(function() {
        if (typeof voiceDirectionsEnabled !== 'undefined' && typeof isFirstLoad !== 'undefined' && voiceDirectionsEnabled && isFirstLoad) {
            console.log('📢 Starting SENAVISION welcome guide after button click');
            if (typeof announceWelcomeGuide === 'function') {
                announceWelcomeGuide();
            }
        }
        if (typeof startLocationTracking === 'function') {
            startLocationTracking();
        }
    }, 2000);
};

// Check if there was a pending location permission request before index.js loaded
if (typeof window._pendingLocationPermissionRequest !== 'undefined' && window._pendingLocationPermissionRequest) {
    // Execute the pending request
    setTimeout(function() {
        window.requestLocationPermission();
        window._pendingLocationPermissionRequest = false;
    }, 100);
}

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
let hasPermission = false;
let locationInterval = null;
let watchPositionId = null; // ID untuk watchPosition API (continuous tracking)
let wakeLock = null; // Wake Lock untuk menjaga device tetap aktif
let gpsRetryCount = 0; // Counter untuk retry GPS jika terputus
let announceInterval = null; // Interval untuk memanggil announceNextDirection secara berkala
let isFirstLocationUpdate = true; // Track if this is the first location update

// CRITICAL: Track the BEST GPS location (highest accuracy)
// This prevents default/cached locations from overwriting accurate GPS data
let bestGPSLocation = null; // Store { lat, lng, accuracy }
const MAX_ACCEPTABLE_ACCURACY = 300; // Only accept GPS locations with accuracy < 300m (improved accuracy)

// GPS Smoothing - untuk mengurangi noise/jitter pada koordinat GPS
let gpsHistory = []; // Array untuk menyimpan history GPS coordinates
const GPS_HISTORY_SIZE = 2; // Jumlah titik GPS yang digunakan untuk smoothing (reduced for faster response)
const MIN_DISTANCE_FOR_UPDATE = 0.3; // Minimum jarak (meter) untuk update marker (reduced for real-time accuracy)

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

// Turn markers array for navigation
let turnMarkers = [];
let nextTurnMarkerIndex = 0;

// Flag untuk menandai bahwa kita sedang menunggu announcement setelah route dibuat
let pendingRouteAnnouncementData = null; // { shortName, fullName, onComplete }

// Helper function to move routing directions to custom container
function moveRoutingDirectionsToContainer() {
    const routingContainer = document.getElementById('routingDirectionsContainer');
    if (!routingContainer) return;
    
    // Try multiple times with increasing delays to ensure routing directions are moved
    let attempts = 0;
    const maxAttempts = 15;
    
    function tryMove() {
        attempts++;
        const defaultContainer = document.querySelector('.leaflet-top.leaflet-right .leaflet-routing-container');
        if (defaultContainer) {
            // Clear placeholder
            const placeholder = routingContainer.querySelector('.directions-placeholder');
            if (placeholder) placeholder.remove();
            
            // Move routing container to custom location
            const routingAltContainer = defaultContainer.querySelector('.leaflet-routing-alternatives-container');
            if (routingAltContainer) {
                // Check if already moved
                if (routingAltContainer.parentNode !== routingContainer) {
                    routingContainer.appendChild(routingAltContainer);
                    console.log('✅ Routing directions moved to navbar');
                    return true; // Success
                } else {
                    // Already moved, but make sure it's visible
                    routingAltContainer.style.display = '';
                    return true;
                }
            }
        }
        
        // If not found and haven't exceeded max attempts, try again
        if (attempts < maxAttempts) {
            setTimeout(tryMove, 200);
        } else {
            console.warn('⚠️ Failed to move routing directions after', maxAttempts, 'attempts');
        }
        return false;
    }
    
    // Start trying after initial delay
    setTimeout(tryMove, 100);
}

// Set up MutationObserver to automatically move routing directions when they appear
(function setupRoutingDirectionsObserver() {
    const routingContainer = document.getElementById('routingDirectionsContainer');
    if (!routingContainer) {
        // Retry after DOM is ready
        setTimeout(setupRoutingDirectionsObserver, 500);
        return;
    }
    
    // Observe changes to the default routing container location
    const observer = new MutationObserver(function(mutations) {
        const defaultContainer = document.querySelector('.leaflet-top.leaflet-right .leaflet-routing-container');
        if (defaultContainer) {
            const routingAltContainer = defaultContainer.querySelector('.leaflet-routing-alternatives-container');
            if (routingAltContainer && routingAltContainer.parentNode !== routingContainer) {
                moveRoutingDirectionsToContainer();
            }
        }
    });
    
    // Start observing the map container for changes
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        observer.observe(mapContainer, {
            childList: true,
            subtree: true
        });
    }
})();

// Speech Recognition Variables
let recognition = null;
let isListening = false;
let finalTranscript = '';
// FIXED: Track last command for handling split recognition (e.g., "rute" then "1")
if (typeof window.lastCommand === 'undefined') {
    window.lastCommand = '';
}
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

// Global Speech Coordinator - Koordinasi suara antara navigasi dan YOLO detector
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
    
    // Set navigation active state
    setNavigating: function(active) {
        this.isNavigating = active;
        if (active) {
            console.log('[SpeechCoordinator] 🧭 Navigation mode activated - YOLO detector can run in background');
        } else {
            console.log('[SpeechCoordinator] 🧭 Navigation mode deactivated');
        }
    },
    
    // Request permission to speak (returns true if allowed)
    // priority: 'critical' (collision warning), 'high' (navigation), 'normal' (object announcement)
    requestSpeak: function(priority = 'high') {
        // Critical priority (collision warning) - wait for navigation to finish, but interrupt other speech
        if (priority === 'critical') {
            if (this.isNavigationActive()) {
                console.log('[SpeechCoordinator] ⏸️ Critical warning delayed - navigation speaking');
                return false;
            }
            
            const speechSynthesisActive = (typeof window.speechSynthesis !== 'undefined') && 
                                          window.speechSynthesis.speaking;
            if (speechSynthesisActive) {
                console.log('[SpeechCoordinator] 🚨 Critical warning - canceling non-navigation speech');
                if (typeof window.speechSynthesis !== 'undefined') {
                    window.speechSynthesis.cancel();
                }
                this.isModeDetectorSpeaking = false;
                if (typeof isSpeaking !== 'undefined') {
                    isSpeaking = false;
                }
            }
            
            this.isModeDetectorWarning = true;
            return true;
        }
        
        // High priority (navigation directions) - wait only for critical warnings
        if (priority === 'high') {
            // CRITICAL: Untuk announcement belokan, hanya tunggu critical warning yang benar-benar aktif
            // Jika critical warning sudah selesai atau tidak aktif, langsung izinkan
            if (this.isModeDetectorWarning) {
                const actuallyWarning = (typeof window.speechSynthesis !== 'undefined') && 
                                       window.speechSynthesis.speaking && 
                                       this.isModeDetectorWarning;
                if (actuallyWarning) {
                    // Untuk belokan, jangan tunggu terlalu lama - izinkan setelah 200ms maksimal
                    console.log('[SpeechCoordinator] ⏸️ Navigation speech delayed - mode detector warning active, will allow after 200ms...');
                    // Set flag untuk izinkan setelah 200ms
                    setTimeout(() => {
                        this.isModeDetectorWarning = false;
                        this.isNavigationSpeaking = true;
                        if (typeof isSpeaking !== 'undefined') {
                            isSpeaking = true;
                        }
                        console.log('[SpeechCoordinator] ✅ Navigation speech allowed after timeout (HIGH PRIORITY - turn instructions are critical)');
                    }, 200);
                    // Return false untuk trigger retry mechanism di announceNextDirection
                    return false;
                } else {
                    this.isModeDetectorWarning = false;
                }
            }
            
            // Navigation HARUS bisa interrupt mode detector (prioritas tertinggi setelah critical)
            if (this.isModeDetectorSpeaking && !this.isModeDetectorWarning) {
                const actuallySpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                        window.speechSynthesis.speaking;
                if (actuallySpeaking) {
                    console.log('[SpeechCoordinator] 🚨 Navigation FORCE interrupting mode detector speech');
                    if (typeof window.speechSynthesis !== 'undefined') {
                        window.speechSynthesis.cancel();
                    }
                }
                this.isModeDetectorSpeaking = false;
            }
            
            // CRITICAL: Jika ada speech navigation lain yang sedang berjalan, cancel untuk announcement baru
            // Ini memastikan announcement belokan selalu bisa muncul (belokan lebih penting dari announcement lain)
            if (this.isNavigationSpeaking) {
                const actuallySpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                        window.speechSynthesis.speaking;
                if (actuallySpeaking) {
                    console.log('[SpeechCoordinator] 🔄 Navigation interrupting previous navigation speech for new turn announcement');
                    if (typeof window.speechSynthesis !== 'undefined') {
                        window.speechSynthesis.cancel();
                    }
                    // Tunggu sedikit untuk cancel selesai
                    setTimeout(() => {
                        this.isNavigationSpeaking = true;
                        if (typeof isSpeaking !== 'undefined') {
                            isSpeaking = true;
                        }
                    }, 50);
                } else {
                    // Speech sudah selesai, reset flag
                    this.isNavigationSpeaking = false;
                    if (typeof isSpeaking !== 'undefined') {
                        isSpeaking = false;
                    }
                }
            }
            
            // Set navigation state BEFORE allowing speech
            this.isNavigationSpeaking = true;
            if (typeof isSpeaking !== 'undefined') {
                isSpeaking = true;
            }
            
            console.log('[SpeechCoordinator] ✅ Navigation speech allowed (HIGH PRIORITY)');
            return true;
        }
        
        // Normal priority (object announcements) - MUST wait for navigation
        if (priority === 'normal') {
            const speechSynthesisSpeaking = (typeof window.speechSynthesis !== 'undefined') && 
                                           window.speechSynthesis.speaking;
            
            // PRIORITAS: Navigator selalu lebih penting dari object detector
            if (this.isNavigationSpeaking || this.isNavigationActive()) {
                console.log('[SpeechCoordinator] ⏸️ Mode detector BLOCKED - navigation has priority');
                return false;
            }
            
            if (this.isNavigating) {
                if (speechSynthesisSpeaking) {
                    console.log('[SpeechCoordinator] ⏸️ Mode detector waiting - speech active during navigation');
                    return false;
                }
                console.log('[SpeechCoordinator] ⏸️ Mode detector waiting - navigation mode active');
                return false;
            } else {
                if (!speechSynthesisSpeaking) {
                    if (this.isNavigationSpeaking) {
                        this.isNavigationSpeaking = false;
                        if (typeof isSpeaking !== 'undefined') {
                            isSpeaking = false;
                        }
                    }
                    if (!this.isModeDetectorWarning) {
                        this.isModeDetectorSpeaking = true;
                        console.log('[SpeechCoordinator] ✅ Mode detector speech allowed (no navigation, no speech)');
                        return true;
                    }
                }
            }
            
            this.isModeDetectorSpeaking = true;
            console.log('[SpeechCoordinator] ✅ Mode detector speech allowed');
            return true;
        }
        
        return false;
    },
    
    // Mark speech as finished
    markSpeechEnd: function(priority = 'high') {
        if (priority === 'critical') {
            this.isModeDetectorWarning = false;
            console.log('[SpeechCoordinator] ✅ Critical warning ended');
            this.processQueues();
        } else if (priority === 'high') {
            this.isNavigationSpeaking = false;
            if (typeof isSpeaking !== 'undefined') {
                isSpeaking = false;
            }
            console.log('[SpeechCoordinator] ✅ Navigation speech ended');
            if (this.isNavigating) {
                setTimeout(() => {
                    this.processQueues();
                }, 100);
            }
        } else if (priority === 'normal') {
            this.isModeDetectorSpeaking = false;
            console.log('[SpeechCoordinator] ✅ Mode detector speech ended');
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
        
        if (!speechSynthesisSpeaking) {
            this.isNavigationSpeaking = false;
            this.isModeDetectorSpeaking = false;
            if (typeof isSpeaking !== 'undefined') {
                isSpeaking = false;
            }
            
            if (this.modeDetectorQueue.length > 0) {
                const item = this.modeDetectorQueue.shift();
                console.log('[SpeechCoordinator] 🔄 Processing queued mode detector speech');
            }
            
            if (this.navigationQueue.length > 0) {
                const item = this.navigationQueue.shift();
                console.log('[SpeechCoordinator] 🔄 Processing queued navigation speech');
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
        if (typeof isSpeaking !== 'undefined') {
            isSpeaking = false;
        }
        console.log('[SpeechCoordinator] 🔄 All states reset');
    },
    
    handleNavigationSpeechStart: function(reason = 'navigation') {
        // No-op: simplified coordinator doesn't need to pause anything
    },
    
    handleNavigationSpeechEnd: function(reason = 'navigation') {
        // No-op: simplified coordinator doesn't need to resume anything
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

// Turn markers variables for navigation
let turnMarkers = []; // Array to store turn markers on the map
let turnMarkerData = []; // Array to store turn marker metadata
let nextTurnMarkerIndex = 0; // Index of next turn marker to highlight

// FIXED: Debounce/throttle mechanism untuk announceNextDirection
let lastAnnounceCallTime = 0;
let lastAnnounceDistance = null;
let lastAnnounceInstruction = null;
const MIN_ANNOUNCE_INTERVAL = 400; // Minimum 400ms between announcements (prevents too frequent calls, but allows responsive updates)
const MIN_DISTANCE_CHANGE = 2; // Minimum 2m distance change to trigger new announcement (more responsive)

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

// Copy all debug logs to clipboard
async function copyDebugLogs() {
    const debugLogsContainer = document.getElementById('debugLogs');
    const copyBtn = document.getElementById('copyDebugBtn');
    
    if (!debugLogsContainer) {
        console.warn('Debug logs container not found');
        return;
    }
    
    let logText = ''; // Declare in outer scope for fallback
    
    try {
        // Get all log entries from DOM
        const logEntries = debugLogsContainer.querySelectorAll('.debug-log-entry');
        
        if (logEntries.length === 0) {
            // Try to get from stored debugLogs array
            if (debugLogs.length === 0) {
                console.log('No debug logs to copy');
                if (copyBtn) {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = '⚠️ No logs';
                    setTimeout(() => {
                        copyBtn.textContent = originalText;
                    }, 2000);
                }
                return;
            }
            
            // Format from stored array
            logText = `=== SENAVISION Debug Logs ===\n`;
            logText += `Generated: ${new Date().toLocaleString('id-ID')}\n`;
            logText += `Total logs: ${debugLogs.length}\n\n`;
            
            debugLogs.forEach((log, index) => {
                const timeStr = log.time ? log.time.toLocaleTimeString('id-ID', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit',
                    fractionalSecondDigits: 3
                }) : 'N/A';
                logText += `[${index + 1}] [${timeStr}] [${log.type.toUpperCase()}] ${log.message}\n`;
            });
            
            // Copy to clipboard
            await navigator.clipboard.writeText(logText);
            console.log(`✅ Copied ${debugLogs.length} debug logs to clipboard`);
            
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            }
            return;
        }
        
        // Format from DOM elements
        logText = `=== SENAVISION Debug Logs ===\n`;
        logText += `Generated: ${new Date().toLocaleString('id-ID')}\n`;
        logText += `Total logs: ${logEntries.length}\n\n`;
        
        logEntries.forEach((entry, index) => {
            const timeEl = entry.querySelector('.debug-log-time');
            const messageEl = entry.querySelector('.debug-log-message');
            
            const timeStr = timeEl ? timeEl.textContent : 'N/A';
            const message = messageEl ? messageEl.textContent : entry.textContent;
            const type = entry.classList.contains('error') ? 'ERROR' : 
                        entry.classList.contains('warn') ? 'WARN' : 
                        entry.classList.contains('info') ? 'INFO' : 'LOG';
            
            logText += `[${index + 1}] ${timeStr} [${type}] ${message}\n`;
        });
        
        // Copy to clipboard
        await navigator.clipboard.writeText(logText);
        console.log(`✅ Copied ${logEntries.length} debug logs to clipboard`);
        
        // Update button to show success
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        }
        
    } catch (error) {
        console.error('❌ Failed to copy debug logs:', error);
        
        // Fallback: try using execCommand for older browsers
        try {
            if (!logText) {
                logText = 'No logs available';
            }
            const textArea = document.createElement('textarea');
            textArea.value = logText;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            console.log('✅ Copied using fallback method');
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
            }
        } catch (fallbackError) {
            console.error('❌ Fallback copy also failed:', fallbackError);
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '❌ Failed';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
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
    
    // Initialize vibration control with Firebase Realtime Database
    if (window.onAuthReady && window.initVibrationControl) {
        window.onAuthReady(async function(user) {
            // Initialize vibration control after Firebase is ready
            // This will listen to /vibration/side and control GPIO12/GPIO13
            try {
                await window.initVibrationControl();
                console.log('[Map] ✅ Vibration control initialized');
            } catch (error) {
                console.error('[Map] ❌ Failed to initialize vibration control:', error);
            }
        });
    } else {
        // Fallback: try to initialize after a delay if onAuthReady is not available
        setTimeout(async () => {
            if (window.initVibrationControl) {
                try {
                    await window.initVibrationControl();
                    console.log('[Map] ✅ Vibration control initialized (fallback)');
                } catch (error) {
                    console.error('[Map] ❌ Failed to initialize vibration control:', error);
                }
            }
        }, 2000);
    }
    
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
    // Accuracy dari GPS sudah dalam meter (radius 95% confidence)
    // e.accuracy adalah radius akurasi dalam meter, tidak perlu dibagi 2
    const actualAccuracy = e.accuracy;
    
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
        const shouldUpdateAccuracy = !isUnacceptableAccuracy || !bestGPSLocation || accuracy < bestGPSLocation.accuracy;
        
        if (!shouldUpdateAccuracy) {
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
                
                // Accuracy circle removed - no longer needed
            }
            return; // JANGAN lanjutkan - block update dari lokasi tidak akurat
        }
        
        // Update existing marker position ke lokasi saat ini (REAL-TIME)
        // setLatLng() memastikan marker selalu bergerak mengikuti lokasi GPS AKURAT
        const oldLatLng = currentUserPosition.getLatLng();
        
        // CRITICAL: During navigation, use GPS position directly for real-time accuracy
        // Only apply minimal smoothing when not navigating to reduce jitter
        let smoothedLatLng = e.latlng;
        
        if (isNavigating) {
            // During navigation: Use GPS position directly for maximum accuracy and responsiveness
            // No smoothing during navigation to ensure real-time position tracking
            smoothedLatLng = e.latlng;
            console.log('🧭 Navigation mode: Using GPS position directly (no smoothing)');
        } else {
            // When not navigating: Apply minimal smoothing to reduce jitter
            gpsHistory.push({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: accuracy });
            if (gpsHistory.length > GPS_HISTORY_SIZE) {
                gpsHistory.shift(); // Hapus titik tertua
            }
            
            // Minimal smoothing: only if we have 2+ points and accuracy is good
            if (gpsHistory.length >= 2 && accuracy < 30) {
                // Use weighted average: more weight to latest position
                const latest = gpsHistory[gpsHistory.length - 1];
                const previous = gpsHistory[gpsHistory.length - 2];
                // 70% latest, 30% previous for faster response
                const avgLat = (latest.lat * 0.7) + (previous.lat * 0.3);
                const avgLng = (latest.lng * 0.7) + (previous.lng * 0.3);
                smoothedLatLng = L.latLng(avgLat, avgLng);
            }
        }
        
        // FIXED: Store smoothedLatLng in a variable accessible later for map panning
        const finalUserPosition = smoothedLatLng;
        
        // CRITICAL: During navigation, always update marker for real-time tracking
        // When not navigating, use distance threshold to reduce jitter
        const distanceMoved = oldLatLng ? oldLatLng.distanceTo(smoothedLatLng) : 0;
        const shouldUpdateMarker = isNavigating ? true : (distanceMoved >= MIN_DISTANCE_FOR_UPDATE || !oldLatLng);
        
        if (shouldUpdateMarker) {
            currentUserPosition.setLatLng(smoothedLatLng);
            // Tampilkan accuracy aktual di popup, bukan radius terbatas
            currentUserPosition.setPopupContent("📍 Lokasi Anda (Akurasi GPS: " + actualAccuracy.toFixed(0) + "m)");
            
            // Keep blue circle icon during navigation (no change to green arrow)
            // Marker tetap biru saat navigasi sesuai permintaan user
            
            // Log untuk debugging - memastikan marker selalu update
            if (isNavigating && distanceMoved > 0.5) { // Log lebih sering during navigation
                console.log('📍 Marker updated (nav) - moved ' + distanceMoved.toFixed(2) + 'm to:', smoothedLatLng.lat.toFixed(6) + ', ' + smoothedLatLng.lng.toFixed(6));
            } else if (!isNavigating && distanceMoved > 1) {
                console.log('📍 Marker updated - moved ' + distanceMoved.toFixed(1) + 'm to:', smoothedLatLng.lat.toFixed(6) + ', ' + smoothedLatLng.lng.toFixed(6));
            }
        } else {
            // Jitter detected - tidak update marker untuk mengurangi noise (only when not navigating)
            // During navigation, always update for real-time accuracy
            if (!isNavigating && Math.random() < 0.01) { // Log hanya 1% dari waktu untuk menghindari spam
                console.log('📍 GPS jitter filtered - movement < ' + MIN_DISTANCE_FOR_UPDATE + 'm');
            }
        }
        
        // Verifikasi marker benar-benar di posisi yang benar
        const currentMarkerPos = currentUserPosition.getLatLng();
        const finalLatLng = smoothedLatLng;
        if (Math.abs(currentMarkerPos.lat - finalLatLng.lat) > 0.000001 || 
            Math.abs(currentMarkerPos.lng - finalLatLng.lng) > 0.000001) {
            // Only correct if distance is significant (avoid unnecessary updates)
            const correctionDistance = currentMarkerPos.distanceTo(finalLatLng);
            if (correctionDistance > 1) { // Only correct if > 1 meter
                console.warn('⚠️ Marker position mismatch detected - correcting...');
                currentUserPosition.setLatLng(finalLatLng); // Force update jika ada mismatch
            }
        }
    } else {
        // Create marker untuk pertama kali - PASTIKAN menggunakan lokasi GPS AKURAT
        // Jika ada lokasi GPS terbaik, gunakan yang terbaik; jika tidak, gunakan yang saat ini (jika akurat)
        const markerLocation = (bestGPSLocation && !isUnacceptableAccuracy) ? 
            L.latLng(bestGPSLocation.lat, bestGPSLocation.lng) : 
            (isUnacceptableAccuracy ? (bestGPSLocation ? L.latLng(bestGPSLocation.lat, bestGPSLocation.lng) : e.latlng) : e.latlng);
        
        // Always use blue circle icon (both navigation and normal mode)
        // Marker tetap biru saat navigasi sesuai permintaan user
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
    
    // Accuracy circle removed - no longer displaying accuracy circle on map
    
    // Auto-center map to user location (only first time)
    // This makes the map automatically zoom to user's position when opened
    // Using zoom level 13 for wider view (was 16 for closer view)
    if (isFirstLocationUpdate) {
        map.setView(e.latlng, 13);
        isFirstLocationUpdate = false; // Reset flag after first update
    }
    
    // PASTIKAN marker biru selalu di lokasi saat ini - verifikasi dan pan map jika perlu
    // Ini memastikan marker selalu terlihat dan di posisi yang benar selama navigasi
    // CRITICAL: Hanya update marker position saat navigasi aktif untuk mencegah marker berpindah saat klik/zoom
    if (currentUserPosition) {
        const markerLatLng = currentUserPosition.getLatLng();
        const distanceMoved = e.latlng.distanceTo(markerLatLng);
        
        // Hanya force update marker jika navigasi aktif
        // Saat navigasi tidak aktif, marker hanya update melalui normal GPS flow (dengan filter jitter)
        if (isNavigating) {
            // Jika marker terlalu jauh dari lokasi GPS (lebih dari 50m), force update
            if (distanceMoved > 50) {
                console.warn('⚠️ Marker terlalu jauh dari GPS (' + distanceMoved.toFixed(0) + 'm) - force update');
                currentUserPosition.setLatLng(e.latlng);
            }
            
            // FIXED: Navigation mode - Always pan map to follow user position during navigation
            // This ensures the map view always follows the user's GPS position
            // CRITICAL: Use GPS position directly during navigation (no smoothing for map panning)
            const targetPosition = e.latlng; // Use GPS position directly for real-time accuracy
            
            // Calculate distance from current map center to user position
            const mapCenter = map.getCenter();
            const distanceFromCenter = mapCenter ? mapCenter.distanceTo(targetPosition) : 999999;
            
            // DISABLED: Auto-pan during navigation - user can manually control map
            // Map tetap bisa di-geser dan di-zoom manual oleh user
            // Tidak ada auto-pan yang memaksa map mengikuti user
        }
        // Saat navigasi tidak aktif, marker tidak akan dipaksa update saat klik/zoom
        // Marker hanya akan update melalui normal GPS update flow (line 910) yang sudah ada filter jitter
    }
    
    // Don't create route automatically - wait for user to set destination
    // Route will be created when user sets destination via voice command
    // CRITICAL: Only update route during active navigation to prevent route changes when map is clicked/zoomed
    if (latLngB && destinationMarker && isNavigating) {
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
                
                // Clear announceNextDirection interval
                if (announceInterval) {
                    clearInterval(announceInterval);
                    announceInterval = null;
                    console.log('[Navigation] ✅ Stopped announceNextDirection interval (arrived at destination)');
                }
                
                // Release Wake Lock saat navigasi berhenti
                releaseWakeLock();
                
                // Reset marker icon to normal (blue circle)
                if (currentUserPosition) {
                    const normalIcon = L.divIcon({
                        className: 'custom-user-marker',
                        html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    currentUserPosition.setIcon(normalIcon);
                }
                
                // Exit fullscreen
                const exitFullscreen = document.exitFullscreen || 
                                      document.webkitExitFullscreen || 
                                      document.mozCancelFullScreen || 
                                      document.msExitFullscreen;
                if (exitFullscreen) {
                    exitFullscreen.call(document).catch(err => {
                        console.log('Exit fullscreen failed:', err);
                    });
                }
                
                // Remove 3D/isometric perspective and reset zoom
                document.body.classList.remove('navigating');
                document.documentElement.classList.remove('navigating');
                
                // Restore body/html styles
                document.body.style.width = '';
                document.body.style.height = '';
                document.body.style.margin = '';
                document.body.style.padding = '';
                document.body.style.overflow = '';
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.left = '';
                document.body.style.right = '';
                document.body.style.bottom = '';
                
                document.documentElement.style.width = '';
                document.documentElement.style.height = '';
                document.documentElement.style.margin = '';
                document.documentElement.style.padding = '';
                document.documentElement.style.overflow = '';
                document.documentElement.style.position = '';
                document.documentElement.style.top = '';
                document.documentElement.style.left = '';
                document.documentElement.style.right = '';
                document.documentElement.style.bottom = '';
                
                // Reset map styles
                const mapElement = document.getElementById('map');
                if (mapElement) {
                    mapElement.style.position = '';
                    mapElement.style.top = '';
                    mapElement.style.left = '';
                    mapElement.style.right = '';
                    mapElement.style.bottom = '';
                    mapElement.style.width = '';
                    mapElement.style.height = '';
                    mapElement.style.zIndex = '';
                }
                
                const leafletContainer = document.querySelector('.leaflet-container');
                if (leafletContainer) {
                    leafletContainer.style.position = '';
                    leafletContainer.style.top = '';
                    leafletContainer.style.left = '';
                    leafletContainer.style.right = '';
                    leafletContainer.style.bottom = '';
                    leafletContainer.style.width = '';
                    leafletContainer.style.height = '';
                }
                
                // Show sidebar again
                const navbar = document.getElementById('sideNavbar');
                if (navbar) {
                    navbar.classList.remove('collapsed');
                    navbar.style.display = '';
                    navbar.style.visibility = '';
                }
                
                // Show toggle button
                const toggleBtn = document.getElementById('navbarToggleBtn');
                if (toggleBtn) {
                    toggleBtn.style.display = '';
                    toggleBtn.style.visibility = '';
                }
                
                // Show back button
                const backBtn = document.getElementById('backToHomeBtn');
                if (backBtn) {
                    backBtn.style.display = '';
                    backBtn.style.visibility = '';
                }
                
                // CRITICAL: Hide floating debug button when navigation stops
                const floatingDebugBtn = document.getElementById('floatingDebugBtn');
                if (floatingDebugBtn) {
                    floatingDebugBtn.style.display = 'none';
                    floatingDebugBtn.style.visibility = 'hidden';
                }
                
                // Force map resize
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
                
                const currentZoom = map.getZoom();
                if (currentZoom > 15) {
                    map.setZoom(15, { animate: true, duration: 0.5 });
                }
                
                // Force map resize
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
                
                // Nonaktifkan flag navigasi di SpeechCoordinator
                if (typeof window.SpeechCoordinator !== 'undefined') {
                    window.SpeechCoordinator.setNavigating(false);
                }
                
                // Deactivate YOLO Detector saat navigasi berhenti
                if (typeof window.YOLODetector !== 'undefined') {
                    const yoloState = window.YOLODetector.getState();
                    if (yoloState.isActive) {
                        console.log('🔄 Deactivating YOLO Detector - navigation ended');
                        window.YOLODetector.deactivate();
                        console.log('✅ YOLO Detector deactivated');
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
        
        // FIXED: Update real-time instructions immediately and more frequently for accuracy
        // Update immediately for real-time accuracy
        if (typeof updateRealTimeInstructions === 'function') {
            updateRealTimeInstructions(e.latlng);
        }
        
        // Also update with delays to ensure accuracy
        setTimeout(function() {
            if (typeof updateRealTimeInstructions === 'function') {
                updateRealTimeInstructions(e.latlng);
            }
        }, 200); // Update after 200ms
        
        setTimeout(function() {
            if (typeof updateRealTimeInstructions === 'function') {
                updateRealTimeInstructions(e.latlng);
            }
        }, 500); // Update after 500ms
        
        // Also try fallback method using route data (more reliable)
        setTimeout(function() {
            if (typeof announceFromRouteData === 'function') {
                announceFromRouteData();
            }
        }, 700);
        
        // Update turn markers: hapus yang sudah dilewati dan highlight berikutnya
        if (typeof updateTurnMarkers === 'function') {
            updateTurnMarkers(e.latlng);
        }
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
let speechStartTime = 0; // Track when current speech started (to prevent premature cancellation)
const MIN_SPEECH_DURATION = 1500; // Minimum 1.5 seconds before allowing cancellation (prevents interrupting speech that just started)

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
        clearTurnMarkers(); // Clear turn markers when route is removed
        map.removeControl(route);
        route = null;
    }
    
    // Clear turn markers when route is removed
    clearTurnMarkers();
    
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
    
    // Move routing directions to custom container after creation
    moveRoutingDirectionsToContainer();
    
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
        
        // Store route data untuk test navigation
        if (e.routes && e.routes[0] && e.routes[0].coordinates) {
            route._lastRouteData = e.routes[0];
            window._currentRouteData = e.routes[0]; // Store globally untuk test
            console.log('✅ Route coordinates stored for test:', e.routes[0].coordinates.length, 'points');
        }
        
        // Move routing directions to custom container after route is found
        moveRoutingDirectionsToContainer();
        
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
        
        // CRITICAL: Store route data with all instructions and coordinates for turn detection
        currentRouteData = routeData;
        console.log('[Navigation] ✅ Route data stored:', {
            hasInstructions: !!(routeData && routeData.instructions),
            instructionCount: routeData && routeData.instructions ? routeData.instructions.length : 0,
            hasCoordinates: !!(routeData && routeData.coordinates),
            coordinateCount: routeData && routeData.coordinates ? routeData.coordinates.length : 0
        });
        
        currentLegIndex = 0;
        lastAnnouncedInstruction = null;
        announcedInstructions = []; // Reset announced instructions
        isNavigating = false; // Not navigating yet - wait for user command
        shouldAnnounceRoute = false; // Don't auto-announce route yet
        
        // CRITICAL: Always populate lastRouteSummarySpeech when route is found
        if (routeData && routeData.summary) {
            const sum = routeData.summary;
            const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
            const distanceSpeech = formatDistanceForSummary(sum.totalDistance);
            const durationSpeech = formatDurationSeconds(sum.totalTime);
            lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Jarak ' + distanceSpeech + ', perkiraan waktu ' + durationSpeech + '.';
            console.log('[Navigation] ✅ lastRouteSummarySpeech populated:', lastRouteSummarySpeech);
        } else {
            // Fallback: generate basic announcement even if summary is missing
            const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
            lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Navigasi siap.';
            console.log('[Navigation] ⚠️ Route summary missing - using fallback:', lastRouteSummarySpeech);
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
        } else if (pendingRouteAnnouncementData) {
            // NEW: Handle announcement for geocoded destinations
            const pending = pendingRouteAnnouncementData;
            const sum = e.routes[0].summary;
            const distanceKm = sum.totalDistance ? (sum.totalDistance / 1000).toFixed(1) : '0';
            const timeMinutes = sum.totalTime ? Math.round(sum.totalTime / 60) : 0;
            
            console.log('✅✅✅ Route found - announcing destination and route info');
            
            // STEP 6: Announcement nama lokasi tujuan dan jarak rute
            const destinationAnnouncement = 'Tujuan Anda adalah ' + pending.shortName + 
                '. Jarak ' + distanceKm + ' kilometer, perkiraan waktu tempuh ' + timeMinutes + ' menit.';
            
            speakText(destinationAnnouncement, 'id-ID', true, function() {
                // STEP 7: Announcement instruksi untuk Navigasi
                const instructionAnnouncement = 'Katakan Navigasi jika ingin memulai perjalanan. ' +
                    'Jika tidak, sebutkan nama lokasi lagi.';
                
                speakText(instructionAnnouncement, 'id-ID', true, function() {
                    // STEP 8: Hidupkan mikrofon untuk mendengarkan "Navigasi"
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            try {
                                recognition.start();
                                isListening = true;
                                recognition._waitingForNavigasi = true;
                                console.log('🎤 Microphone restarted - listening for "Navigasi" command');
                                updateVoiceStatus('✅ Tujuan: ' + pending.shortName + ' - Ucapkan "Navigasi" untuk memulai');
                                
                                // Auto-stop after 15 seconds if "Navigasi" not said
                                recognition._navigasiTimer = setTimeout(function() {
                                    if (recognition && recognition._waitingForNavigasi && isListening) {
                                        recognition.stop();
                                        recognition._stopped = true;
                                        recognition._waitingForNavigasi = false;
                                        recognition._navigasiTimer = null;
                                        isListening = false;
                                        console.log('🔇 Microphone stopped - "Navigasi" window expired');
                                        updateVoiceStatus('✅ Tujuan: ' + pending.shortName + ' - Ucapkan "Halo" lalu "Navigasi" untuk memulai');
                                    }
                                }, 15000); // 15 second window
                            } catch (error) {
                                console.error('Failed to restart microphone:', error);
                                recognition._stopped = true;
                            }
                        }
                    }, 500);
                });
            });
            
            // Clear pending announcement data
            pendingRouteAnnouncementData = null;
        } else {
            // No pending announcement - old behavior
            console.log('✅✅✅ Route found - waiting for user to say "Navigasi" to start');
        }
        
        // Translate instructions to Indonesian but don't announce yet
        translateRouteInstructions();
        
        // Create turn markers for all turns in the route
        createTurnMarkers(routeData);
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
        
        // Move routing directions to custom container after creation
        moveRoutingDirectionsToContainer();
        
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
        // Move routing directions to custom container after route is found
        moveRoutingDirectionsToContainer();
        
        // Store route data untuk test navigation
        if (e.routes && e.routes[0] && e.routes[0].coordinates) {
            route._lastRouteData = e.routes[0];
            window._currentRouteData = e.routes[0]; // Store globally untuk test
            console.log('✅ Route coordinates stored for test:', e.routes[0].coordinates.length, 'points');
        }
        
        // Save route data for navigation tracking
        const routeData = e.routes[0];
        currentLegIndex = 0;
        lastAnnouncedInstruction = null;
        announcedInstructions = []; // Reset announced instructions
        isNavigating = false; // Not navigating yet
        console.log('[Navigation] ✅ currentRouteData set:', !!currentRouteData, 'coordinates:', currentRouteData?.coordinates?.length || 0, 'instructions:', currentRouteData?.instructions?.length || 0);
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
                
                // Create turn markers for all turns in the route
                createTurnMarkers(routeData);
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
                            clearTurnMarkers(); // Clear turn markers when route is removed
                            map.removeControl(route);
                            route = null;
                            // Clear turn markers when route is removed
                            clearTurnMarkers();
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
                        
                        // Move routing directions to custom container after creation
                        moveRoutingDirectionsToContainer();
                        
                        // Re-attach event listener for new route
                        route.on('routesfound', function(e) {
                            console.log('✅✅✅ NEW ROUTE FOUND AFTER DESTINATION CHANGE!');
                            
                            // Store route data untuk test navigation
                            if (e.routes && e.routes[0] && e.routes[0].coordinates) {
                                route._lastRouteData = e.routes[0];
                                window._currentRouteData = e.routes[0]; // Store globally untuk test
                                console.log('✅ Route coordinates stored for test:', e.routes[0].coordinates.length, 'points');
                            }
                            
                            // Move routing directions to custom container after route is found
                            moveRoutingDirectionsToContainer();
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
                            console.log('[Navigation] ✅ currentRouteData set:', {
                                hasRoute: !!routeData,
                                hasInstructions: !!(routeData && routeData.instructions),
                                instructionCount: routeData && routeData.instructions ? routeData.instructions.length : 0
                            });
                            
                            // Create turn markers for all turns in the route
                            // Delay sedikit untuk memastikan route sudah fully rendered
                            setTimeout(function() {
                                if (routeData && routeData.instructions) {
                                    createTurnMarkers(routeData);
                                }
                            }, 500);
                            
        // CRITICAL: Always populate lastRouteSummarySpeech when route is found
        if (routeData && routeData.summary) {
            const sum = routeData.summary;
            const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
            const distanceSpeech = formatDistanceForSummary(sum.totalDistance);
            const durationSpeech = formatDurationSeconds(sum.totalTime);
            lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Jarak ' + distanceSpeech + ', perkiraan waktu ' + durationSpeech + '.';
            console.log('[Navigation] ✅ lastRouteSummarySpeech populated:', lastRouteSummarySpeech);
        } else {
            // Fallback: generate basic announcement even if summary is missing
            const destinationName = (pendingRouteAnnouncement && pendingRouteAnnouncement.endName) || currentDestinationName || 'tujuan Anda';
            lastRouteSummarySpeech = 'Rute menuju ' + destinationName + '. Navigasi siap.';
            console.log('[Navigation] ⚠️ Route summary missing - using fallback:', lastRouteSummarySpeech);
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
                            
                            // Translate instructions to Indonesian but don't announce yet
                            translateRouteInstructions();
                            
                            // Create turn markers for all turns in the route
                            createTurnMarkers(routeData);
                            
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
                        // CRITICAL: Only update route during active navigation to prevent route changes when map is clicked/zoomed
                        if (isNavigating) {
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
                        } else {
                            console.log('ℹ️ User location changed but navigation not active - skipping route update');
                        }
                    }
                } else {
                    console.log('ℹ️ Route waypoints unchanged, skipping update');
                }
            } // Close else block for valid coordinates
        } else {
            // Fallback: just update the route
            // CRITICAL: Only update route during active navigation to prevent route changes when map is clicked/zoomed
            if (isNavigating) {
                console.log('🔄 Updating route waypoints (fallback)');
                route.setWaypoints([
                    L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]),
                    L.latLng(latLngB[0], latLngB[1])
                ]);
            } else {
                console.log('ℹ️ Route waypoints update skipped - navigation not active');
            }
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

// Function to request Wake Lock (menjaga device tetap aktif)
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('✅ Wake Lock aktif - Device tidak akan sleep');
            
            // Handle wake lock release (jika user manually lock screen)
            wakeLock.addEventListener('release', () => {
                console.log('⚠️ Wake Lock released - GPS mungkin terpengaruh');
                // Re-request wake lock if navigating
                if (isNavigating) {
                    setTimeout(requestWakeLock, 1000);
                }
            });
        } catch (err) {
            console.warn('⚠️ Wake Lock tidak tersedia:', err.name, err.message);
        }
    } else {
        console.warn('⚠️ Wake Lock API tidak didukung di browser ini');
    }
}

// Function to release Wake Lock
async function releaseWakeLock() {
    if (wakeLock !== null) {
        try {
            await wakeLock.release();
            wakeLock = null;
            console.log('🔓 Wake Lock released');
        } catch (err) {
            console.warn('⚠️ Error releasing Wake Lock:', err);
        }
    }
}

// Function to start continuous location tracking dengan watchPosition (MORE RELIABLE)
function startLocationTracking() {
    // Clear any existing interval atau watch
    if (locationInterval) {
        clearInterval(locationInterval);
        locationInterval = null;
    }
    
    // Stop existing watchPosition if any
    if (watchPositionId !== null) {
        navigator.geolocation.clearWatch(watchPositionId);
        watchPositionId = null;
    }
    
    console.log('📍 Starting continuous GPS tracking...');
    
    // Request Wake Lock jika sedang navigasi
    if (isNavigating) {
        requestWakeLock();
    }
    
    // IMPROVED: Use watchPosition untuk continuous tracking (lebih reliable dari interval)
    // watchPosition akan terus memberikan update GPS tanpa perlu request berulang
    // CRITICAL: During navigation, use faster updates and always fresh GPS
    const watchOptions = {
        enableHighAccuracy: true, // SELALU gunakan GPS high accuracy
        timeout: isNavigating ? 30000 : 60000, // Faster timeout during navigation (30s vs 60s)
        maximumAge: 0 // JANGAN gunakan cached - SELALU fresh GPS (critical for accuracy)
    };
    
    // Start watchPosition untuk tracking kontinyu
    watchPositionId = navigator.geolocation.watchPosition(
        function(position) {
            // GPS location updated - reset retry counter
            gpsRetryCount = 0;
            
            // Trigger Leaflet locationfound event
            map.fire('locationfound', {
                latlng: L.latLng(position.coords.latitude, position.coords.longitude),
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed
            });
            
            // Log GPS status
            if (isNavigating) {
                console.log('📍 GPS Update (navigating):', position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6), 
                    'Accuracy:', Math.round(position.coords.accuracy), 'm');
            }
        },
        function(error) {
            // GPS error - retry mechanism
            console.error('❌ GPS Error:', error.code, error.message);
            gpsRetryCount++;
            
            // Retry dengan exponential backoff (max 5 retries)
            if (gpsRetryCount <= 5 && isNavigating) {
                const retryDelay = Math.min(1000 * Math.pow(2, gpsRetryCount - 1), 10000); // Max 10 seconds
                console.log(`🔄 Retrying GPS in ${retryDelay}ms (attempt ${gpsRetryCount}/5)...`);
                
                setTimeout(function() {
                    if (isNavigating && watchPositionId === null) {
                        startLocationTracking(); // Restart tracking
                    }
                }, retryDelay);
            } else if (gpsRetryCount > 5) {
                console.error('❌ GPS failed after 5 retries - stopping watch');
                const statusEl = document.getElementById('status');
                if (statusEl) {
                    statusEl.textContent = '⚠️ GPS error: ' + error.message + ' - Coba restart GPS di HP';
                }
            }
            
            // Trigger Leaflet locationerror event
            map.fire('locationerror', {
                code: error.code,
                message: error.message
            });
        },
        watchOptions
    );
    
    console.log('✅ Continuous GPS tracking started (watchPosition ID:', watchPositionId, ')');
}

// Function to stop location tracking
function stopLocationTracking() {
    // Clear interval
    if (locationInterval) {
        clearInterval(locationInterval);
        locationInterval = null;
    }
    
    // Stop watchPosition
    if (watchPositionId !== null) {
        navigator.geolocation.clearWatch(watchPositionId);
        watchPositionId = null;
        console.log('🛑 GPS tracking stopped');
    }
    
    // Release Wake Lock
    releaseWakeLock();
}

// Function to locate user using Leaflet (fallback method, tidak digunakan saat watchPosition aktif)
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
            // Call function from window scope (defined at top of file)
            if (window.requestLocationPermission) {
                window.requestLocationPermission();
            } else {
                console.error('requestLocationPermission is not defined - index.js may not be loaded yet');
            }
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
        console.error('❌ Speech recognition not supported in this browser');
        console.log('💡 Use Chrome or Edge for best compatibility');
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) voiceBtn.style.display = 'none';
        updateVoiceStatus('❌ Speech recognition tidak tersedia di browser ini. Gunakan Chrome atau Edge.');
        return false;
    }
    
    // Create speech recognition object
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
        recognition = new SpeechRecognition();
        console.log('✅ Speech recognition object created');
    } catch (error) {
        console.error('❌ Failed to create speech recognition object:', error);
        updateVoiceStatus('❌ Gagal membuat speech recognition: ' + error.message);
        return false;
    }
    
    // Configure speech recognition
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'id-ID'; // Using Indonesian language
    
    // Handle speech recognition results
    recognition.onresult = function(event) {
        const now = Date.now();
        // CRITICAL: Check if navigator is speaking OR if we're in suppression period
        // Also check if speechSynthesis is actually speaking (double check)
        const speechSynthesisActive = (typeof window.speechSynthesis !== 'undefined') && 
                                      (window.speechSynthesis.speaking || window.speechSynthesis.pending);
        
        if (isNavigatorSpeaking || now < suppressRecognitionUntil || speechSynthesisActive) {
            // Ignore any recognition results produced while navigator speech is playing or shortly after
            if (now - lastNavigatorIgnoreLog > 500) {
                console.log('🎧 Ignoring speech recognition result during navigator speech', {
                    isNavigatorSpeaking,
                    speechSynthesisActive,
                    suppressingForMs: Math.max(0, suppressRecognitionUntil - now),
                    timeRemaining: Math.max(0, suppressRecognitionUntil - now) + 'ms'
                });
                lastNavigatorIgnoreLog = now;
            }
            finalTranscript = '';
            return;
        }
        let interimTranscript = '';
        
        // FIXED: Process all results and all alternatives for better "Rute X" detection
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            // FIXED: Check all alternatives (not just the first one) for better accuracy
            let transcript = result[0].transcript; // Default to first alternative
            
            // Check all alternatives for "rute" commands
            for (let altIndex = 0; altIndex < result.length; altIndex++) {
                const altTranscript = result[altIndex].transcript;
                const altClean = altTranscript.toLowerCase().trim().replace(/[.,;:!?]/g, '');
                
                // FIXED: Check if this alternative contains "rute" with number
                const routeMatch = altClean.match(/^rute\s*(satu|dua|tiga|empat|lima|enam|\d+)$/i) ||
                                  altClean.match(/^rute(\d+)$/i) ||
                                  altClean.match(/^rute\s*(\d+)$/i);
                if (routeMatch) {
                    transcript = altTranscript; // Use this alternative instead
                    console.log('✅ Found "Rute X" in alternative', altIndex, ':', altTranscript);
                    break;
                }
            }
            
            if (result.isFinal) {
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
                
                // FIXED: Check interim results for "Rute X" commands to handle them immediately
                // This helps when speech recognition cuts off early on mobile
                const routeInterimMatch = interimClean.match(/^rute\s*(satu|dua|tiga|empat|lima|enam|\d+)$/i) ||
                                         interimClean.match(/^rute(\d+)$/i) ||
                                         interimClean.match(/^rute\s*(\d+)$/i);
                if (routeInterimMatch) {
                    const routeWord = routeInterimMatch[1] ? routeInterimMatch[1].toLowerCase() : null;
                    const routeNumberMap = {
                        'satu': 1, '1': 1, 'dua': 2, '2': 2, 'tiga': 3, '3': 3,
                        'empat': 4, '4': 4, 'lima': 5, '5': 5, 'enam': 6, '6': 6
                    };
                    const routeId = routeWord ? (routeNumberMap[routeWord] || parseInt(routeWord)) : parseInt(routeInterimMatch[1] || routeInterimMatch[2]);
                    if (routeId && routeId >= 1 && routeId <= 6) {
                        console.log('✅ Route command detected in interim results: Rute', routeId);
                        // Process immediately from interim result
                        handleVoiceCommand(interimClean);
                        return;
                    }
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
            // This is NOT an error - it's normal when user is not speaking
            // Only log occasionally to avoid console spam (1% of the time)
            if (Math.random() < 0.01) {
                console.log('ℹ️ No speech detected (normal - microphone is listening, waiting for voice input)');
            }
            // Don't update status for no-speech, just silently continue
            // Microphone will auto-restart and continue listening
            return;
        } else if (event.error === 'aborted') {
            // Speech recognition was stopped intentionally
            console.log('ℹ️ Speech recognition stopped');
            return;
        } else if (event.error === 'audio-capture') {
            // No microphone found or microphone not accessible
            updateVoiceStatus('❌ Mikrofon tidak ditemukan atau tidak dapat diakses');
            console.error('❌ Microphone not found or not accessible');
        } else if (event.error === 'network') {
            // Network error
            updateVoiceStatus('❌ Error jaringan - coba lagi');
            console.error('❌ Network error');
        } else {
            // Other errors
            updateVoiceStatus('❌ Error: ' + event.error);
            console.error('❌ Speech recognition error:', event.error);
        }
        
        isListening = false;
        updateVoiceButton();
    };
    
    // Handle speech recognition end
    recognition.onend = function() {
        // Log reason for ending
        const reason = recognition._stopped ? 'stopped manually' : 'ended automatically (will auto-restart)';
        console.log('🔇 Speech recognition ended -', reason);
        isListening = false;
        updateVoiceButton();
        
        // CRITICAL: Jangan auto-restart mikrofon jika:
        // 1. Navigation aktif (isNavigating = true)
        // 2. Recognition dihentikan secara manual (_stopped = true)
        // 3. Navigation flag di-set (_navigationActive = true)
        // 4. User belum berinteraksi (hasUserInteraction = false)
        const shouldNotRestart = isNavigating || 
                                  (recognition && recognition._stopped) || 
                                  (recognition && recognition._navigationActive) ||
                                  !hasUserInteraction;
        
        if (shouldNotRestart) {
            if (isNavigating || (recognition && recognition._navigationActive)) {
                console.log('🔒 Navigation active - microphone will NOT auto-restart (say "Halo" to reactivate)');
            } else if (recognition && recognition._stopped) {
                console.log('🔒 Microphone manually stopped - will NOT auto-restart');
            } else {
                console.log('ℹ️ No user interaction - microphone will NOT auto-restart');
            }
            return; // Jangan restart
        }
        
        // Auto-restart microphone if it was listening (for continuous operation)
        // But only if all conditions are met:
        // 1. It wasn't stopped intentionally (not _stopped)
        // 2. Navigation is not active (to prevent restart during navigation)
        // 3. Navigation flag is not set (_navigationActive = false)
        // 4. User has already interacted (required for browser security)
        if (recognition && !isListening && !recognition._stopped && hasUserInteraction && !isNavigating) {
            // Small delay before restart to prevent rapid restart loops
            setTimeout(function() {
                // Double check all conditions before restarting
                if (recognition && 
                    !isListening && 
                    !recognition._stopped && 
                    !recognition._navigationActive &&
                    hasUserInteraction && 
                    !isNavigating) {
                    try {
                        recognition.start();
                        isListening = true;
                        console.log('🔄 Microphone auto-restarted');
                    } catch (error) {
                        // If restart fails (e.g., not-allowed), stop trying
                        console.log('⚠️ Could not restart microphone:', error.message);
                        recognition._stopped = true;
                    }
                } else {
                    if (isNavigating || (recognition && recognition._navigationActive)) {
                        console.log('🔒 Navigation active - microphone auto-restart blocked');
                    } else if (recognition && recognition._stopped) {
                        console.log('🔒 Microphone stopped - auto-restart blocked');
                    }
                }
            }, 1000);
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
    'manahan': { lat: -7.5490, lng: 110.8100, name: 'Manahan, Surakarta' },
    'manahan solo': { lat: -7.5490, lng: 110.8100, name: 'Manahan, Surakarta' },
    'manahan surakarta': { lat: -7.5490, lng: 110.8100, name: 'Manahan, Surakarta' },
    
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

// Helper function untuk fetch Nominatim API dengan CORS proxy
// Mengatasi masalah CORS ketika fetch dari localhost
async function fetchNominatim(url, options = {}) {
    // Try multiple CORS proxy services for better reliability
    const proxyServices = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
    
    // Helper function untuk fetch dengan timeout
    const fetchWithTimeout = async (url, timeout = 10000) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'SenaVision Navigation App'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    };
    
    // Try each proxy service
    for (let i = 0; i < proxyServices.length; i++) {
        try {
            console.log(`🔄 Fetching Nominatim API via CORS proxy ${i + 1}/${proxyServices.length}`);
            const response = await fetchWithTimeout(proxyServices[i], 10000);
            
            if (response.ok) {
                console.log(`✅ CORS proxy ${i + 1} succeeded`);
        return response;
            } else {
                console.warn(`⚠️ Proxy ${i + 1} returned status ${response.status}, trying next...`);
            }
    } catch (error) {
            console.warn(`⚠️ CORS proxy ${i + 1} failed:`, error.message);
            // Continue to next proxy
        }
    }
    
    // If all proxies failed, try direct fetch (may work with some browser extensions)
    console.log('⚠️ All proxies failed, trying direct fetch as last resort...');
    try {
        const directResponse = await fetchWithTimeout(url, 10000);
            
            if (directResponse.ok) {
                console.log('✅ Direct fetch succeeded');
                return directResponse;
            } else {
                throw new Error(`Direct fetch failed: ${directResponse.status}`);
            }
        } catch (directError) {
        console.error('❌ All proxy services and direct fetch failed');
        throw new Error(`Failed to fetch Nominatim API: All methods failed. Last error: ${directError.message}`);
    }
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
        
        const response = await fetchNominatim(geocodeUrl);
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
        
        fetchNominatim(geocodeUrl)
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
        
        fetchNominatim(geocodeUrl)
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
    console.log('🔍 Debug - command length:', cleanCommand.length, '| starts with "rute":', cleanCommand.toLowerCase().startsWith('rute'));
    
    // Show what was recognized
    updateVoiceStatus('🎤 Aku mendengar: "' + transcript + '"');
    
    // FIXED: Debug logging for route commands - check if command contains "rute"
    if (cleanCommand.toLowerCase().includes('rute')) {
        console.log('🔍 Route command detected in transcript, checking patterns...');
        console.log('🔍 Clean command:', cleanCommand);
        console.log('🔍 Command matches "rute":', /rute/i.test(cleanCommand));
    }
    
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
        
        // CRITICAL: Clear navigation flag untuk mengaktifkan kembali mikrofon
        if (recognition && recognition._navigationActive) {
            recognition._navigationActive = false;
            console.log('🔓 Navigation flag cleared - microphone can be reactivated');
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
    
    // FIXED: Try multiple patterns to match "rute [number or word]" - support various formats from mobile speech recognition
    // Priority order: most specific first, then more flexible patterns
    
    // Pattern 1: "rute1", "rute2", etc. (without space - VERY COMMON in mobile speech recognition)
    // This pattern is checked first because mobile often outputs "rute1" as one word
    const routeMatchNoSpace = cleanCommand.match(/^rute(\d+)$/i);
    if (routeMatchNoSpace) {
        const routeId = parseInt(routeMatchNoSpace[1]);
        console.log('✅ Route command detected (no space): Rute', routeId, '(matched:', routeMatchNoSpace[0], ')');
        if (routeId >= 1 && routeId <= 6) {
            handleRouteCommand(routeId);
            return;
        } else {
            speakText('Rute hanya tersedia dari Rute Satu sampai Rute Enam', 'id-ID', true);
            updateVoiceStatus('❌ Rute hanya 1-6');
            return;
        }
    }
    
    // Pattern 2: "rute [number]" with optional space (most flexible for "rute 1", "rute 2", etc.)
    const routeMatchFlexible = cleanCommand.match(/^rute\s*(\d+)$/i);
    if (routeMatchFlexible) {
        const routeId = parseInt(routeMatchFlexible[1]);
        console.log('✅ Route command detected (flexible): Rute', routeId, '(matched:', routeMatchFlexible[0], ')');
        if (routeId >= 1 && routeId <= 6) {
            handleRouteCommand(routeId);
            return;
        } else {
            speakText('Rute hanya tersedia dari Rute Satu sampai Rute Enam', 'id-ID', true);
            updateVoiceStatus('❌ Rute hanya 1-6');
            return;
        }
    }
    
    // Pattern 3: "rute 1", "rute 2", "rute satu", "rute dua", etc. (with space)
    const routeMatchWithSpace = cleanCommand.match(/^rute\s+(satu|dua|tiga|empat|lima|enam|\d+)$/i);
    if (routeMatchWithSpace) {
        const routeWord = routeMatchWithSpace[1].toLowerCase();
        const routeId = routeNumberMap[routeWord] || parseInt(routeWord);
        
        if (routeId && routeId >= 1 && routeId <= 6) {
            console.log('✅ Route command detected (with space): Rute', routeId, '(matched:', routeMatchWithSpace[0], ')');
            handleRouteCommand(routeId);
            return;
        }
    }
    
    // Pattern 4: "rute [word]" with optional space (for "rute satu", "rute dua", etc.)
    const routeMatchWord = cleanCommand.match(/^rute\s*(satu|dua|tiga|empat|lima|enam)$/i);
    if (routeMatchWord) {
        const routeWord = routeMatchWord[1].toLowerCase();
        const routeId = routeNumberMap[routeWord];
        
        if (routeId) {
            console.log('✅ Route command detected (word): Rute', routeId, '(matched:', routeMatchWord[0], ')');
            handleRouteCommand(routeId);
            return;
        }
    }
    
    // Pattern 5: Handle cases where speech recognition might add extra words like "rute nomor 1", "rute angka 1"
    const routeMatchWithNumber = cleanCommand.match(/^rute\s+(nomor|angka|number)?\s*(\d+)$/i);
    if (routeMatchWithNumber) {
        const routeId = parseInt(routeMatchWithNumber[2]);
        console.log('✅ Route command detected (with number word): Rute', routeId, '(matched:', routeMatchWithNumber[0], ')');
        if (routeId >= 1 && routeId <= 6) {
            handleRouteCommand(routeId);
            return;
        }
    }
    
    // FIXED: Pattern 6 - Handle partial matches where only "rute" is detected
    // This can happen when speech recognition cuts off early on mobile
    // Check if command is just "rute" and wait for next input
    if (cleanCommand === 'rute' || cleanCommand.trim() === 'rute') {
        console.log('⚠️ Only "rute" detected - waiting for number...');
        // Don't process yet, wait for next recognition result
        // Speech recognition should continue and capture the number
        return; // Return early, let next recognition result handle it
    }
    
    // FIXED: Pattern 7 - Handle cases where speech recognition outputs "rute" followed by number in separate words
    // Example: "rute" then "1" might be recognized separately
    // Check if previous command was "rute" and current is a number
    if (window.lastCommand === 'rute') {
        const numberMatch = cleanCommand.match(/^(satu|dua|tiga|empat|lima|enam|\d+)$/i);
        if (numberMatch) {
            const routeWord = numberMatch[1].toLowerCase();
            const routeId = routeNumberMap[routeWord] || parseInt(routeWord);
            if (routeId && routeId >= 1 && routeId <= 6) {
                console.log('✅ Route command detected (split recognition): Rute', routeId);
                window.lastCommand = ''; // Clear last command
                handleRouteCommand(routeId);
                return;
            }
        }
    }
    
    // Store current command for next check (if it's "rute")
    if (cleanCommand === 'rute' || cleanCommand.trim() === 'rute') {
        window.lastCommand = 'rute';
    } else {
        window.lastCommand = '';
    }
    
    // FIXED: Check for create route commands - "Buat Rute X dari [start] ke [end]"
    // Pattern: "buat rute 2 dari jakarta ke bandung" or "buat rute dua dari jakarta ke bandung"
    // Support both with and without space: "buat rute1", "buat rute 1", "buat rute2", "buat rute 2", etc.
    const createRouteMatch = cleanCommand.match(/^buat\s+rute\s*(satu|dua|tiga|empat|lima|enam|\d+)\s+dari\s+(.+?)\s+ke\s+(.+)$/i);
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
            
            // Release Wake Lock saat navigasi dibatalkan
            releaseWakeLock();
            
            // Reset marker icon to normal (blue circle)
            if (currentUserPosition) {
                const normalIcon = L.divIcon({
                    className: 'custom-user-marker',
                    html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                currentUserPosition.setIcon(normalIcon);
            }
            
            // Remove 3D/isometric perspective and show sidebar
            document.body.classList.remove('navigating');
            document.documentElement.classList.remove('navigating');
            
            // Restore body/html styles
            document.body.style.margin = '';
            document.body.style.padding = '';
            document.body.style.overflow = '';
            document.documentElement.style.margin = '';
            document.documentElement.style.padding = '';
            document.documentElement.style.overflow = '';
            
            // Show sidebar again
            const navbar = document.getElementById('sideNavbar');
            if (navbar) {
                navbar.classList.remove('collapsed');
                navbar.style.display = '';
            }
            
            // Show toggle button
            const toggleBtn = document.getElementById('navbarToggleBtn');
            if (toggleBtn) {
                toggleBtn.style.display = '';
            }
            
            // Show back button
            const backBtn = document.getElementById('backToHomeBtn');
            if (backBtn) {
                backBtn.style.display = '';
            }
            
            // Restore map styles
            const mapElement = document.getElementById('map');
            if (mapElement) {
                mapElement.style.position = '';
                mapElement.style.top = '';
                mapElement.style.left = '';
                mapElement.style.width = '';
                mapElement.style.height = '';
            }
            
            const leafletContainer = document.querySelector('.leaflet-container');
            if (leafletContainer) {
                leafletContainer.style.width = '';
                leafletContainer.style.height = '';
                leafletContainer.style.position = '';
                leafletContainer.style.top = '';
                leafletContainer.style.left = '';
            }
            
            // Force map resize
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
            
            // Nonaktifkan flag navigasi di SpeechCoordinator
            if (typeof window.SpeechCoordinator !== 'undefined') {
                window.SpeechCoordinator.setNavigating(false);
            }
            
            // Deactivate YOLO Detector saat navigasi dibatalkan
            if (typeof window.YOLODetector !== 'undefined') {
                const yoloState = window.YOLODetector.getState();
                if (yoloState.isActive) {
                    console.log('🔄 Deactivating YOLO Detector - navigation cancelled');
                    window.YOLODetector.deactivate();
                    console.log('✅ YOLO Detector deactivated');
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
        
        // STEP 4: Matikan mikrofon setelah tujuan ditemukan
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        // STEP 5: Update destination dan tunggu route dibuat
        // Set pending announcement data untuk dipanggil setelah route dibuat
        pendingRouteAnnouncementData = {
            shortName: city.name,
            fullName: city.name
        };
        
        updateDestination(city.lat, city.lng, city.name);
        updateVoiceStatus('🔍 Membuat rute ke ' + city.name + '...');
        
        // Announcement akan dipanggil di event handler 'routesfound' setelah route dibuat
        console.log('⏳ Waiting for route to be created - announcement will be triggered automatically');
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

    // FIXED: Ensure user interaction is set for speech synthesis
    hasUserInteraction = true;
    console.log('[Navigation] ✅ User interaction confirmed for speech synthesis');

    // Check if route data exists - wait for route to be created if destination is set
    if (!route) {
        // Check if destination is set - if yes, wait for route to be created
        if (latLngB && currentUserPosition) {
            console.log('[Navigation] ⏳ Route not ready yet, waiting for route creation...');
            updateVoiceStatus('⏳ Menunggu rute dibuat...');
            
            // Wait for route to be created (check every 200ms, max 5 seconds)
            let waitCount = 0;
            const maxWait = 25; // 25 * 200ms = 5 seconds
            
            const waitForRoute = setInterval(function() {
                waitCount++;
                
                if (route && route._routes && route._routes[0]) {
                    clearInterval(waitForRoute);
                    console.log('[Navigation] ✅ Route ready, starting navigation...');
                    // Recursively call startTurnByTurnNavigation now that route is ready
                    startTurnByTurnNavigation();
                } else if (waitCount >= maxWait) {
                    clearInterval(waitForRoute);
                    console.warn('[Navigation] ⚠️ Route creation timeout');
                    suppressMicActivationSpeech = false;
                    speakText('Rute belum siap. Silakan tunggu beberapa saat atau sebutkan tujuan lagi.', 'id-ID', true);
                    updateVoiceStatus('⚠️ Rute belum siap');
                }
            }, 200);
            
            return;
        } else {
            suppressMicActivationSpeech = false;
            speakText('Rute belum ditetapkan. Silakan sebutkan tujuan terlebih dahulu.', 'id-ID', true);
            updateVoiceStatus('⚠️ Setel tujuan terlebih dahulu');
            return;
        }
    }
    
    // Additional check: ensure route has route data
    if (!route._routes || !route._routes[0]) {
        console.log('[Navigation] ⏳ Route object exists but route data not ready, waiting...');
        updateVoiceStatus('⏳ Menunggu data rute...');
        
        // Wait for route data (check every 200ms, max 5 seconds)
        let waitCount = 0;
        const maxWait = 25; // 25 * 200ms = 5 seconds
        
        const waitForRouteData = setInterval(function() {
            waitCount++;
            
            if (route && route._routes && route._routes[0]) {
                clearInterval(waitForRouteData);
                console.log('[Navigation] ✅ Route data ready, starting navigation...');
                // Recursively call startTurnByTurnNavigation now that route data is ready
                startTurnByTurnNavigation();
            } else if (waitCount >= maxWait) {
                clearInterval(waitForRouteData);
                console.warn('[Navigation] ⚠️ Route data timeout');
                suppressMicActivationSpeech = false;
                speakText('Data rute belum siap. Silakan tunggu beberapa saat atau sebutkan tujuan lagi.', 'id-ID', true);
                updateVoiceStatus('⚠️ Data rute belum siap');
            }
        }, 200);
        
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
        try {
            recognition.stop();
            isListening = false;
            console.log('🔇 Microphone stopped - navigation started, say "Halo" or click to reactivate');
        } catch (error) {
            console.warn('⚠️ Error stopping microphone:', error);
            isListening = false;
        }
    }
    
    // CRITICAL: Pastikan mikrofon tidak auto-restart saat navigasi aktif
    // Set flag untuk mencegah auto-restart di recognition.onend
    if (recognition) {
        recognition._navigationActive = true; // Flag khusus untuk mencegah auto-restart saat navigasi
        console.log('🔒 Microphone locked - will not auto-restart during navigation');
    }
    
    // Aktifkan flag navigasi di SpeechCoordinator - memungkinkan kedua suara berbicara bergantian
    if (typeof window.SpeechCoordinator !== 'undefined') {
        window.SpeechCoordinator.setNavigating(true);
    }
    
    // CRITICAL: Set flag navigasi aktif
    isNavigating = true;
    
    // CRITICAL: Ensure currentRouteData is set from route object if not already set
    if (!currentRouteData && route) {
        // Try multiple ways to get route data
        let routeData = null;
        if (route._routes && route._routes[0]) {
            routeData = route._routes[0];
        } else if (route._route && route._route.routes && route._route.routes[0]) {
            routeData = route._route.routes[0];
        }
        
        if (routeData) {
            currentRouteData = routeData;
            console.log('[Navigation] ✅ currentRouteData set from route object in startTurnByTurnNavigation:', {
                hasRoute: !!currentRouteData,
                hasInstructions: !!(currentRouteData && currentRouteData.instructions),
                instructionCount: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
            });
        } else {
            console.warn('[Navigation] ⚠️ currentRouteData is null and cannot be set from route object - route structure:', {
                hasRoute: !!route,
                hasRoutes: !!(route && route._routes),
                routesLength: route && route._routes ? route._routes.length : 0
            });
        }
    } else if (currentRouteData) {
        console.log('[Navigation] ✅ currentRouteData already set:', {
            hasRoute: !!currentRouteData,
            hasInstructions: !!(currentRouteData && currentRouteData.instructions),
            instructionCount: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
        });
    }
    
    // CRITICAL: Request Wake Lock untuk menjaga device tetap aktif (GPS tidak mati)
    requestWakeLock();
    
    // CRITICAL: Restart GPS tracking dengan watchPosition untuk tracking kontinyu
    console.log('🔄 Restarting GPS tracking for navigation...');
    startLocationTracking();
    
    // Aktifkan YOLO Detector di background saat navigasi dimulai
    // YOLO detector akan berjalan bersamaan dengan navigasi GPS untuk deteksi objek
    if (typeof window.YOLODetector !== 'undefined') {
        console.log('🔄 Activating YOLO Detector in background for navigation...');
        const yoloState = window.YOLODetector.getState();
        
        if (!yoloState.isActive) {
            // Initialize dan activate YOLO detector jika belum aktif
            window.YOLODetector.init().then(function(initSuccess) {
                if (initSuccess) {
                    window.YOLODetector.activate().then(async function(activateSuccess) {
                        if (activateSuccess) {
                            console.log('✅ YOLO Detector activated in background - running alongside navigation');
                            
                            // Check detailed status after activation
                            setTimeout(async () => {
                                try {
                                    const detailedStatus = await window.YOLODetector.getDetailedStatus();
                                    console.log('📊 YOLO Detector Detailed Status:', detailedStatus);
                                    console.log('🔗 ESP32-CAM Connection:', detailedStatus.connection.connected ? '✅ CONNECTED' : '❌ NOT CONNECTED');
                                    if (detailedStatus.connection.connected) {
                                        console.log('   Method:', detailedStatus.connection.method);
                                        console.log('   URL:', detailedStatus.connection.url);
                                    } else {
                                        console.log('   Error:', detailedStatus.connection.error);
                                    }
                                } catch (statusError) {
                                    console.warn('⚠️ Failed to get detailed status:', statusError);
                                }
                            }, 3000);
                        } else {
                            console.warn('⚠️ Failed to activate YOLO Detector - navigation will continue without object detection');
                            
                            // Check connection status even if activation failed
                            setTimeout(async () => {
                                try {
                                    const connectionStatus = await window.YOLODetector.checkESP32Connection();
                                    console.log('🔍 ESP32-CAM Connection Check:', connectionStatus);
                                } catch (checkError) {
                                    console.error('❌ Connection check failed:', checkError);
                                }
                            }, 2000);
                        }
                    }).catch(function(error) {
                        console.error('❌ Error activating YOLO Detector:', error);
                        // Navigation tetap berjalan meskipun YOLO detector gagal
                    });
                } else {
                    console.warn('⚠️ Failed to initialize YOLO Detector - navigation will continue without object detection');
                }
            }).catch(function(error) {
                console.error('❌ Error initializing YOLO Detector:', error);
                // Navigation tetap berjalan meskipun YOLO detector gagal
            });
        } else {
            console.log('✅ YOLO Detector already active - will continue running during navigation');
            
            // Check status of already active detector
            setTimeout(async () => {
                try {
                    const detailedStatus = await window.YOLODetector.getDetailedStatus();
                    console.log('📊 YOLO Detector Status (already active):', detailedStatus);
                } catch (statusError) {
                    console.warn('⚠️ Failed to get status:', statusError);
                }
            }, 1000);
        }
    } else {
        console.log('ℹ️ YOLO Detector not available - navigation will continue without object detection');
    }
    
    // CRITICAL: Fokus peta ke lokasi user saat ini saat navigasi dimulai
    // Ini memastikan user selalu melihat posisi mereka di peta
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        
        // Keep blue circle icon during navigation (no change to green arrow)
        // Marker tetap biru saat navigasi sesuai permintaan user
        const blueIcon = L.divIcon({
            className: 'custom-user-marker',
            html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        currentUserPosition.setIcon(blueIcon);
        
        // Add 3D/isometric perspective class to body and hide sidebar FIRST
        document.body.classList.add('navigating');
        document.documentElement.classList.add('navigating');
        
        // FIXED: Hide browser UI elements immediately for mobile
        // Hide address bar and navigation bar by forcing viewport to fullscreen
        const hideBrowserUI = () => {
            // Force scroll to top to hide address bar (works on mobile browsers)
            window.scrollTo(0, 0);
            
            // Set viewport height to actual screen height (hides address bar)
            const setViewportHeight = () => {
                const vh = window.innerHeight * 0.01;
                document.documentElement.style.setProperty('--vh', `${vh}px`);
            };
            setViewportHeight();
            window.addEventListener('resize', setViewportHeight);
            window.addEventListener('orientationchange', setViewportHeight);
        };
        hideBrowserUI();
        
        // Request browser fullscreen API for true fullscreen
        // Try multiple methods for maximum compatibility
        const requestFullscreen = document.documentElement.requestFullscreen || 
                                  document.documentElement.webkitRequestFullscreen || 
                                  document.documentElement.webkitEnterFullscreen ||
                                  document.documentElement.mozRequestFullScreen || 
                                  document.documentElement.msRequestFullscreen;
        
        if (requestFullscreen) {
            requestFullscreen.call(document.documentElement).catch(err => {
                console.log('Fullscreen request failed:', err);
                // Continue anyway - CSS will handle fullscreen
            });
        }
        
        // FIXED: For mobile browsers - hide address bar by scrolling and forcing viewport
        // This works better on Android Chrome and mobile browsers
        const hideAddressBar = () => {
            // Scroll to hide address bar
            window.scrollTo(0, 1);
            setTimeout(() => {
                window.scrollTo(0, 0);
                // Re-apply fullscreen styles after scroll
                applyBodyFullscreen();
                applyFullscreenStyles();
            }, 50);
        };
        
        // Hide address bar multiple times to ensure it stays hidden
        hideAddressBar();
        setTimeout(hideAddressBar, 100);
        setTimeout(hideAddressBar, 300);
        
        // Re-apply on resize and orientation change
        const handleViewportChange = () => {
            applyBodyFullscreen();
            applyFullscreenStyles();
        };
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', () => {
            setTimeout(handleViewportChange, 200);
        });
        
        // FIXED: FORCE fullscreen styles immediately - BEFORE zoom
        // Use actual window dimensions for mobile (hides address bar)
        // CRITICAL: Get actual screen dimensions after potential address bar hide
        const getActualDimensions = () => {
            // Force a small scroll to hide address bar on mobile
            window.scrollTo(0, 1);
            setTimeout(() => {
                window.scrollTo(0, 0);
            }, 10);
            
            // Get actual dimensions after scroll
            const vh = window.innerHeight || document.documentElement.clientHeight || screen.height;
            const vw = window.innerWidth || document.documentElement.clientWidth || screen.width;
            
            return { vh, vw };
        };
        
        // Get dimensions multiple times to ensure we get the correct size after address bar hides
        let { vh, vw } = getActualDimensions();
        
        // Wait a bit and get dimensions again (address bar might hide with delay)
        setTimeout(() => {
            const dims = getActualDimensions();
            if (dims.vh > vh) {
                vh = dims.vh;
                vw = dims.vw;
            }
        }, 300);
        
        // CRITICAL: Set viewport meta tag dynamically for mobile
        let viewportMeta = document.querySelector('meta[name="viewport"]');
        if (!viewportMeta) {
            viewportMeta = document.createElement('meta');
            viewportMeta.name = 'viewport';
            document.head.appendChild(viewportMeta);
        }
        viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        
        // Function to apply fullscreen styles to HTML and body
        const applyBodyFullscreen = () => {
            const dims = getActualDimensions();
            const height = dims.vh + 'px';
            const width = dims.vw + 'px';
            
            // Force HTML and body to exact screen dimensions
            document.documentElement.style.width = width;
            document.documentElement.style.height = height;
            document.documentElement.style.margin = '0';
            document.documentElement.style.padding = '0';
            document.documentElement.style.overflow = 'hidden';
            document.documentElement.style.position = 'fixed';
            document.documentElement.style.top = '0';
            document.documentElement.style.left = '0';
            document.documentElement.style.right = '0';
            document.documentElement.style.bottom = '0';
            document.documentElement.style.inset = '0';
            document.documentElement.style.maxWidth = width;
            document.documentElement.style.maxHeight = height;
            document.documentElement.style.minWidth = width;
            document.documentElement.style.minHeight = height;
            document.documentElement.style.boxSizing = 'border-box';
            
            document.body.style.width = width;
            document.body.style.height = height;
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = '0';
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.bottom = '0';
            document.body.style.inset = '0';
            document.body.style.maxWidth = width;
            document.body.style.maxHeight = height;
            document.body.style.minWidth = width;
            document.body.style.minHeight = height;
            document.body.style.boxSizing = 'border-box';
        };
        
        // Apply immediately and after delays
        applyBodyFullscreen();
        setTimeout(applyBodyFullscreen, 100);
        setTimeout(applyBodyFullscreen, 300);
        setTimeout(applyBodyFullscreen, 500);
        
        // Hide sidebar for fullscreen navigation, but keep debug tab accessible
        const navbar = document.getElementById('sideNavbar');
        if (navbar) {
            // Hide sidebar but allow debug tab to be shown if needed
            navbar.style.display = 'none';
            navbar.style.visibility = 'hidden';
            navbar.classList.remove('active');
            navbar.classList.add('collapsed');
        }
        
        // Hide toggle button
        const toggleBtn = document.getElementById('navbarToggleBtn');
        if (toggleBtn) {
            toggleBtn.style.display = 'none';
            toggleBtn.style.visibility = 'hidden';
        }
        
        // Hide back button
        const backBtn = document.getElementById('backToHomeBtn');
        if (backBtn) {
            backBtn.style.display = 'none';
            backBtn.style.visibility = 'hidden';
        }
        
        // CRITICAL: Create floating debug button that stays visible during navigation
        let floatingDebugBtn = document.getElementById('floatingDebugBtn');
        if (!floatingDebugBtn) {
            floatingDebugBtn = document.createElement('button');
            floatingDebugBtn.id = 'floatingDebugBtn';
            floatingDebugBtn.className = 'floating-debug-btn';
            floatingDebugBtn.innerHTML = '🐛 Debug';
            floatingDebugBtn.title = 'Buka Debug Console';
            floatingDebugBtn.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                background: rgba(59, 73, 223, 0.95);
                color: white;
                border: none;
                border-radius: 50%;
                width: 56px;
                height: 56px;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            `;
            floatingDebugBtn.onmouseover = function() {
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
            };
            floatingDebugBtn.onmouseout = function() {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
            };
            floatingDebugBtn.onclick = function() {
                // Show sidebar and switch to debug tab
                const navbar = document.getElementById('sideNavbar');
                if (navbar) {
                    navbar.style.display = 'block';
                    navbar.style.visibility = 'visible';
                    navbar.classList.add('active');
                    navbar.classList.remove('collapsed');
                    switchNavbarTab('debug');
                }
            };
            document.body.appendChild(floatingDebugBtn);
            console.log('✅ Floating debug button created for navigation mode');
        } else {
            // Make sure it's visible
            floatingDebugBtn.style.display = 'flex';
            floatingDebugBtn.style.visibility = 'visible';
            floatingDebugBtn.style.opacity = '1';
        }
        
        // FIXED: FORCE map to fullscreen immediately with actual pixel values
        // Use function to apply styles with latest dimensions
        const applyFullscreenStyles = () => {
            const dims = getActualDimensions();
            const height = dims.vh + 'px';
            const width = dims.vw + 'px';
            
            let mapElement = document.getElementById('map');
            
            if (mapElement) {
                mapElement.style.position = 'fixed';
                mapElement.style.top = '0';
                mapElement.style.left = '0';
                mapElement.style.right = '0';
                mapElement.style.bottom = '0';
                mapElement.style.width = width;
                mapElement.style.height = height;
                mapElement.style.margin = '0';
                mapElement.style.padding = '0';
                mapElement.style.zIndex = '9999';
                mapElement.style.overflow = 'hidden';
                mapElement.style.inset = '0';
                mapElement.style.minWidth = width;
                mapElement.style.minHeight = height;
                mapElement.style.maxWidth = width;
                mapElement.style.maxHeight = height;
                mapElement.style.boxSizing = 'border-box';
            }
            
            // FIXED: FORCE leaflet container to fullscreen with actual pixel values
            const leafletContainer = document.querySelector('.leaflet-container');
            if (leafletContainer) {
                leafletContainer.style.position = 'fixed';
                leafletContainer.style.top = '0';
                leafletContainer.style.left = '0';
                leafletContainer.style.right = '0';
                leafletContainer.style.bottom = '0';
                leafletContainer.style.width = width;
                leafletContainer.style.height = height;
                leafletContainer.style.margin = '0';
                leafletContainer.style.padding = '0';
                leafletContainer.style.overflow = 'visible';
                leafletContainer.style.inset = '0';
                leafletContainer.style.minWidth = width;
                leafletContainer.style.minHeight = height;
                leafletContainer.style.maxWidth = width;
                leafletContainer.style.maxHeight = height;
                leafletContainer.style.zIndex = '9999';
                leafletContainer.style.boxSizing = 'border-box';
                // CRITICAL: Remove any 3D transforms
                leafletContainer.style.transform = 'none';
                leafletContainer.style.transformStyle = 'flat';
                leafletContainer.style.perspective = 'none';
            }
            
            // Apply to all leaflet panes
            const leafletPanes = document.querySelectorAll('.leaflet-pane, .leaflet-map-pane');
            leafletPanes.forEach(function(pane) {
                pane.style.width = width;
                pane.style.height = height;
                pane.style.transform = 'none';
                pane.style.transformStyle = 'flat';
                pane.style.perspective = 'none';
            });
            
            // Force map to recalculate size
            if (map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        };
        
        // Apply immediately
        applyFullscreenStyles();
        
        // Re-apply after delays to catch address bar hiding
        setTimeout(applyFullscreenStyles, 100);
        setTimeout(applyFullscreenStyles, 300);
        setTimeout(applyFullscreenStyles, 500);
        
        // Re-apply on resize and orientation change
        const handleFullscreenResize = () => {
            applyFullscreenStyles();
        };
        window.addEventListener('resize', handleFullscreenResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(handleFullscreenResize, 200);
        });
        
        // Force remove 3D transforms from all leaflet panes
        const leafletPanes = document.querySelectorAll('.leaflet-pane, .leaflet-map-pane, .leaflet-tile-pane, .leaflet-overlay-pane, .leaflet-shadow-pane, .leaflet-marker-pane, .leaflet-tooltip-pane, .leaflet-popup-pane, .leaflet-tile-container');
        leafletPanes.forEach(function(pane) {
            pane.style.transform = 'none';
            pane.style.transformStyle = 'flat';
            pane.style.perspective = 'none';
        });
        
        // CRITICAL: NO AUTO-ZOOM - keep current zoom level when navigation starts
        // User can manually zoom and pan the map - no forced changes
        // map.setView(userLatLng, 19, { animate: true, duration: 0.5 }); // DISABLED
        
        // CRITICAL: Ensure map remains interactive - user can drag, zoom, and pan manually
        // Map controls remain enabled during navigation
        if (map.dragging) {
            map.dragging.enable(); // Ensure dragging is enabled
        }
        if (map.touchZoom) {
            map.touchZoom.enable(); // Ensure touch zoom is enabled
        }
        if (map.doubleClickZoom) {
            map.doubleClickZoom.enable(); // Ensure double-click zoom is enabled
        }
        if (map.scrollWheelZoom) {
            map.scrollWheelZoom.enable(); // Ensure scroll wheel zoom is enabled
        }
        if (map.boxZoom) {
            map.boxZoom.enable(); // Ensure box zoom is enabled
        }
        if (map.keyboard) {
            map.keyboard.enable(); // Ensure keyboard controls are enabled
        }
        
        console.log('✅ Map controls enabled - user can manually zoom, pan, and interact with map');
        
        // Listen for fullscreen changes
        const fullscreenChange = () => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement && 
                !document.mozFullScreenElement && !document.msFullscreenElement) {
                // User exited fullscreen, ensure styles are still applied
                const useDvh = CSS.supports('height', '100dvh');
                const useDvw = CSS.supports('width', '100dvw');
                
                document.documentElement.style.width = useDvw ? '100dvw' : '100vw';
                document.documentElement.style.height = useDvh ? '100dvh' : '100vh';
                document.body.style.width = useDvw ? '100dvw' : '100vw';
                document.body.style.height = useDvh ? '100dvh' : '100vh';
                map.invalidateSize();
            }
        };
        
        document.addEventListener('fullscreenchange', fullscreenChange);
        document.addEventListener('webkitfullscreenchange', fullscreenChange);
        document.addEventListener('mozfullscreenchange', fullscreenChange);
        document.addEventListener('MSFullscreenChange', fullscreenChange);
        
        // FIXED: Ensure hasUserInteraction is true for mobile Speech Synthesis
        // This is critical for Speech Synthesis to work on mobile devices
        if (!hasUserInteraction) {
            console.log('[Navigation] 🔧 Setting hasUserInteraction to true for mobile Speech Synthesis');
            hasUserInteraction = true;
        }
        
        // FIXED: Wake up Speech Synthesis on mobile by calling getVoices()
        // This is required for some mobile browsers to activate Speech Synthesis
        if (typeof window.speechSynthesis !== 'undefined') {
            try {
                // Call getVoices() to wake up Speech Synthesis (required for mobile)
                const voices = window.speechSynthesis.getVoices();
                console.log('[Navigation] 🔊 Speech Synthesis activated at navigation start,', voices.length, 'voices available');
                
                // If voices are not loaded yet, wait for voiceschanged event
                if (voices.length === 0) {
                    console.log('[Navigation] ⏳ Voices not loaded yet, waiting for voiceschanged event...');
                    window.speechSynthesis.onvoiceschanged = function() {
                        const loadedVoices = window.speechSynthesis.getVoices();
                        console.log('[Navigation] ✅ Voices loaded:', loadedVoices.length, 'voices available');
                    };
                }
            } catch (e) {
                console.warn('[Navigation] ⚠️ Error activating Speech Synthesis:', e);
            }
        }
        
        // CRITICAL: Start interval to call announceNextDirection() regularly
        // This ensures announcements are made even if GPS updates are delayed
        // Clear any existing interval first
        if (announceInterval) {
            clearInterval(announceInterval);
            announceInterval = null;
        }
        
        // FIXED: Call announceNextDirection with balanced frequency for real-time accuracy
        // Set to 500ms - debounce mechanism (800ms) will prevent too frequent announcements
        // This ensures turn announcements are made promptly and accurately follow user movement
        // while preventing excessive function calls and speech interruptions
        // FIXED: Use shorter interval (200ms) for more frequent checks when close to turns
        // This ensures announcements are made as soon as distance <= 50m
        announceInterval = setInterval(function() {
            if (isNavigating && typeof announceNextDirection === 'function') {
                try {
                    // Call announceNextDirection for real-time updates
                    announceNextDirection();
                } catch (e) {
                    console.error('[Navigation] ❌ Error in announceNextDirection interval:', e);
                    console.error('[Navigation] ❌ Error stack:', e.stack);
                }
            } else {
                // Navigation stopped, clear interval
                if (announceInterval) {
                    clearInterval(announceInterval);
                    announceInterval = null;
                    console.log('[Navigation] 🛑 Stopped announceNextDirection interval (navigation stopped)');
                }
            }
        }, 200); // FIXED: Check every 200ms for maximum responsiveness - ensures announcements are made immediately when distance <= 50m
        
        console.log('[Navigation] ✅ Started announceNextDirection interval (every 200ms for real-time accuracy)');
        console.log('[Navigation] 📊 Route data for turn detection:', {
            hasRouteData: currentRouteData !== null,
            hasInstructions: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0,
            hasCoordinates: currentRouteData && currentRouteData.coordinates ? currentRouteData.coordinates.length : 0
        });
        console.log('[Navigation] 📊 Navigation state:', {
            isNavigating: isNavigating,
            hasRoute: !!route,
            hasCurrentRouteData: !!currentRouteData,
            hasCurrentUserPosition: !!currentUserPosition,
            voiceDirectionsEnabled: voiceDirectionsEnabled,
            turnMarkerDataCount: turnMarkerData ? turnMarkerData.length : 0
        });
        
        // FIXED: Handle window resize to maintain fullscreen with actual pixel values
        const handleNavigationResize = () => {
            if (document.body.classList.contains('navigating')) {
                // FIXED: Use actual window dimensions for mobile
                const resizeVh = window.innerHeight;
                const resizeVw = window.innerWidth;
                const resizeHeight = resizeVh + 'px';
                const resizeWidth = resizeVw + 'px';
                
                // Update HTML and body
                document.documentElement.style.width = resizeWidth;
                document.documentElement.style.height = resizeHeight;
                document.body.style.width = resizeWidth;
                document.body.style.height = resizeHeight;
                
                const mapEl = document.getElementById('map');
                const leafletEl = document.querySelector('.leaflet-container');
                
                if (mapEl) {
                    mapEl.style.width = resizeWidth;
                    mapEl.style.height = resizeHeight;
                    mapEl.style.maxWidth = resizeWidth;
                    mapEl.style.maxHeight = resizeHeight;
                    mapEl.style.minWidth = resizeWidth;
                    mapEl.style.minHeight = resizeHeight;
                }
                
                if (leafletEl) {
                    leafletEl.style.width = resizeWidth;
                    leafletEl.style.height = resizeHeight;
                    leafletEl.style.maxWidth = resizeWidth;
                    leafletEl.style.maxHeight = resizeHeight;
                    leafletEl.style.minWidth = resizeWidth;
                    leafletEl.style.minHeight = resizeHeight;
                }
                
                // Force map to recalculate size
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        };
        
        window.addEventListener('resize', handleNavigationResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                handleNavigationResize();
                map.invalidateSize();
            }, 200);
        });
        
        // FIXED: Force map resize and ensure fullscreen - AGGRESSIVE FULLSCREEN
        setTimeout(() => {
            // FIXED: Recalculate actual dimensions (may have changed after address bar hide)
            const newVh = window.innerHeight || document.documentElement.clientHeight;
            const newVw = window.innerWidth || document.documentElement.clientWidth;
            const newActualHeight = newVh + 'px';
            const newActualWidth = newVw + 'px';
            
            // Set HTML and body to fullscreen with actual pixel values
            document.documentElement.style.width = newActualWidth;
            document.documentElement.style.height = newActualHeight;
            document.documentElement.style.margin = '0';
            document.documentElement.style.padding = '0';
            document.documentElement.style.overflow = 'hidden';
            document.documentElement.style.inset = '0';
            document.documentElement.style.maxWidth = newActualWidth;
            document.documentElement.style.maxHeight = newActualHeight;
            document.documentElement.style.minWidth = newActualWidth;
            document.documentElement.style.minHeight = newActualHeight;
            
            document.body.style.width = newActualWidth;
            document.body.style.height = newActualHeight;
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.overflow = 'hidden';
            document.body.style.inset = '0';
            document.body.style.maxWidth = newActualWidth;
            document.body.style.maxHeight = newActualHeight;
            document.body.style.minWidth = newActualWidth;
            document.body.style.minHeight = newActualHeight;
            
            // Double check map is fullscreen (reuse existing mapElement variable)
            if (!mapElement) {
                mapElement = document.getElementById('map');
            }
            if (mapElement) {
                mapElement.style.position = 'fixed';
                mapElement.style.top = '0';
                mapElement.style.left = '0';
                mapElement.style.right = '0';
                mapElement.style.bottom = '0';
                mapElement.style.width = newActualWidth;
                mapElement.style.height = newActualHeight;
                mapElement.style.margin = '0';
                mapElement.style.padding = '0';
                mapElement.style.zIndex = '9999'; // FIXED: Higher z-index
                mapElement.style.overflow = 'hidden';
                mapElement.style.inset = '0';
                mapElement.style.minWidth = newActualWidth;
                mapElement.style.minHeight = newActualHeight;
                mapElement.style.maxWidth = newActualWidth;
                mapElement.style.maxHeight = newActualHeight;
            }
            
            // Also ensure leaflet container and all panes are fullscreen
            const leafletContainer = document.querySelector('.leaflet-container');
            if (leafletContainer) {
                leafletContainer.style.width = newActualWidth;
                leafletContainer.style.height = newActualHeight;
                leafletContainer.style.position = 'fixed';
                leafletContainer.style.top = '0';
                leafletContainer.style.left = '0';
                leafletContainer.style.right = '0';
                leafletContainer.style.bottom = '0';
                leafletContainer.style.margin = '0';
                leafletContainer.style.padding = '0';
                leafletContainer.style.overflow = 'visible';
                leafletContainer.style.inset = '0';
                leafletContainer.style.minWidth = newActualWidth;
                leafletContainer.style.minHeight = newActualHeight;
                leafletContainer.style.maxWidth = newActualWidth;
                leafletContainer.style.maxHeight = newActualHeight;
                leafletContainer.style.zIndex = '9999'; // FIXED: Higher z-index
            }
            
            // Ensure all leaflet panes are fullscreen
            const panes = document.querySelectorAll('.leaflet-pane, .leaflet-map-pane, .leaflet-tile-pane, .leaflet-overlay-pane, .leaflet-shadow-pane, .leaflet-marker-pane, .leaflet-tooltip-pane, .leaflet-popup-pane');
            panes.forEach(pane => {
                pane.style.width = newActualWidth;
                pane.style.height = newActualHeight;
                pane.style.overflow = 'visible';
                pane.style.inset = '0';
            });
            
            // Force map to recalculate size
            map.invalidateSize();
            
            // Double check after a short delay
            setTimeout(() => {
                map.invalidateSize();
            }, 200);
        }, 100);
        
        console.log('📍 Map focused on user location at start of navigation:', userLatLng.lat.toFixed(6), userLatLng.lng.toFixed(6));
    }
    
    // CRITICAL FIX: Langsung announce tanpa test - bypass semua logika kompleks
    console.log('[Navigation] 🎯 Starting navigation announcement directly...');
    console.log('[Navigation] 📊 Route state:', {
        route: !!route,
        lastRouteSummarySpeech: lastRouteSummarySpeech,
        currentDestinationName: currentDestinationName
    });
    
    if (!('speechSynthesis' in window)) {
        console.error('[Navigation] ❌ speechSynthesis NOT available');
        updateVoiceStatus('⚠️ Browser tidak mendukung Text-to-Speech');
        return;
    }
    
    // CRITICAL: Request permission from SpeechCoordinator BEFORE canceling
    if (typeof window.SpeechCoordinator !== 'undefined') {
        const canSpeak = window.SpeechCoordinator.requestSpeak('high');
        if (!canSpeak) {
            console.log('[Navigation] ⏸️ SpeechCoordinator blocked - will retry in 500ms');
            setTimeout(function() {
                startTurnByTurnNavigation();
            }, 500);
            return;
        }
    }
    
    // Cancel apapun yang sedang berbicara
    window.speechSynthesis.cancel();
    
    // Small delay to ensure cancel is complete
    setTimeout(function() {
        // Langsung announce tanpa delay
        console.log('[Navigation] 📢 Calling speakText for "Memulai navigasi"');
        speakText('Memulai navigasi.', 'id-ID', true, function() {
            console.log('[Navigation] ✅ "Memulai navigasi" completed, calling announceRouteDirections');
            // Announce full route summary (distance, time, and directions)
            announceRouteDirections(true, function() {
                console.log('[Navigation] ✅ announceRouteDirections completed, calling announceFirstDirections');
                // After route announced, announce first few instructions
                announceFirstDirections(function() {
                    console.log('[Navigation] ✅ announceFirstDirections completed');
                    // CRITICAL: Jangan restart microphone setelah "Navigasi" - mikrofon harus MATI
                    // User harus ucapkan "Halo" untuk mengaktifkan kembali mikrofon
                    console.log('🔒 Microphone remains OFF after navigation started - user must say "Halo" to reactivate');
                    updateVoiceStatus('📍 Navigasi aktif - Ucapkan "Halo" untuk aktivasi mikrofon');
                });
            });
        });
    }, 200);
    
    // CRITICAL: Fungsi restartMicrophoneAfterNavigasi() dihapus
    // Mikrofon HARUS MATI setelah "Navigasi" dikatakan
    // User harus ucapkan "Halo" untuk mengaktifkan kembali mikrofon
    
    // Start turn-by-turn navigation
    isNavigating = true;
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
        // Track if destination was successfully found
        let destinationFound = false;
        
        // FIRST: Check knownCities BEFORE trying Nominatim API (faster and more reliable)
        const cityKey = location.toLowerCase().trim().replace(/[.,;:!?]/g, '').trim();
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            console.log('✅ Found in knownCities:', cityKey, '→', city.name);
            
            // STEP 4: Matikan mikrofon setelah tujuan ditemukan
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            // STEP 5: Update destination dan tunggu route dibuat
            // Set pending announcement data untuk dipanggil setelah route dibuat
            pendingRouteAnnouncementData = {
                shortName: city.name,
                fullName: city.name
            };
            
            updateDestination(city.lat, city.lng, city.name);
            updateVoiceStatus('🔍 Membuat rute ke ' + city.name + '...');
            
            // Announcement akan dipanggil di event handler 'routesfound' setelah route dibuat
            console.log('⏳ Waiting for route to be created - announcement will be triggered automatically');
            
            destinationFound = true;
            return; // Exit early - location found in knownCities
        }
        
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
        
        // Check if GPS accuracy is good enough for bounded search
        let useBoundedSearch = false;
        if (currentUserPosition) {
            const userLatLng = currentUserPosition.getLatLng();
            const userLat = userLatLng.lat;
            const userLng = userLatLng.lng;
            
            // Check if we have good GPS accuracy (check if marker has accuracy info)
            // If accuracy is very poor (> 1000m), skip bounded search and use global search
            const accuracy = currentUserPosition.options && currentUserPosition.options.accuracy;
            if (accuracy && accuracy < 1000) {
                useBoundedSearch = true;
            } else if (!accuracy) {
                // If no accuracy info, assume GPS is OK (might be from bestGPSLocation)
                useBoundedSearch = true;
            }
            
            if (useBoundedSearch) {
            // Define search radius (expanded to 200km from user location for wider coverage)
            const radius = 1.8; // ~200km in degrees (was 0.45 = 50km)
            const minLat = userLat - radius;
            const maxLat = userLat + radius;
            const minLng = userLng - radius;
            const maxLng = userLng + radius;
            
            // Use Nominatim API with bounded search around user location - GLOBAL SEARCH
            // Removed countrycodes restriction, increased limit, expanded radius
                // Viewbox format: minLng,minLat,maxLng,maxLat (NOT minLng,maxLat,maxLng,minLat)
                geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=20&bounded=1&viewbox=${minLng},${minLat},${maxLng},${maxLat}&addressdetails=1&accept-language=id,en`;
            boundedSearch = true;
            console.log('🔍 Bounded search:', userLat + ',' + userLng, 'radius: ~200km (expanded)');
            } else {
                // GPS accuracy too poor, use global search
                geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=20&addressdetails=1&accept-language=id,en`;
                console.log('🔍 Global search (GPS accuracy too poor for bounded search)');
            }
        } else {
            // If no user location, use global search (no country restriction)
            geocodeUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=20&addressdetails=1&accept-language=id,en`;
            console.log('🔍 Global search (no user location, no country restriction)');
        }
        
        try {
            const response = await fetchNominatim(geocodeUrl);
            const data = await response.json();
            
            // FIXED: Nominatim returns array directly, not object with results property
            const results = Array.isArray(data) ? data : (data.results || []);
            console.log('📊 Geocoding results:', results.length, 'results found');
            
            if (results && results.length > 0) {
                // If bounded search, find closest result to user location
                let result = results[0];
                let minDistance = 0;
                
                if (boundedSearch && currentUserPosition) {
                    const userLatLng = currentUserPosition.getLatLng();
                    
                    // Find closest result to user location
                    minDistance = Infinity;
                    results.forEach(function(item) {
                        const dist = Math.sqrt(
                            Math.pow(parseFloat(item.lat) - userLatLng.lat, 2) + 
                            Math.pow(parseFloat(item.lon) - userLatLng.lng, 2)
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
                
                console.log('[Navigation] Destination found:', fullName, 'at', newLat, newLng);
                
                // CRITICAL: Mark destination as found BEFORE any operations
                // This ensures fallback won't run even if there's an error later
                destinationFound = true;
                
                // Stop microphone briefly to announce destination, then restart for "Navigasi" command
                // Keep microphone active for 10 seconds to listen for "Navigasi" command
                if (isListening && recognition) {
                    recognition.stop();
                    isListening = false;
                }
                
                // STEP 4: Matikan mikrofon setelah tujuan ditemukan
                // Mikrofon sudah dimatikan di atas (baris 5651-5654)
                
                // STEP 5: Update destination dan tunggu route dibuat
                // Set pending announcement data untuk dipanggil setelah route dibuat
                pendingRouteAnnouncementData = {
                    shortName: shortName,
                    fullName: fullName
                };
                
                updateDestination(newLat, newLng, fullName);
                updateVoiceStatus('🔍 Membuat rute ke ' + shortName + '...');
                
                // Announcement akan dipanggil di event handler 'routesfound' setelah route dibuat
                console.log('⏳ Waiting for route to be created - announcement will be triggered automatically');
                
                // CRITICAL: Return to prevent fallback (destinationFound already set above)
                return;
            } else {
                console.log('⚠️ No geocoding results found for:', location);
            }
        } catch (nominatimError) {
            console.error('❌ Nominatim geocoding failed:', nominatimError);
            // Don't log empty error object, log the actual error message
            if (nominatimError && nominatimError.message) {
                console.error('   Error details:', nominatimError.message);
            }
        }
        
        // CRITICAL: Only fallback to city list if destination was NOT found
        if (destinationFound) {
            console.log('✅ Destination already found, skipping fallback city check');
            return;
        }
        
        // Fallback to hardcoded cities for Indonesia (should not reach here if knownCities check at top worked)
        // Clean up the location name - remove punctuation and extra spaces
        // Note: cityKey already declared at top of function, but this is fallback path
        const fallbackCityKey = location.toLowerCase().trim().replace(/[.,;:!?]/g, '').trim();
        console.log('Looking for city (fallback):', fallbackCityKey);
        
        if (knownCities[fallbackCityKey]) {
            const city = knownCities[fallbackCityKey];
            
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
            console.log('City not found (fallback):', fallbackCityKey, 'Available cities:', Object.keys(knownCities));
            
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
        
        // Reset marker icon to normal (blue circle)
        if (currentUserPosition) {
            const normalIcon = L.divIcon({
                className: 'custom-user-marker',
                html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            currentUserPosition.setIcon(normalIcon);
        }
        
                // Exit fullscreen
                const exitFullscreen = document.exitFullscreen || 
                                      document.webkitExitFullscreen || 
                                      document.mozCancelFullScreen || 
                                      document.msExitFullscreen;
                if (exitFullscreen) {
                    exitFullscreen.call(document).catch(err => {
                        console.log('Exit fullscreen failed:', err);
                    });
                }
                
                // Remove 3D/isometric perspective and reset zoom
                document.body.classList.remove('navigating');
                document.documentElement.classList.remove('navigating');
                
                // Restore body/html styles
                document.body.style.width = '';
                document.body.style.height = '';
                document.body.style.margin = '';
                document.body.style.padding = '';
                document.body.style.overflow = '';
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.left = '';
                document.body.style.right = '';
                document.body.style.bottom = '';
                
                document.documentElement.style.width = '';
                document.documentElement.style.height = '';
                document.documentElement.style.margin = '';
                document.documentElement.style.padding = '';
                document.documentElement.style.overflow = '';
                document.documentElement.style.position = '';
                document.documentElement.style.top = '';
                document.documentElement.style.left = '';
                document.documentElement.style.right = '';
                document.documentElement.style.bottom = '';
                
                // Reset map styles
                const mapElement = document.getElementById('map');
                if (mapElement) {
                    mapElement.style.position = '';
                    mapElement.style.top = '';
                    mapElement.style.left = '';
                    mapElement.style.right = '';
                    mapElement.style.bottom = '';
                    mapElement.style.width = '';
                    mapElement.style.height = '';
                    mapElement.style.zIndex = '';
                }
                
                const leafletContainer = document.querySelector('.leaflet-container');
                if (leafletContainer) {
                    leafletContainer.style.position = '';
                    leafletContainer.style.top = '';
                    leafletContainer.style.left = '';
                    leafletContainer.style.right = '';
                    leafletContainer.style.bottom = '';
                    leafletContainer.style.width = '';
                    leafletContainer.style.height = '';
                }
                
                // Show sidebar again
                const navbar = document.getElementById('sideNavbar');
                if (navbar) {
                    navbar.classList.remove('collapsed');
                    navbar.style.display = '';
                    navbar.style.visibility = '';
                }
                
                // Show toggle button
                const toggleBtn = document.getElementById('navbarToggleBtn');
                if (toggleBtn) {
                    toggleBtn.style.display = '';
                    toggleBtn.style.visibility = '';
                }
                
                // Show back button
                const backBtn = document.getElementById('backToHomeBtn');
                if (backBtn) {
                    backBtn.style.display = '';
                    backBtn.style.visibility = '';
                }
                
                // Force map resize
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
                
                const leafletContainerReset = document.querySelector('.leaflet-container');
                if (leafletContainerReset) {
                    leafletContainerReset.style.width = '';
                    leafletContainerReset.style.height = '';
                    leafletContainerReset.style.position = '';
                    leafletContainerReset.style.top = '';
                    leafletContainerReset.style.left = '';
                }
                
                const currentZoom = map.getZoom();
                if (currentZoom > 15) {
                    map.setZoom(15, { animate: true, duration: 0.5 });
                }
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
        if (!recognition) {
            console.error('❌ Speech recognition not available');
            updateVoiceStatus('❌ Speech recognition tidak tersedia di browser ini');
            return;
        }
    }
    
    if (isListening) {
        // Stop listening
        try {
            recognition.stop();
            isListening = false;
            updateVoiceStatus('🔇 Mikrofon dimatikan');
            console.log('🔇 Microphone stopped');
        } catch (error) {
            console.error('Error stopping microphone:', error);
        }
    } else {
        // Start listening
        // Check if user has interacted (required for browser security)
        if (!hasUserInteraction) {
            updateVoiceStatus('⚠️ Klik layar sekali untuk mengaktifkan mikrofon');
            console.log('⚠️ User interaction required - waiting for click...');
            
            // Wait for user click
            const clickHandler = function() {
                hasUserInteraction = true;
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('touchstart', clickHandler);
                // Retry after click
                toggleVoiceListening();
            };
            
            document.addEventListener('click', clickHandler, { once: true });
            document.addEventListener('touchstart', clickHandler, { once: true });
            return;
        }
        
        // Clear stopped flag if set
        if (recognition._stopped) {
            recognition._stopped = false;
            console.log('🔄 Cleared stopped flag');
        }
        
        try {
            // Ensure recognition is initialized
            if (!recognition) {
                console.warn('⚠️ Recognition not initialized, initializing now...');
                const initResult = initSpeechRecognition();
                if (!initResult && !recognition) {
                    throw new Error('Speech recognition initialization failed');
                }
            }
            
            finalTranscript = '';
            
            // Check if already started (prevent duplicate starts)
            if (isListening) {
                console.log('ℹ️ Microphone already listening');
                return;
            }
            
            recognition.start();
            isListening = true;
            updateVoiceStatus('🎤 Mendengarkan... Ucapkan tujuan Anda');
            console.log('🎤 Microphone started successfully');
            
            // Small delay before speaking to ensure microphone is ready
            setTimeout(() => {
                speakText('Mendengarkan, ucapkan tujuan Anda', 'id-ID', true);
            }, 500);
        } catch (error) {
            console.error('❌ Error starting microphone:', error);
            isListening = false;
            
            // Detailed error handling
            let errorMessage = '❌ Gagal mengaktifkan mikrofon';
            if (error.message) {
                errorMessage += ': ' + error.message;
            }
            
            if (error.name === 'NotAllowedError' || (error.message && error.message.includes('not-allowed'))) {
                errorMessage = '⚠️ Izin mikrofon diperlukan - klik layar sekali dan pilih Allow';
                hasUserInteraction = true; // Mark interaction for retry
                console.log('💡 User needs to grant microphone permission');
            } else if (error.name === 'NotFoundError' || (error.message && error.message.includes('audio-capture'))) {
                errorMessage = '❌ Mikrofon tidak ditemukan - pastikan mikrofon terhubung';
                console.error('💡 No microphone found or accessible');
            }
            
            updateVoiceStatus(errorMessage);
        }
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
    
    // ALUR BARU: Panduan penggunaan yang jelas sesuai permintaan
    const welcomeText = 'Selamat datang di Senavision. Panduan penggunaan: ' +
        'Setelah suara ini selesai, mikrofon akan aktif. ' +
        'Sebutkan nama tujuan Anda, misalnya Jakarta, Bandung, atau nama lokasi lainnya. ' +
        'Setelah tujuan ditetapkan, Anda akan mendengar informasi rute. ' +
        'Kemudian ucapkan "Navigasi" untuk memulai perjalanan. ' +
        'Navigator akan memberikan petunjuk arah seperti "Belok Kanan" dan "Belok Kiri" pada setiap belokan. ' +
        'Selamat menikmati perjalanan Anda.';
    
    console.log('📢 Starting welcome guide announcement');
    updateVoiceStatus('📢 Memutar panduan penggunaan...');
    
    // Set hasUserInteraction to true so we can use speech synthesis
    hasUserInteraction = true;
    
    speakText(welcomeText, 'id-ID', true, function() {
        // STEP 2: Setelah announcement selesai, aktifkan mikrofon
        console.log('✅ Welcome guide finished - activating microphone');
        
        // Initialize speech recognition if not already done
        if (!recognition) {
            initSpeechRecognition();
        }
        
        // Clear stopped flag if any
        if (recognition && recognition._stopped) {
            recognition._stopped = false;
        }
        
        // STEP 2: Aktifkan mikrofon untuk mendengarkan nama tujuan
        if (!isListening && recognition) {
            try {
                recognition.start();
                isListening = true;
                suppressMicActivationSpeech = false;
                console.log('✅ Microphone activated after welcome guide - listening for destination');
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
// CRITICAL FIX: Versi yang sangat sederhana - langsung speak tanpa logika kompleks
function speakText(text, lang = 'id-ID', priority = false, onComplete = null) {
    // Validasi dasar
    if (!text || typeof text !== 'string' || text.trim() === '') {
        console.warn('[Navigation] ⚠️ Empty text');
        if (onComplete) setTimeout(onComplete, 100);
        return;
    }
    
    if (!('speechSynthesis' in window)) {
        console.error('[Navigation] ❌ speechSynthesis not available');
        if (onComplete) setTimeout(onComplete, 100);
        return;
    }
    
    // Skip duplicate (kecuali priority)
    // CRITICAL: Jika priority=true, jangan skip meskipun duplicate
    if (text === lastSpokenMessage && !priority) {
        console.log('[Navigation] ⏭️ Duplicate skipped (no priority)');
        if (onComplete) setTimeout(onComplete, 100);
        return;
    }
    
    // CRITICAL: Jika priority=true, clear lastSpokenMessage untuk memastikan announcement berbunyi
    if (priority) {
        const oldMessage = lastSpokenMessage;
        lastSpokenMessage = '';
        console.log('[Navigation] ✅ Priority announcement - cleared lastSpokenMessage:', oldMessage);
    }
    
    const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
    console.log('[Navigation] 🎯 speakText called:', preview);
    console.log('[Navigation] 🔍 speakText params:', {
        textLength: text.length,
        lang: lang,
        priority: priority,
        hasOnComplete: !!onComplete,
        lastSpokenMessage: lastSpokenMessage
    });
    console.log('[Navigation] 📊 Current state:', {
        isSpeaking: isSpeaking,
        speechSynthesisSpeaking: window.speechSynthesis.speaking,
        speechSynthesisPending: window.speechSynthesis.pending,
        voiceDirectionsEnabled: voiceDirectionsEnabled
    });
    
    // CRITICAL: Pastikan hasUserInteraction = true SEBELUM memanggil _doSpeak
    if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
        console.log('[Navigation] 🔧 Setting hasUserInteraction = true (di speakText)');
        hasUserInteraction = true;
    }
    
    // CRITICAL: Pastikan voiceDirectionsEnabled = true SEBELUM memanggil _doSpeak
    if (typeof voiceDirectionsEnabled !== 'undefined' && !voiceDirectionsEnabled) {
        console.log('[Navigation] 🔧 Setting voiceDirectionsEnabled = true (di speakText)');
        voiceDirectionsEnabled = true;
    }
    
    // FIXED: Improved cancellation logic - only cancel if speech has been running for a while
    // This prevents interrupting speech that just started, which causes "interrupted" errors
    const isCurrentlySpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    const timeSinceSpeechStart = Date.now() - speechStartTime;
    const canCancel = timeSinceSpeechStart > MIN_SPEECH_DURATION; // Only cancel if speech has been running > 1.5s
    
    if (isCurrentlySpeaking && priority && canCancel) {
        // Only cancel for priority announcement if speech has been running for a while
        console.log('[Navigation] 🔄 Canceling existing speech for priority announcement (speech running for', timeSinceSpeechStart, 'ms)...');
        window.speechSynthesis.cancel();
        // Wait untuk cancel benar-benar selesai
        setTimeout(() => {
            console.log('[Navigation] ✅ Cancel selesai, memanggil _doSpeak...');
            console.log('[Navigation] 🎯🎯🎯 CALLING _doSpeak NOW (after cancel) 🎯🎯🎯');
            _doSpeak(text, lang, priority, onComplete, preview);
        }, 300);
    } else {
        _doSpeak(text, lang, priority, onComplete, preview);
    }
    
    // CRITICAL: Log bahwa speakText selesai (untuk debugging)
    console.log('[Navigation] ✅ speakText function completed, _doSpeak should be called');
}

// Helper function untuk benar-benar melakukan speak
function _doSpeak(text, lang, priority, onComplete, preview) {
    console.log('[Navigation] 🎤 _doSpeak called:', preview);
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    // Event handlers dengan logging detail
    utterance.onstart = function() {
        console.log('[Navigation] 🔊🔊🔊 Speech STARTED:', preview);
        console.log('[Navigation] 📊 Speech state after start:', {
            isSpeaking: true,
            speechSynthesisSpeaking: window.speechSynthesis.speaking,
            speechSynthesisPending: window.speechSynthesis.pending
        });
        isSpeaking = true;
        speechStartTime = Date.now(); // Track when speech started
        lastSpokenMessage = text;
        if (typeof window.SpeechCoordinator !== 'undefined') {
            window.SpeechCoordinator.isNavigationSpeaking = true;
        }
        markNavigatorSpeechStart();
        
        // FIXED: Clear the warning flag since speech started successfully
        if (window._speechStartWarning) {
            clearTimeout(window._speechStartWarning);
            window._speechStartWarning = null;
        }
    };
    
    utterance.onend = function() {
        // Log saat navigator selesai berbicara
        if (priority) {
            console.log('✅ [NAVIGATOR] Selesai berbicara:', text);
            const timestamp = new Date().toLocaleTimeString('id-ID');
            console.log(`[${timestamp}] ✅ NAVIGATOR SELESAI BERBICARA: "${text}"`);
        }
        console.log('[Navigation] ✅✅✅ Speech ENDED:', preview);
        isSpeaking = false;
        speechStartTime = 0; // Reset speech start time
        if (typeof window.SpeechCoordinator !== 'undefined') {
            window.SpeechCoordinator.markSpeechEnd('high');
        }
        markNavigatorSpeechEnd();
        setTimeout(() => { lastSpokenMessage = ''; }, 5000);
        if (onComplete) {
            console.log('[Navigation] 📞 Calling onComplete callback');
            setTimeout(onComplete, 100);
        }
        processAnnouncementQueue();
    };
    
    utterance.onerror = function(event) {
        console.error('[Navigation] ❌❌❌ Speech ERROR:', {
            error: event.error,
            errorName: event.error ? event.error.name : 'unknown',
            errorMessage: event.error ? event.error.message : 'unknown',
            type: event.type,
            charIndex: event.charIndex,
            charLength: event.charLength,
            elapsedTime: event.elapsedTime,
            name: event.name
        });
        isSpeaking = false;
        speechStartTime = 0; // Reset speech start time on error
        if (typeof window.SpeechCoordinator !== 'undefined') {
            window.SpeechCoordinator.markSpeechEnd('high');
        }
        markNavigatorSpeechEnd();
        if (onComplete) setTimeout(onComplete, 100);
        processAnnouncementQueue();
    };
    
    // CRITICAL: Langsung speak tanpa pengecekan lagi
    try {
        // CRITICAL: Untuk priority announcement (seperti belokan), cancel speech yang sedang berjalan
        // Tapi pastikan tidak cancel announcement belokan yang baru saja dimulai
        if (priority && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            console.log('[Navigation] 🔄 Priority announcement - canceling existing speech before new announcement...');
            window.speechSynthesis.cancel();
            // Tunggu sedikit untuk cancel selesai
            setTimeout(() => {
                _doSpeakInternal(utterance, text, lang, priority, onComplete, preview);
            }, 100);
            return;
        }
        
        // Untuk non-priority, hanya cancel jika tidak ada speech navigation yang penting
        if (!priority && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            // Check jika speech yang sedang berjalan adalah navigation speech
            const isNavigationSpeech = (typeof window.SpeechCoordinator !== 'undefined') && 
                                      window.SpeechCoordinator.isNavigationSpeaking;
            if (!isNavigationSpeech) {
                console.log('[Navigation] 🔄 Canceling non-navigation speech before new announcement...');
                window.speechSynthesis.cancel();
                setTimeout(() => {
                    _doSpeakInternal(utterance, text, lang, priority, onComplete, preview);
                }, 100);
                return;
            } else {
                // Jika navigation speech sedang berjalan, queue announcement ini
                console.log('[Navigation] ⏸️ Navigation speech active, queuing announcement...');
                if (typeof announcementQueue === 'undefined') {
                    announcementQueue = [];
                }
                announcementQueue.push({ text, lang, priority, onComplete, preview });
                return;
            }
        }
        
        _doSpeakInternal(utterance, text, lang, priority, onComplete, preview);
    } catch(error) {
        console.error('[Navigation] ❌ Exception in _doSpeak:', error);
        isSpeaking = false;
        if (onComplete) setTimeout(onComplete, 100);
    }
}

// Internal function untuk benar-benar melakukan speak
function _doSpeakInternal(utterance, text, lang, priority, onComplete, preview) {
    try {
        // CRITICAL: Pastikan hasUserInteraction = true SEBELUM speak
        if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
            console.log('[Navigation] 🔧 Setting hasUserInteraction = true');
            hasUserInteraction = true;
        }
        
        // CRITICAL: Pastikan volume = 1 (maksimal)
        if (utterance.volume !== 1) {
            console.log('[Navigation] 🔧 Setting volume = 1 (maksimal)');
            utterance.volume = 1;
        }
        
        // CRITICAL: Pastikan voice Indonesian dipilih jika belum
        if (!utterance.voice) {
            const voices = window.speechSynthesis.getVoices();
            const indonesianVoices = voices.filter(v => v.lang.startsWith('id-') || v.lang === 'id-ID');
            if (indonesianVoices.length > 0) {
                utterance.voice = indonesianVoices[0];
                console.log('[Navigation] 🔧 Voice Indonesian dipilih:', indonesianVoices[0].name);
            }
        }
        
        // Log detail utterance sebelum speak
        console.log('[Navigation] 📋 Utterance details:', {
            text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
            lang: utterance.lang,
            voice: utterance.voice ? utterance.voice.name : 'default',
            volume: utterance.volume,
            rate: utterance.rate,
            pitch: utterance.pitch,
            hasUserInteraction: typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : 'undefined'
        });
        
        console.log('[Navigation] 🎯 Calling window.speechSynthesis.speak() NOW...');
        
        // CRITICAL: Untuk priority announcement (belokan), selalu cancel speech yang sedang berjalan
        // Untuk non-priority, hanya cancel jika bukan navigation speech
        if (priority && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            console.log('[Navigation] 🔄 Priority announcement - canceling existing speech...');
            window.speechSynthesis.cancel();
            // Tunggu cancel selesai
            setTimeout(() => {
                window.speechSynthesis.speak(utterance);
                console.log('[Navigation] ✅✅✅ window.speechSynthesis.speak() CALLED (after cancel for priority)');
            }, 150);
        } else if (!priority && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            // Untuk non-priority, check apakah speech yang sedang berjalan adalah navigation
            const isNavigationSpeech = (typeof window.SpeechCoordinator !== 'undefined') && 
                                      window.SpeechCoordinator.isNavigationSpeaking;
            if (!isNavigationSpeech) {
                console.log('[Navigation] 🔄 Canceling non-navigation speech...');
                window.speechSynthesis.cancel();
                setTimeout(() => {
                    window.speechSynthesis.speak(utterance);
                    console.log('[Navigation] ✅✅✅ window.speechSynthesis.speak() CALLED (after cancel)');
                }, 150);
            } else {
                // Navigation speech sedang berjalan, langsung speak (akan queue atau interrupt)
                window.speechSynthesis.speak(utterance);
                console.log('[Navigation] ✅✅✅ window.speechSynthesis.speak() CALLED (navigation active)');
            }
        } else {
            // CRITICAL: Pastikan voices sudah loaded sebelum speak
            const voices = window.speechSynthesis.getVoices();
            if (voices.length === 0) {
                console.warn('[Navigation] ⚠️ Voices belum loaded, menunggu...');
                window.speechSynthesis.onvoiceschanged = function() {
                    console.log('[Navigation] ✅ Voices loaded, memanggil speak...');
                    window.speechSynthesis.onvoiceschanged = null; // Remove handler
                    // Re-select voice setelah voices loaded
                    const newVoices = window.speechSynthesis.getVoices();
                    const indonesianVoices = newVoices.filter(v => v.lang.startsWith('id-') || v.lang === 'id-ID');
                    if (indonesianVoices.length > 0 && !utterance.voice) {
                        utterance.voice = indonesianVoices[0];
                        console.log('[Navigation] ✅ Voice Indonesian dipilih setelah voices loaded:', indonesianVoices[0].name);
                    }
                    window.speechSynthesis.speak(utterance);
                    console.log('[Navigation] ✅✅✅ window.speechSynthesis.speak() CALLED (after voices loaded)');
                };
                return; // Exit early, akan dipanggil lagi setelah voices loaded
            }
            
            window.speechSynthesis.speak(utterance);
            console.log('[Navigation] ✅✅✅ window.speechSynthesis.speak() CALLED');
        }
        
        // Double check setelah 100ms
        setTimeout(() => {
            if (!window.speechSynthesis.speaking && !isSpeaking) {
                console.warn('[Navigation] ⚠️ Speech did not start - may need user interaction');
            }
        }, 100);
    } catch(error) {
        console.error('[Navigation] ❌ Exception in _doSpeakInternal:', error);
        isSpeaking = false;
        if (onComplete) setTimeout(onComplete, 100);
    }
}

// Process announcement queue
function processAnnouncementQueue() {
    // FIXED: Check queue more aggressively - also check if speech is pending
    const speechActive = isSpeaking || (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending));
    
    if (announcementQueue.length > 0 && !speechActive) {
        // FIXED: Prioritize priority announcements in queue
        const priorityIndex = announcementQueue.findIndex(item => item.priority);
        const next = priorityIndex >= 0 ? announcementQueue.splice(priorityIndex, 1)[0] : announcementQueue.shift();
        console.log('[Navigation] 🔄 Processing queued announcement:', next.text.substring(0, 50));
        speakText(next.text, next.lang, next.priority || false, next.onComplete || null);
    } else if (announcementQueue.length > 0 && speechActive) {
        // Queue has items but speech is active - schedule check
        setTimeout(processAnnouncementQueue, 200);
    }
}

// CRITICAL: Test function untuk debugging - bisa dipanggil dari console
// Usage: testNavigationVoice("Halo, ini adalah test suara navigasi")
window.testNavigationVoice = function(text = 'Test suara navigasi') {
    console.log('[Test] 🧪 Testing navigation voice with text:', text);
    console.log('[Test] 📊 speechSynthesis available:', 'speechSynthesis' in window);
    if ('speechSynthesis' in window) {
        console.log('[Test] 📊 Current state:', {
            speaking: window.speechSynthesis.speaking,
            pending: window.speechSynthesis.pending,
            paused: window.speechSynthesis.paused
        });
    }
    speakText(text, 'id-ID', true, function() {
        console.log('[Test] ✅ Test completed');
    });
};

// Test Navigation Object - untuk testing navigasi dengan simulasi GPS
// Usage:
//   testNavigation.setLocation(lat, lng, zoom) - set lokasi awal
//   testNavigation.startNavigation(lat, lng, name) - start navigation
//   testNavigation.simulateRouteNavigation() - simulate movement along route
window.testNavigation = {
    // Variables untuk simulasi
    _simulationInterval: null,
    _routeCoordinates: null,
    _currentRouteIndex: 0,
    _isSimulating: false,
    
    // Set lokasi awal (simulasi GPS position)
    setLocation: function(lat, lng, zoom = 15) {
        console.log('[Test] 📍 Setting initial location:', lat, lng, 'Zoom:', zoom);
        
        const latLng = L.latLng(lat, lng);
        
        // Create or update user position marker
        if (!currentUserPosition) {
            // Create new marker
            const userIcon = L.divIcon({
                className: 'custom-user-marker',
                html: '<div style="background: #007bff; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            
            currentUserPosition = L.marker(latLng, {
                icon: userIcon,
                draggable: false,
                zIndexOffset: 1000
            }).addTo(map);
            
            currentUserPosition.bindPopup("📍 Lokasi Anda (Test Mode)");
        } else {
            // Update existing marker
            currentUserPosition.setLatLng(latLng);
            currentUserPosition.setPopupContent("📍 Lokasi Anda (Test Mode)");
        }
        
        // Update best GPS location
        bestGPSLocation = { lat: lat, lng: lng, accuracy: 10 };
        
        // Update GPS history
        gpsHistory = [{ lat: lat, lng: lng, accuracy: 10 }];
        
        // Set map view
        map.setView(latLng, zoom);
        
        // Mark permission as granted
        hasPermission = true;
        
        console.log('[Test] ✅ Location set successfully');
        return true;
    },
    
    // Start navigation dengan destination
    startNavigation: function(destLat, destLng, destName = 'Test Destination') {
        console.log('[Test] 🎯 Starting navigation to:', destName, destLat, destLng);
        
        if (!currentUserPosition) {
            console.error('[Test] ❌ User position not set. Call testNavigation.setLocation() first.');
            return false;
        }
        
        const userLatLng = currentUserPosition.getLatLng();
        console.log('[Test] 📍 From:', userLatLng.lat.toFixed(6), userLatLng.lng.toFixed(6));
        console.log('[Test] 📍 To:', destLat, destLng);
        
        // Set destination
        updateDestination(destLat, destLng, destName);
        
        // Wait for route calculation using routesfound event
        return new Promise((resolve) => {
            let routeFound = false;
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds max wait
            
            // Listen for routesfound event
            const self = this;
            const onRoutesFound = function(e) {
                if (routeFound) return; // Already handled
                routeFound = true;
                
                if (e.routes && e.routes[0]) {
                    const routeData = e.routes[0];
                    // CRITICAL: Set currentRouteData so announceNextDirection can work
                    currentRouteData = routeData;
                    console.log('[Test] ✅ currentRouteData set in testNavigation.startNavigation:', {
                        hasRoute: !!currentRouteData,
                        hasInstructions: !!(currentRouteData && currentRouteData.instructions),
                        instructionCount: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
                    });
                    const coordinates = routeData.coordinates || (routeData.geometry && routeData.geometry.coordinates);
                    
                    if (coordinates && coordinates.length > 0) {
                        // Convert coordinates format if needed (geometry uses [lng, lat], coordinates uses [lat, lng])
                        self._routeCoordinates = [];
                        for (let i = 0; i < coordinates.length; i++) {
                            const coord = coordinates[i];
                            if (Array.isArray(coord) && coord.length >= 2) {
                                let lat, lng;
                                // Check if it's [lng, lat] format (geometry) or [lat, lng] format (coordinates)
                                if (Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
                                    // Likely [lat, lng]
                                    lat = coord[0];
                                    lng = coord[1];
                                } else {
                                    // Likely [lng, lat], convert to [lat, lng]
                                    lat = coord[1];
                                    lng = coord[0];
                                }
                                
                                // Validate values
                                if (typeof lat === 'number' && typeof lng === 'number' && 
                                    !isNaN(lat) && !isNaN(lng) &&
                                    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                    self._routeCoordinates.push([lat, lng]);
                                } else {
                                    console.warn('[Test] ⚠️ Skipping invalid coordinate:', coord);
                                }
                            } else if (coord && typeof coord === 'object') {
                                // Object format
                                const lat = coord.lat || coord.latitude;
                                const lng = coord.lng || coord.longitude;
                                if (typeof lat === 'number' && typeof lng === 'number' && 
                                    !isNaN(lat) && !isNaN(lng) &&
                                    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                    self._routeCoordinates.push([lat, lng]);
                                } else {
                                    console.warn('[Test] ⚠️ Skipping invalid coordinate object:', coord);
                                }
                            }
                        }
                        
                        if (self._routeCoordinates.length === 0) {
                            console.error('[Test] ❌ No valid coordinates found after conversion');
                            resolve(false);
                            return;
                        }
                        
                        console.log('[Test] ✅ Route calculated with', self._routeCoordinates.length, 'points');
                        console.log('[Test] 🚀 Starting navigation...');
                        
                        // Start turn-by-turn navigation
                        startTurnByTurnNavigation();
                        
                        // Reset simulation index
                        self._currentRouteIndex = 0;
                        
                        console.log('[Test] ✅ Navigation started!');
                        resolve(true);
                    } else {
                        console.error('[Test] ❌ Route has no coordinates');
                        resolve(false);
                    }
                } else {
                    console.error('[Test] ❌ Route data not found in event');
                    resolve(false);
                }
            };
            
            // Attach event listener
            if (route) {
                route.once('routesfound', onRoutesFound);
            }
            
            // Fallback: check existing route
            const checkRoute = setInterval(function() {
                attempts++;
                
                if (route) {
                    // Try to get coordinates from existing route
                    let routeData = null;
                    let coordinates = null;
                    
                    // Check route._routes (internal structure)
                    if (route._routes && route._routes[0]) {
                        routeData = route._routes[0];
                        // CRITICAL: Set currentRouteData so announceNextDirection can work
                        currentRouteData = routeData;
                        console.log('[Test] ✅ currentRouteData set from route._routes in testNavigation.startNavigation:', {
                            hasRoute: !!currentRouteData,
                            hasInstructions: !!(currentRouteData && currentRouteData.instructions),
                            instructionCount: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
                        });
                        coordinates = routeData.coordinates || (routeData.geometry && routeData.geometry.coordinates);
                    }
                    
                    if (coordinates && coordinates.length > 0 && !routeFound) {
                        clearInterval(checkRoute);
                        routeFound = true;
                        
                        // Convert coordinates format if needed
                        self._routeCoordinates = [];
                        for (let i = 0; i < coordinates.length; i++) {
                            const coord = coordinates[i];
                            if (Array.isArray(coord) && coord.length >= 2) {
                                let lat, lng;
                                if (Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
                                    lat = coord[0];
                                    lng = coord[1];
                                } else {
                                    lat = coord[1];
                                    lng = coord[0];
                                }
                                
                                // Validate values
                                if (typeof lat === 'number' && typeof lng === 'number' && 
                                    !isNaN(lat) && !isNaN(lng) &&
                                    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                    self._routeCoordinates.push([lat, lng]);
                                } else {
                                    console.warn('[Test] ⚠️ Skipping invalid coordinate:', coord);
                                }
                            } else if (coord && typeof coord === 'object') {
                                const lat = coord.lat || coord.latitude;
                                const lng = coord.lng || coord.longitude;
                                if (typeof lat === 'number' && typeof lng === 'number' && 
                                    !isNaN(lat) && !isNaN(lng) &&
                                    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                    self._routeCoordinates.push([lat, lng]);
                                } else {
                                    console.warn('[Test] ⚠️ Skipping invalid coordinate object:', coord);
                                }
                            }
                        }
                        
                        if (self._routeCoordinates.length === 0) {
                            console.error('[Test] ❌ No valid coordinates found after conversion');
                            resolve(false);
                            return;
                        }
                        
                        console.log('[Test] ✅ Route found with', self._routeCoordinates.length, 'points');
                        console.log('[Test] 🚀 Starting navigation...');
                        
                        startTurnByTurnNavigation();
                        self._currentRouteIndex = 0;
                        
                        console.log('[Test] ✅ Navigation started!');
                        resolve(true);
                    }
                }
                
                if (attempts >= maxAttempts) {
                    clearInterval(checkRoute);
                    if (!routeFound) {
                        console.error('[Test] ❌ Route calculation timeout');
                        resolve(false);
                    }
                }
            }, 500);
        });
    },
    
    // Simulate movement along the route
    // speed: 1-10 (1 = sangat pelan, 10 = cepat), default: 3 (pelan)
    simulateRouteNavigation: function(speed = 3) {
        console.log('[Test] 🚶 Starting route simulation...');
        
        if (this._isSimulating) {
            console.log('[Test] ⚠️ Simulation already running. Use stopSimulation() to stop.');
            return;
        }
        
        if (!this._routeCoordinates || this._routeCoordinates.length === 0) {
            console.error('[Test] ❌ No route coordinates available. Start navigation first.');
            return;
        }
        
        if (!currentUserPosition) {
            console.error('[Test] ❌ User position not set.');
            return;
        }
        
        this._isSimulating = true;
        this._currentRouteIndex = 0;
        
        // Calculate interval based on speed (1-10 scale)
        // Speed 1 = sangat pelan (2000ms), Speed 10 = cepat (300ms)
        // Default speed 3 = pelan (1000ms)
        const speedToInterval = {
            1: 2000,  // Sangat pelan - 2 detik per titik
            2: 1500,  // Pelan - 1.5 detik per titik
            3: 1000,  // Agak pelan - 1 detik per titik (default)
            4: 800,   // Sedang-pelan - 0.8 detik per titik
            5: 600,   // Sedang - 0.6 detik per titik
            6: 500,   // Sedang-cepat - 0.5 detik per titik
            7: 400,   // Cepat - 0.4 detik per titik
            8: 350,   // Agak cepat - 0.35 detik per titik
            9: 300,   // Sangat cepat - 0.3 detik per titik
            10: 200   // Ekstra cepat - 0.2 detik per titik
        };
        
        // Clamp speed to valid range
        const clampedSpeed = Math.max(1, Math.min(10, Math.round(speed)));
        const intervalMs = speedToInterval[clampedSpeed] || 1000;
        const pointsPerSecond = 1000 / intervalMs;
        
        console.log('[Test] 📊 Simulation settings:', {
            totalPoints: this._routeCoordinates.length,
            speed: clampedSpeed + '/10',
            interval: intervalMs + 'ms',
            pointsPerSecond: pointsPerSecond.toFixed(2),
            estimatedDuration: ((this._routeCoordinates.length * intervalMs) / 1000).toFixed(1) + ' seconds'
        });
        
        // Stop any existing simulation
        if (this._simulationInterval) {
            clearInterval(this._simulationInterval);
        }
        
        // Start simulation
        const self = this;
        this._simulationInterval = setInterval(function() {
            if (self._currentRouteIndex >= self._routeCoordinates.length) {
                // Reached destination
                console.log('[Test] ✅ Reached destination!');
                self.stopSimulation();
                return;
            }
            
            // Get next coordinate
            const coord = self._routeCoordinates[self._currentRouteIndex];
            
            // Validate coordinate format
            let lat, lng;
            if (Array.isArray(coord)) {
                // Array format: [lat, lng] or [lng, lat]
                if (coord.length >= 2) {
                    // Check if first value is latitude (between -90 and 90)
                    if (Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
                        lat = coord[0];
                        lng = coord[1];
                    } else {
                        // Likely [lng, lat] format, swap
                        lat = coord[1];
                        lng = coord[0];
                    }
                } else {
                    console.error('[Test] ❌ Invalid coordinate format:', coord);
                    self._currentRouteIndex++;
                    return;
                }
            } else if (coord && typeof coord === 'object') {
                // Object format: {lat: ..., lng: ...} or {latitude: ..., longitude: ...}
                lat = coord.lat || coord.latitude;
                lng = coord.lng || coord.longitude;
            } else {
                console.error('[Test] ❌ Invalid coordinate format:', coord);
                self._currentRouteIndex++;
                return;
            }
            
            // Validate lat/lng values
            if (typeof lat !== 'number' || typeof lng !== 'number' || 
                isNaN(lat) || isNaN(lng) ||
                lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                console.error('[Test] ❌ Invalid lat/lng values:', lat, lng);
                self._currentRouteIndex++;
                return;
            }
            
            // Create LatLng object
            let latLng;
            try {
                latLng = L.latLng(lat, lng);
                
                // Validate LatLng object
                if (!latLng || typeof latLng.lat !== 'number' || typeof latLng.lng !== 'number') {
                    console.error('[Test] ❌ Failed to create LatLng object');
                    self._currentRouteIndex++;
                    return;
                }
            } catch (e) {
                console.error('[Test] ❌ Error creating LatLng:', e, 'lat:', lat, 'lng:', lng);
                self._currentRouteIndex++;
                return;
            }
            
            // Update user position
            try {
                if (currentUserPosition) {
                    currentUserPosition.setLatLng(latLng);
                } else {
                    console.error('[Test] ❌ currentUserPosition is null');
                    self.stopSimulation();
                    return;
                }
            } catch (e) {
                console.error('[Test] ❌ Error updating marker position:', e);
                self._currentRouteIndex++;
                return;
            }
            
            // Update best GPS location
            bestGPSLocation = { lat: latLng.lat, lng: latLng.lng, accuracy: 10 };
            
            // Update GPS history
            gpsHistory.push({ lat: latLng.lat, lng: latLng.lng, accuracy: 10 });
            if (gpsHistory.length > GPS_HISTORY_SIZE) {
                gpsHistory.shift();
            }
            
            // Trigger location update event (simulate GPS update)
            try {
                map.fire('locationfound', {
                    latlng: latLng,
                    accuracy: 10
                });
            } catch (e) {
                console.error('[Test] ❌ Error firing locationfound event:', e);
            }
            
            // CRITICAL: Call announceNextDirection to announce turn instructions
            // This ensures voice announcements work during simulation
            if (typeof announceNextDirection === 'function') {
                try {
                    announceNextDirection();
                } catch (e) {
                    console.error('[Test] ❌ Error in announceNextDirection:', e);
                }
            }
            
            // CRITICAL: Call updateRealTimeInstructions to remove passed turn markers
            // This ensures turn markers are removed when passed
            if (typeof updateRealTimeInstructions === 'function') {
                try {
                    updateRealTimeInstructions(latLng);
                } catch (e) {
                    console.error('[Test] ❌ Error in updateRealTimeInstructions:', e);
                }
            }
            
            // CRITICAL: Remove turn markers that have been passed
            // Check distance to each turn marker and remove if passed
            if (typeof turnMarkerData !== 'undefined' && turnMarkerData && turnMarkerData.length > 0) {
                const PASSED_MARKER_THRESHOLD = 30; // Remove marker if passed within 30m
                
                turnMarkerData.forEach(function(turnData, index) {
                    if (!turnData || !turnData.latLng || !turnData.marker) return;
                    
                    try {
                        const distanceToTurn = latLng.distanceTo(turnData.latLng);
                        
                        // Check if user has passed the turn marker
                        // If distance is very small (< 30m) and user is moving forward, remove marker
                        if (distanceToTurn < PASSED_MARKER_THRESHOLD) {
                            // Check if marker still exists on map
                            if (turnData.marker && map.hasLayer(turnData.marker)) {
                                console.log('[Test] 🗑️ Removing passed turn marker:', turnData.direction, 'at', Math.round(distanceToTurn), 'm');
                                
                                // Remove marker from map
                                map.removeLayer(turnData.marker);
                                
                                // Remove from arrays
                                const markerIndex = turnMarkers.indexOf(turnData.marker);
                                if (markerIndex > -1) {
                                    turnMarkers.splice(markerIndex, 1);
                                }
                                
                                // Remove from turnMarkerData
                                turnMarkerData.splice(index, 1);
                            }
                        }
                    } catch (e) {
                        console.error('[Test] ❌ Error checking turn marker:', e);
                    }
                });
            }
            
            // Also check turnMarkers array (fallback)
            if (typeof turnMarkers !== 'undefined' && turnMarkers && turnMarkers.length > 0) {
                const PASSED_MARKER_THRESHOLD = 30;
                
                for (let i = turnMarkers.length - 1; i >= 0; i--) {
                    const marker = turnMarkers[i];
                    if (!marker || !marker.getLatLng) continue;
                    
                    try {
                        const markerLatLng = marker.getLatLng();
                        const distanceToTurn = latLng.distanceTo(markerLatLng);
                        
                        if (distanceToTurn < PASSED_MARKER_THRESHOLD && map.hasLayer(marker)) {
                            console.log('[Test] 🗑️ Removing passed turn marker (fallback) at', Math.round(distanceToTurn), 'm');
                            map.removeLayer(marker);
                            turnMarkers.splice(i, 1);
                        }
                    } catch (e) {
                        console.error('[Test] ❌ Error checking turn marker (fallback):', e);
                    }
                }
            }
            
            // Move to next point
            self._currentRouteIndex++;
            
            // Log progress every 10 points
            if (self._currentRouteIndex % 10 === 0) {
                const progress = ((self._currentRouteIndex / self._routeCoordinates.length) * 100).toFixed(1);
                console.log('[Test] 📍 Progress:', progress + '%', `(${self._currentRouteIndex}/${self._routeCoordinates.length})`);
            }
        }, intervalMs);
        
        console.log('[Test] ✅ Simulation started!');
    },
    
    // Stop simulation
    stopSimulation: function() {
        if (this._simulationInterval) {
            clearInterval(this._simulationInterval);
            this._simulationInterval = null;
        }
        this._isSimulating = false;
        console.log('[Test] 🛑 Simulation stopped');
    },
    
    // Reset test state
    reset: function() {
        this.stopSimulation();
        this._routeCoordinates = null;
        this._currentRouteIndex = 0;
        console.log('[Test] 🔄 Test state reset');
    }
};

// Legacy function untuk backward compatibility
window.testNavigationLegacy = function(latOrName, lng, name) {
    console.log('[Test] 🧪 Starting navigation test...');
    console.log('[Test] 📊 Current state:', {
        hasUserPosition: !!currentUserPosition,
        isNavigating: isNavigating,
        hasRoute: !!route,
        hasDestination: !!latLngB
    });
    
    // Check if user position is available
    if (!currentUserPosition) {
        console.error('[Test] ❌ User position not available. Please wait for GPS to initialize.');
        console.log('[Test] 💡 Try: requestLocation() to get current location');
        return false;
    }
    
    const userLatLng = currentUserPosition.getLatLng();
    console.log('[Test] 📍 Current user position:', userLatLng.lat.toFixed(6), userLatLng.lng.toFixed(6));
    
    // Determine destination
    let destLat, destLng, destName;
    
    if (typeof latOrName === 'string') {
        // Test dengan nama kota
        console.log('[Test] 🔍 Testing with city name:', latOrName);
        destName = latOrName;
        // Use geocodeLocation to find coordinates
        geocodeLocation(latOrName, function(result) {
            if (result && result.lat && result.lng) {
                console.log('[Test] ✅ Found location:', result.name, result.lat, result.lng);
                updateDestination(result.lat, result.lng, result.name);
                // Wait a bit for route calculation, then start navigation
                setTimeout(function() {
                    if (route) {
                        console.log('[Test] 🚀 Starting navigation...');
                        startTurnByTurnNavigation();
                        console.log('[Test] ✅ Navigation test started!');
                    } else {
                        console.error('[Test] ❌ Route not calculated. Please try again.');
                    }
                }, 2000);
            } else {
                console.error('[Test] ❌ Location not found:', latOrName);
            }
        });
        return true;
    } else if (typeof latOrName === 'number' && typeof lng === 'number') {
        // Test dengan koordinat
        destLat = latOrName;
        destLng = lng;
        destName = name || `Test Destination (${destLat.toFixed(4)}, ${destLng.toFixed(4)})`;
        console.log('[Test] 📍 Testing with coordinates:', destLat, destLng, destName);
    } else {
        // Default test destination (Surakarta)
        destLat = -7.575;
        destLng = 110.824;
        destName = 'Surakarta (Test)';
        console.log('[Test] 📍 Using default test destination:', destName, destLat, destLng);
    }
    
    // Set destination
    console.log('[Test] 🎯 Setting destination:', destName);
    updateDestination(destLat, destLng, destName);
    
    // Wait for route calculation, then start navigation
    setTimeout(function() {
        if (route) {
            console.log('[Test] ✅ Route calculated successfully');
            console.log('[Test] 🚀 Starting navigation...');
            startTurnByTurnNavigation();
            console.log('[Test] ✅ Navigation test started!');
            console.log('[Test] 💡 Use stopNavigation() to stop navigation');
        } else {
            console.error('[Test] ❌ Route calculation failed or timed out');
            console.log('[Test] 💡 Try: testNavigation() again or check network connection');
        }
    }, 2000);
    
    return true;
};

// Helper function to stop navigation (for testing)
window.stopNavigation = function() {
    console.log('[Test] 🛑 Stopping navigation...');
    isNavigating = false;
    announcedInstructions = [];
    lastAnnouncedInstruction = null;
    
    // Release Wake Lock
    if (typeof releaseWakeLock === 'function') {
        releaseWakeLock();
    }
    
    // Remove navigating class
    document.body.classList.remove('navigating');
    document.documentElement.classList.remove('navigating');
    
    // Reset marker icon
    if (currentUserPosition) {
        const normalIcon = L.divIcon({
            className: 'custom-user-marker',
            html: '<div style="background: #007bff; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });
        currentUserPosition.setIcon(normalIcon);
    }
    
    // Clear turn markers
    if (typeof clearTurnMarkers === 'function') {
        clearTurnMarkers();
    }
    
    console.log('[Test] ✅ Navigation stopped');
};

// Test function untuk GPS tracking
window.testGPS = function() {
    console.log('[Test] 🧪 Testing GPS tracking...');
    console.log('[Test] 📊 GPS Status:', {
        hasPermission: hasPermission,
        currentUserPosition: currentUserPosition ? currentUserPosition.getLatLng() : null,
        watchPositionId: watchPositionId,
        isNavigating: isNavigating
    });
    
    if (currentUserPosition) {
        const pos = currentUserPosition.getLatLng();
        console.log('[Test] 📍 Current position:', pos.lat.toFixed(6), pos.lng.toFixed(6));
    } else {
        console.log('[Test] ⚠️ No GPS position available');
        console.log('[Test] 💡 Try: requestLocation() to get current location');
    }
    
    // Test GPS update
    if (typeof startLocationTracking === 'function') {
        console.log('[Test] 🔄 Restarting GPS tracking...');
        startLocationTracking();
        console.log('[Test] ✅ GPS tracking restarted');
    }
};

// Announce detailed route directions like Google Maps/Assistant
function announceRouteDirections(priority = false, onComplete = null) {
    if (!voiceDirectionsEnabled) {
        console.log('[Navigation] ⚠️ Voice directions disabled');
        if (onComplete) onComplete();
        return;
    }
    
    // CRITICAL: Request permission from SpeechCoordinator BEFORE attempting to speak
    if (typeof window.SpeechCoordinator !== 'undefined') {
        const canSpeak = window.SpeechCoordinator.requestSpeak('high');
        if (!canSpeak) {
            console.log('[Navigation] ⏸️ SpeechCoordinator blocked announcement - will retry');
            // Retry after a short delay
            setTimeout(function() {
                announceRouteDirections(priority, onComplete);
            }, 500);
            return;
        }
    }
    
    // Retry mechanism untuk menunggu DOM ready
    let retryCount = 0;
    const maxRetries = 10;
    
    function attemptAnnouncement() {
        // Find the routing control container
        const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
        if (!routingContainer && retryCount < maxRetries) {
            retryCount++;
            console.log('[Navigation] ⏳ Waiting for routing container... retry', retryCount);
            setTimeout(attemptAnnouncement, 300);
            return;
        }
        
        // Get the first (active) route
        const activeRoute = routingContainer ? routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)') : null;
        if (!activeRoute && retryCount < maxRetries) {
            retryCount++;
            console.log('[Navigation] ⏳ Waiting for active route... retry', retryCount);
            setTimeout(attemptAnnouncement, 300);
            return;
        }
        
        // Build announcement
        let announcement = '';
        
        if (activeRoute) {
            // Get h2 (nama jalan) and h3 (jarak dan waktu)
            const routeName = activeRoute.querySelector('h2'); // Nama jalan
            const routeInfo = activeRoute.querySelector('h3'); // Jarak dan waktu
            
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
        }
        
        // Fallback: gunakan lastRouteSummarySpeech jika DOM belum ready
        if (!announcement || announcement.trim() === '') {
            if (lastRouteSummarySpeech) {
                console.log('⚠️ No route data found in DOM - using stored summary');
                announcement = lastRouteSummarySpeech;
            } else {
                console.log('⚠️ No route data found - generating from currentDestinationName');
                // Generate announcement from available data
                const destinationName = currentDestinationName || 'tujuan Anda';
                announcement = 'Rute menuju ' + destinationName + '. Navigasi dimulai.';
            }
        }
        
        // Debug: log the announcement to be spoken
        console.log('[Navigation] 📢 Announcement to be spoken:');
        console.log('=========================================');
        console.log(announcement);
        console.log('=========================================');
        
        // Callback after announcement is done
        function afterRouteAnnouncement() {
            console.log('[Navigation] ✅ Route announcement completed');
            
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
        
        // CRITICAL: Pastikan announcement tidak kosong
        if (!announcement || announcement.trim() === '') {
            console.warn('[Navigation] ⚠️ Empty announcement in announceRouteDirections after retries');
            if (onComplete) onComplete();
            return;
        }
        
        console.log('[Navigation] 📢 Calling speakText for route announcement:', {
            announcement: announcement.substring(0, 100),
            fullLength: announcement.length,
            priority: priority,
            voiceDirectionsEnabled: voiceDirectionsEnabled,
            lastSpokenMessage: lastSpokenMessage,
            speechSynthesisSpeaking: window.speechSynthesis ? window.speechSynthesis.speaking : 'N/A',
            speechSynthesisPending: window.speechSynthesis ? window.speechSynthesis.pending : 'N/A'
        });
        
        // CRITICAL: Clear lastSpokenMessage SEBELUM memanggil speakText untuk memastikan announcement tidak di-skip
        const previousMessage = lastSpokenMessage;
        lastSpokenMessage = ''; // Clear untuk memastikan announcement tidak di-skip
        
        // CRITICAL: Pastikan speechSynthesis tidak sedang berbicara sebelum announcement route
        // Cancel any pending speech
        if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
            console.log('[Navigation] 🔄 Canceling existing speech before route announcement');
            window.speechSynthesis.cancel();
            // Wait a bit for cancel to complete
            setTimeout(function() {
                console.log('[Navigation] 🎯 Calling speakText after cancel delay');
                speakText(announcement, 'id-ID', true, afterRouteAnnouncement);
            }, 200);
        } else {
            console.log('[Navigation] 🎯 Calling speakText immediately (no speech active)');
            speakText(announcement, 'id-ID', true, afterRouteAnnouncement);
        }
    }
    
    // Start attempt
    attemptAnnouncement();
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

// Helper function to extract turn direction (kanan/kiri) from instruction text
// Enhanced to detect all types of turns (big roads, small roads, highways, etc.)
function extractTurnDirection(text) {
    if (!text) return null;
    
    const lowerText = text.toLowerCase();
    
    // Check for right turn patterns (comprehensive list)
    if (lowerText.includes('belok kanan') || 
        lowerText.includes('turn right') || 
        lowerText.includes('turn right onto') ||
        lowerText.includes('turn right to stay') ||
        (lowerText.includes('kanan') && (lowerText.includes('belok') || lowerText.includes('turn') || lowerText.includes('keep') || lowerText.includes('tetap'))) ||
        lowerText.includes('keep right') ||
        lowerText.includes('tetap kanan') ||
        lowerText.includes('tetap di kanan') ||
        lowerText.includes('merge right') ||
        lowerText.includes('bergabung kanan') ||
        lowerText.includes('slight right') ||
        lowerText.includes('sedikit ke kanan') ||
        lowerText.includes('make a slight right') ||
        lowerText.includes('take the ramp on the right') ||
        lowerText.includes('ambil jalan keluar kanan') ||
        lowerText.includes('exit right') ||
        lowerText.includes('keluar kanan')) {
        return 'kanan';
    }
    
    // Check for left turn patterns (comprehensive list)
    if (lowerText.includes('belok kiri') || 
        lowerText.includes('turn left') || 
        lowerText.includes('turn left onto') ||
        lowerText.includes('turn left to stay') ||
        (lowerText.includes('kiri') && (lowerText.includes('belok') || lowerText.includes('turn') || lowerText.includes('keep') || lowerText.includes('tetap'))) ||
        lowerText.includes('keep left') ||
        lowerText.includes('tetap kiri') ||
        lowerText.includes('tetap di kiri') ||
        lowerText.includes('merge left') ||
        lowerText.includes('bergabung kiri') ||
        lowerText.includes('slight left') ||
        lowerText.includes('sedikit ke kiri') ||
        lowerText.includes('make a slight left') ||
        lowerText.includes('take the ramp on the left') ||
        lowerText.includes('ambil jalan keluar kiri') ||
        lowerText.includes('exit left') ||
        lowerText.includes('keluar kiri')) {
        return 'kiri';
    }
    
    return null;
}

// Function to speak turn-by-turn directions based on user position (Google Maps style)
// IMPROVED: Uses route data with coordinates for accurate real-time distance calculation
function announceNextDirection() {
    if (!voiceDirectionsEnabled || !route || !isNavigating || !currentRouteData || !currentUserPosition) return;
    
    try {
        const userLatLng = currentUserPosition.getLatLng();
        if (!userLatLng) return;
        
        // CRITICAL: Use route data with coordinates for accurate distance calculation
        // This is more reliable than DOM-based distance
        if (!currentRouteData.instructions || !currentRouteData.instructions.length) {
            console.log('[Navigation] ⚠️ No route instructions available');
            return;
        }
        
        if (!currentRouteData.coordinates || !currentRouteData.coordinates.length) {
            console.log('[Navigation] ⚠️ No route coordinates available');
            return;
        }
        
        let closestTurn = null;
        let closestDistance = Infinity;
        let closestInstructionIndex = -1;
        
        // CRITICAL: Find the CLOSEST upcoming turn by calculating real-time distance from GPS
        // This ensures announcements happen when actually approaching the turn point
        console.log('[Navigation] 🔍 Checking', currentRouteData.instructions.length, 'instructions for turns...');
        
        for (let i = 0; i < currentRouteData.instructions.length; i++) {
            const instruction = currentRouteData.instructions[i];
            
            if (!instruction || !instruction.text) continue;
            
            const text = convertInstructionToNatural(instruction.text);
            
            // Skip if already announced
            if (!text || announcedInstructions.includes(text)) {
                continue;
            }
            
            // Skip generic instructions (departure/arrival)
            if (text.toLowerCase().includes('head') || 
                text.toLowerCase().includes('berangkat') ||
                text.toLowerCase().includes('arrived') ||
                text.toLowerCase().includes('tiba')) {
                continue;
            }
            
            // Skip "go straight" or "lurus terus" instructions (not turns)
            if (text.toLowerCase().includes('go straight') || 
                text.toLowerCase().includes('lurus terus') ||
                text.toLowerCase().includes('continue straight') ||
                text.toLowerCase().includes('lanjutkan')) {
                continue;
            }
            
            // Extract turn direction (kanan/kiri)
            const turnDirection = extractTurnDirection(text);
            
            // Only process turn instructions
            if (!turnDirection) {
                continue;
            }
            
            console.log('[Navigation] 📍 Found turn instruction', i, ':', text, 'Direction:', turnDirection);
            
            // CRITICAL: Calculate real-time distance from user GPS position to turn point
            // Find the coordinate for this instruction
            let instructionLatLng = null;
            
            // Try to get instruction coordinate from waypoint or index
            if (instruction.waypoint) {
                const waypoint = instruction.waypoint;
                if (Array.isArray(waypoint) && waypoint.length >= 2) {
                    instructionLatLng = L.latLng(waypoint[0], waypoint[1]);
                } else if (waypoint.lat !== undefined && waypoint.lng !== undefined) {
                    instructionLatLng = L.latLng(waypoint.lat, waypoint.lng);
                } else if (waypoint instanceof L.LatLng) {
                    instructionLatLng = waypoint;
                }
            }
            
            // If no waypoint, use instruction index to find coordinate in route
            if (!instructionLatLng && instruction.index !== undefined) {
                const coordIndex = instruction.index;
                if (coordIndex >= 0 && coordIndex < currentRouteData.coordinates.length) {
                    const coord = currentRouteData.coordinates[coordIndex];
                    if (Array.isArray(coord) && coord.length >= 2) {
                        instructionLatLng = L.latLng(coord[0], coord[1]);
                    } else if (coord.lat !== undefined && coord.lng !== undefined) {
                        instructionLatLng = L.latLng(coord.lat, coord.lng);
                    }
                }
            }
            
            // If still no coordinate, try to find nearest coordinate based on instruction distance
            if (!instructionLatLng && instruction.distance !== undefined && currentRouteData.coordinates) {
                // Calculate cumulative distance to find approximate coordinate
                let cumulativeDist = 0;
                for (let j = 0; j < currentRouteData.coordinates.length - 1; j++) {
                    const coord1 = currentRouteData.coordinates[j];
                    const coord2 = currentRouteData.coordinates[j + 1];
                    const lat1 = Array.isArray(coord1) ? coord1[0] : coord1.lat;
                    const lng1 = Array.isArray(coord1) ? coord1[1] : coord1.lng;
                    const lat2 = Array.isArray(coord2) ? coord2[0] : coord2.lat;
                    const lng2 = Array.isArray(coord2) ? coord2[1] : coord2.lng;
                    
                    const segmentDist = L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
                    cumulativeDist += segmentDist;
                    
                    if (cumulativeDist >= instruction.distance) {
                        instructionLatLng = L.latLng(lat2, lng2);
                        console.log('[Navigation] ✅ Found instruction coordinate from distance:', instructionLatLng.lat.toFixed(6), instructionLatLng.lng.toFixed(6));
                        break;
                    }
                }
            }
            
            // CRITICAL: If still no coordinate, use instruction index to find coordinate in route
            // Leaflet Routing Machine instructions have an index property that points to route coordinates
            if (!instructionLatLng && currentRouteData.coordinates && currentRouteData.coordinates.length > 0) {
                // Try to find coordinate by matching instruction index with route coordinate index
                // Instructions are usually in order, so we can use instruction index as approximate coordinate index
                let coordIndex = i; // Use instruction index as coordinate index
                
                // Ensure index is within bounds
                if (coordIndex >= 0 && coordIndex < currentRouteData.coordinates.length) {
                    const coord = currentRouteData.coordinates[coordIndex];
                    if (Array.isArray(coord) && coord.length >= 2) {
                        instructionLatLng = L.latLng(coord[0], coord[1]);
                        console.log('[Navigation] ✅ Found instruction coordinate from index:', coordIndex, instructionLatLng.lat.toFixed(6), instructionLatLng.lng.toFixed(6));
                    } else if (coord.lat !== undefined && coord.lng !== undefined) {
                        instructionLatLng = L.latLng(coord.lat, coord.lng);
                        console.log('[Navigation] ✅ Found instruction coordinate from index (object):', coordIndex, instructionLatLng.lat.toFixed(6), instructionLatLng.lng.toFixed(6));
                    }
                }
            }
            
            // Calculate real-time distance from user to turn point
            if (instructionLatLng) {
                const realTimeDistance = userLatLng.distanceTo(instructionLatLng);
                
                console.log('[Navigation] 📏 Turn', i, ':', text, '- Real-time distance:', realTimeDistance.toFixed(1), 'meters');
                
                // CRITICAL: Only consider turns within 200 meters (approaching the turn)
                if (realTimeDistance > 0 && realTimeDistance <= 200) {
                    // Find the closest turn that hasn't been announced
                    if (realTimeDistance < closestDistance) {
                        closestDistance = realTimeDistance;
                        closestTurn = {
                            text: text,
                            distance: realTimeDistance,
                            originalText: instruction.text,
                            instructionIndex: i
                        };
                        closestInstructionIndex = i;
                        console.log('[Navigation] ✅ Closest turn updated:', text, 'at', realTimeDistance.toFixed(1), 'meters');
                    }
                }
            } else {
                console.log('[Navigation] ⚠️ Turn', i, ':', text, '- No coordinate found, skipping');
            }
        }
        
        // CRITICAL: Check if user has passed the last announced turn
        if (lastAnnouncedInstruction) {
            // Find the last announced turn in route data
            for (let i = 0; i < currentRouteData.instructions.length; i++) {
                const instruction = currentRouteData.instructions[i];
                if (!instruction || !instruction.text) continue;
                
                const text = convertInstructionToNatural(instruction.text);
                if (text === lastAnnouncedInstruction) {
                    // Calculate distance to this turn
                    let instructionLatLng = null;
                    if (instruction.waypoint) {
                        const waypoint = instruction.waypoint;
                        if (Array.isArray(waypoint) && waypoint.length >= 2) {
                            instructionLatLng = L.latLng(waypoint[0], waypoint[1]);
                        } else if (waypoint.lat !== undefined && waypoint.lng !== undefined) {
                            instructionLatLng = L.latLng(waypoint.lat, waypoint.lng);
                        }
                    }
                    
                    if (instructionLatLng) {
                        const distanceToLastTurn = userLatLng.distanceTo(instructionLatLng);
                        // If user is very close (< 15m) or has passed (< 0m means behind), reset
                        if (distanceToLastTurn < 15) {
                            console.log('[Navigation] ✅ User passed last turn:', lastAnnouncedInstruction, 'Distance:', distanceToLastTurn.toFixed(1), 'm');
                            const lastIndex = announcedInstructions.indexOf(lastAnnouncedInstruction);
                            if (lastIndex > -1) {
                                announcedInstructions.splice(lastIndex, 1);
                            }
                            lastAnnouncedInstruction = null;
                        }
                    }
                    break;
                }
            }
        }
        
        // CRITICAL: Announce the closest turn when approaching (30-200 meters)
        if (closestTurn && closestTurn.distance > 0) {
            // Only announce if this is a new turn (not the same as last announced)
            if (closestTurn.text !== lastAnnouncedInstruction) {
                // CRITICAL: Announce when within 30-200 meters (approaching the turn)
                if (closestTurn.distance >= 30 && closestTurn.distance <= 200) {
                    lastAnnouncedInstruction = closestTurn.text;
                    if (!announcedInstructions.includes(closestTurn.text)) {
                        announcedInstructions.push(closestTurn.text);
                    }
                    
                    const turnInstruction = closestTurn.distance >= 30 
                        ? 'Setelah ' + Math.round(closestTurn.distance) + ' meter ' + closestTurn.text
                        : closestTurn.text + ' sekarang';
                    
                    console.log('[Navigation] 🔊 Announcing turn instruction:', turnInstruction, 'Real-time distance:', closestTurn.distance.toFixed(1), 'meters');
                    
                    // CRITICAL: Request permission from SpeechCoordinator dengan priority 'high'
                    if (typeof window.SpeechCoordinator !== 'undefined') {
                        const canSpeak = window.SpeechCoordinator.requestSpeak('high');
                        if (!canSpeak) {
                            console.warn('[Navigation] ⚠️ Turn announcement blocked by SpeechCoordinator, will retry...');
                            setTimeout(() => {
                                const retryCanSpeak = window.SpeechCoordinator.requestSpeak('high');
                                if (retryCanSpeak) {
                                    console.log('[Navigation] ✅ Retry successful, announcing turn instruction');
                                    speakText(turnInstruction, 'id-ID', true);
                                } else {
                                    console.warn('[Navigation] ⚠️ Retry failed, forcing announcement anyway (turn instructions are critical)');
                                    if (window.speechSynthesis.speaking) {
                                        window.speechSynthesis.cancel();
                                    }
                                    setTimeout(() => {
                                        speakText(turnInstruction, 'id-ID', true);
                                    }, 100);
                                }
                            }, 200);
                            return;
                        }
                    }
                    
                    // Announce the turn instruction
                    speakText(turnInstruction, 'id-ID', true);
                } else if (closestTurn.distance < 30 && closestTurn.distance > 0) {
                    // Very close to turn (< 30m) - announce immediately
                    lastAnnouncedInstruction = closestTurn.text;
                    if (!announcedInstructions.includes(closestTurn.text)) {
                        announcedInstructions.push(closestTurn.text);
                    }
                    
                    const turnInstruction = closestTurn.text + ' sekarang';
                    console.log('[Navigation] 🔊 Announcing turn instruction (very close):', turnInstruction, 'Real-time distance:', closestTurn.distance.toFixed(1), 'meters');
                    
                    if (typeof window.SpeechCoordinator !== 'undefined') {
                        const canSpeak = window.SpeechCoordinator.requestSpeak('high');
                        if (canSpeak) {
                            speakText(turnInstruction, 'id-ID', true);
                        }
                    } else {
                        speakText(turnInstruction, 'id-ID', true);
                    }
                }
            } else {
                // Same turn as last announced - check if user has passed it
                if (closestTurn.distance < 15) {
                    console.log('[Navigation] ✅ User passed turn:', closestTurn.text, 'Resetting for next turn');
                    lastAnnouncedInstruction = null;
                    const lastIndex = announcedInstructions.indexOf(closestTurn.text);
                    if (lastIndex > -1) {
                        announcedInstructions.splice(lastIndex, 1);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Navigation] ❌ Error in announceNextDirection:', error);
        console.error('[Navigation] Error stack:', error.stack);
    }
}

// Helper function: Deteksi arah belokan dari koordinat route
// Menghitung bearing/heading dari posisi user ke titik belokan untuk menentukan kiri/kanan
function detectTurnDirectionFromCoordinates(userLatLng, turnLatLng, prevLatLng) {
    if (!userLatLng || !turnLatLng) {
        return null;
    }
    
    try {
        // Hitung bearing dari user ke titik belokan
        const toRad = Math.PI / 180;
        const toDeg = 180 / Math.PI;
        
        const lat1 = userLatLng.lat * toRad;
        const lat2 = turnLatLng.lat * toRad;
        const dLon = (turnLatLng.lng - userLatLng.lng) * toRad;
        
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        
        let bearing = Math.atan2(y, x) * toDeg;
        bearing = (bearing + 360) % 360; // Normalize to 0-360
        
        // Jika ada koordinat sebelumnya, hitung bearing dari sebelumnya ke user
        if (prevLatLng) {
            const prevLat = prevLatLng.lat * toRad;
            const prevLon = (prevLatLng.lng - userLatLng.lng) * toRad;
            
            const prevY = Math.sin(prevLon) * Math.cos(lat1);
            const prevX = Math.cos(prevLat) * Math.sin(lat1) - Math.sin(prevLat) * Math.cos(lat1) * Math.cos(prevLon);
            
            let prevBearing = Math.atan2(prevY, prevX) * toDeg;
            prevBearing = (prevBearing + 360) % 360;
            
            // Hitung sudut belokan (bearing baru - bearing lama)
            let turnAngle = bearing - prevBearing;
            
            // Normalize turn angle to -180 to 180
            if (turnAngle > 180) turnAngle -= 360;
            if (turnAngle < -180) turnAngle += 360;
            
            // Jika belokan > 0 (kanan) atau < 0 (kiri)
            if (turnAngle > 15) {
                return 'Belok kanan';
            } else if (turnAngle < -15) {
                return 'Belok kiri';
            }
        }
        
        // Fallback: jika tidak ada koordinat sebelumnya, gunakan bearing saja
        // (kurang akurat tapi lebih baik daripada tidak ada)
        return null;
    } catch (error) {
        console.error('[Navigation] Error calculating turn direction:', error);
        return null;
    }
}

// Helper function: Extract "Belok kanan" atau "Belok kiri" dari instruction text dengan prioritas tinggi
// Fungsi ini memastikan bahwa "Belok kanan" atau "Belok kiri" selalu terdeteksi dengan jelas
// CRITICAL: Fungsi ini HARUS selalu return direction text untuk semua jenis belokan, tidak boleh return null
function extractTurnDirection(text, userLatLng, turnLatLng, prevLatLng) {
    if (!text) {
        console.log('[Navigation] ⚠️ extractTurnDirection: text is null/empty');
        return null;
    }
    
    const textLower = text.toLowerCase();
    let directionText = null;
    
    // PRIORITAS 1: Deteksi eksplisit "belok kanan" atau "belok kiri"
    if (textLower.includes('belok kanan') || textLower.includes('turn right')) {
        directionText = 'Belok kanan';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 1):', directionText);
        return directionText;
    } else if (textLower.includes('belok kiri') || textLower.includes('turn left')) {
        directionText = 'Belok kiri';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 1):', directionText);
        return directionText;
    }
    
    // PRIORITAS 2: Deteksi jenis belokan spesifik lainnya (SEBELUM deteksi umum)
    // Ini penting agar "Tetap di kiri" dan "Sedikit ke kiri" terdeteksi dengan benar
    if (textLower.includes('sedikit kanan') || textLower.includes('slight right')) {
        directionText = 'Sedikit ke kanan';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('sedikit kiri') || textLower.includes('slight left')) {
        directionText = 'Sedikit ke kiri';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('tetap kanan') || textLower.includes('keep right')) {
        directionText = 'Tetap di kanan';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('tetap kiri') || textLower.includes('keep left')) {
        directionText = 'Tetap di kiri';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('bergabung kanan') || textLower.includes('merge right')) {
        directionText = 'Bergabung ke kanan';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('bergabung kiri') || textLower.includes('merge left')) {
        directionText = 'Bergabung ke kiri';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('jalan keluar') || textLower.includes('ramp')) {
        if (textLower.includes('kanan') || textLower.includes('right')) {
            directionText = 'Ambil jalan keluar kanan';
        } else if (textLower.includes('kiri') || textLower.includes('left')) {
            directionText = 'Ambil jalan keluar kiri';
        } else {
            directionText = 'Ambil jalan keluar';
        }
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('persimpangan') || textLower.includes('fork')) {
        if (textLower.includes('kanan') || textLower.includes('right')) {
            directionText = 'Tetap kanan di persimpangan';
        } else if (textLower.includes('kiri') || textLower.includes('left')) {
            directionText = 'Tetap kiri di persimpangan';
        } else {
            directionText = 'Di persimpangan';
        }
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('bundaran') || textLower.includes('circle')) {
        directionText = 'Masuk bundaran';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    } else if (textLower.includes('u-turn') || textLower.includes('putar balik') || textLower.includes('buat u-turn')) {
        directionText = 'Putar balik';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 2):', directionText);
        return directionText;
    }
    
    // PRIORITAS 3: Deteksi dari kata "kanan" atau "kiri" umum (setelah cek jenis spesifik)
    if (textLower.includes('kanan') || textLower.includes('right')) {
        directionText = 'Belok kanan';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 3):', directionText);
        return directionText;
    } else if (textLower.includes('kiri') || textLower.includes('left')) {
        directionText = 'Belok kiri';
        console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 3):', directionText);
        return directionText;
    }
    
    // PRIORITAS 4: Hitung dari koordinat jika text tidak jelas
    if (userLatLng && turnLatLng) {
        const calculatedDirection = detectTurnDirectionFromCoordinates(userLatLng, turnLatLng, prevLatLng);
        if (calculatedDirection) {
            console.log('[Navigation] ✅ Deteksi arah belokan (PRIORITAS 4 - koordinat):', calculatedDirection);
            return calculatedDirection;
        }
    }
    
    // Fallback: jika tidak jelas sama sekali, return null (akan di-skip)
    console.log('[Navigation] ⚠️ Tidak dapat mendeteksi arah belokan dari:', text);
    return null;
}

// Fallback function to announce from route data if DOM is not available
// FUNGSI INI LEBIH RELIABLE karena menghitung jarak secara manual
function announceFromRouteData() {
    console.log('[Navigation] 🔍 announceFromRouteData called - checking conditions...');
    
    if (!voiceDirectionsEnabled) {
        console.log('[Navigation] ⚠️ announceFromRouteData skipped: voiceDirectionsEnabled = false');
        console.log('[Navigation] 💡 Setting voiceDirectionsEnabled = true...');
        voiceDirectionsEnabled = true;
        // Continue instead of return
    }
    if (!isNavigating) {
        console.log('[Navigation] ⚠️ announceFromRouteData skipped: isNavigating = false');
        console.log('[Navigation] 💡 Setting isNavigating = true...');
        isNavigating = true;
        // Continue instead of return
    }
    if (!currentRouteData || !currentRouteData.instructions || !currentRouteData.instructions.length) {
        console.log('[Navigation] ⚠️ announceFromRouteData skipped: currentRouteData tidak valid');
        console.log('[Navigation] 📊 currentRouteData:', {
            exists: currentRouteData !== null,
            hasInstructions: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
        });
        return;
    }
    
    if (!currentUserPosition) {
        console.log('[Navigation] ⚠️ announceFromRouteData skipped: currentUserPosition = null');
        return;
    }
    
    // CRITICAL: Pastikan hasUserInteraction = true
    if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
        console.log('[Navigation] 💡 Setting hasUserInteraction = true...');
        hasUserInteraction = true;
    }
    
    console.log('[Navigation] ✅ announceFromRouteData conditions met, proceeding...');
    console.log('[Navigation] 📊 State:', {
        voiceDirectionsEnabled,
        isNavigating,
        hasRouteData: currentRouteData !== null,
        instructionsCount: currentRouteData.instructions.length,
        hasUserPosition: currentUserPosition !== null,
        hasUserInteraction: typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : 'undefined'
    });
    
    const userLatLng = currentUserPosition.getLatLng();
    
    // Find next turn instruction and calculate distance manually
    for (let i = 0; i < Math.min(10, currentRouteData.instructions.length); i++) {
        const instruction = currentRouteData.instructions[i];
        
        if (!instruction || !instruction.text) continue;
        
        const text = convertInstructionToNatural(instruction.text);
        
        // Skip if already announced
        if (!text || text === lastAnnouncedInstruction || announcedInstructions.includes(text)) {
            continue;
        }
        
        // Skip generic instructions
        if (text.toLowerCase().includes('head') || text.toLowerCase().includes('berangkat')) {
            continue;
        }
        
        // Check if it's a turn instruction
        const hasTurn = text.toLowerCase().includes('belok') || 
                       text.toLowerCase().includes('turn') ||
                       text.toLowerCase().includes('kiri') ||
                       text.toLowerCase().includes('kanan') ||
                       text.toLowerCase().includes('left') ||
                       text.toLowerCase().includes('right');
        
        if (!hasTurn) {
            continue;
        }
        
        // Calculate distance to this instruction point manually
        let instructionLatLng = null;
        
        // Try to get instruction coordinate
        if (instruction.waypoint) {
            const waypoint = instruction.waypoint;
            if (Array.isArray(waypoint)) {
                instructionLatLng = L.latLng(waypoint[0], waypoint[1]);
            } else if (waypoint.lat !== undefined && waypoint.lng !== undefined) {
                instructionLatLng = L.latLng(waypoint.lat, waypoint.lng);
            } else if (waypoint instanceof L.LatLng) {
                instructionLatLng = waypoint;
            }
        } else if (instruction.coordinate) {
            const coord = instruction.coordinate;
            if (Array.isArray(coord)) {
                instructionLatLng = L.latLng(coord[0], coord[1]);
            } else if (coord.lat !== undefined && coord.lng !== undefined) {
                instructionLatLng = L.latLng(coord.lat, coord.lng);
            } else if (coord instanceof L.LatLng) {
                instructionLatLng = coord;
            }
        } else if (instruction.index !== undefined && currentRouteData.coordinates && currentRouteData.coordinates[instruction.index]) {
            const coord = currentRouteData.coordinates[instruction.index];
            if (Array.isArray(coord)) {
                instructionLatLng = L.latLng(coord[0], coord[1]);
            } else if (coord.lat !== undefined && coord.lng !== undefined) {
                instructionLatLng = L.latLng(coord.lat, coord.lng);
            } else if (coord instanceof L.LatLng) {
                instructionLatLng = coord;
            }
        }
        
        // If we have instruction coordinate, calculate distance
        if (instructionLatLng) {
            const distance = userLatLng.distanceTo(instructionLatLng); // Distance in meters
            
            console.log('[Navigation] 📏 Instruction', i, ':', text, '- Distance:', Math.round(distance), 'meters');
            
            // Announce if within 200 meters
            if (distance <= 200 && distance > 0) {
                // Dapatkan koordinat sebelumnya untuk perhitungan arah belokan
                let prevLatLng = null;
                if (i > 0 && currentRouteData.instructions[i - 1]) {
                    const prevInstruction = currentRouteData.instructions[i - 1];
                    if (prevInstruction.waypoint) {
                        const waypoint = prevInstruction.waypoint;
                        if (Array.isArray(waypoint)) {
                            prevLatLng = L.latLng(waypoint[0], waypoint[1]);
                        } else if (waypoint.lat !== undefined && waypoint.lng !== undefined) {
                            prevLatLng = L.latLng(waypoint.lat, waypoint.lng);
                        } else if (waypoint instanceof L.LatLng) {
                            prevLatLng = waypoint;
                        }
                    } else if (prevInstruction.coordinate) {
                        const coord = prevInstruction.coordinate;
                        if (Array.isArray(coord)) {
                            prevLatLng = L.latLng(coord[0], coord[1]);
                        } else if (coord.lat !== undefined && coord.lng !== undefined) {
                            prevLatLng = L.latLng(coord.lat, coord.lng);
                        } else if (coord instanceof L.LatLng) {
                            prevLatLng = coord;
                        }
                    } else if (prevInstruction.index !== undefined && currentRouteData.coordinates && currentRouteData.coordinates[prevInstruction.index]) {
                        const coord = currentRouteData.coordinates[prevInstruction.index];
                        if (Array.isArray(coord)) {
                            prevLatLng = L.latLng(coord[0], coord[1]);
                        } else if (coord.lat !== undefined && coord.lng !== undefined) {
                            prevLatLng = L.latLng(coord.lat, coord.lng);
                        } else if (coord instanceof L.LatLng) {
                            prevLatLng = coord;
                        }
                    }
                }
                
                // Extract direction menggunakan fungsi helper yang lebih kuat
                // Fungsi ini akan mendeteksi "Belok kanan" atau "Belok kiri" dengan prioritas tinggi
                console.log('[Navigation] 🔍 Mencoba extractTurnDirection (from route data) untuk:', text);
                const directionText = extractTurnDirection(text, userLatLng, instructionLatLng, prevLatLng);
                
                // Jika tidak dapat mendeteksi arah belokan, skip instruction ini
                if (!directionText) {
                    console.log('[Navigation] ⚠️ Tidak dapat mendeteksi arah belokan, skipping:', text);
                    console.log('[Navigation] 💡 Text yang tidak terdeteksi mungkin bukan belokan atau format tidak dikenal');
                    continue;
                }
                
                console.log('[Navigation] ✅ Direction text berhasil diekstrak (from route data):', directionText);
                
                // Announce dengan format yang lebih jelas: "Belok kanan" atau "Belok kiri"
                // PRIORITAS: Pastikan "Belok kanan" atau "Belok kiri" selalu disebutkan dengan jelas
                let turnInstruction = '';
                
                if (distance > 50) {
                    // Jarak masih jauh: "Setelah X meter Belok kanan/kiri"
                    turnInstruction = 'Setelah ' + Math.round(distance) + ' meter ' + directionText;
                } else if (distance >= 2) {
                    // Jarak sedang: "Setelah X meter Belok kanan/kiri"
                    turnInstruction = 'Setelah ' + Math.round(distance) + ' meter ' + directionText;
                } else {
                    // Jarak sangat dekat: "Belok kanan/kiri sekarang"
                    turnInstruction = directionText + ' sekarang';
                }
                
                console.log('🔊 🔊 🔊 [NAVIGATION] MENGUMUMKAN BELOKAN (from route data): 🔊 🔊 🔊');
                console.log('   📍 Text:', turnInstruction);
                console.log('   📏 Jarak:', Math.round(distance), 'meter');
                console.log('   ✅ Navigator akan berbicara sekarang!');
                
                // CRITICAL: Pastikan hasUserInteraction = true sebelum speak
                if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
                    console.log('[Navigation] 🔧 Setting hasUserInteraction = true (di announceFromRouteData)');
                    hasUserInteraction = true;
                }
                
                // CRITICAL: Pastikan voiceDirectionsEnabled = true
                if (typeof voiceDirectionsEnabled !== 'undefined' && !voiceDirectionsEnabled) {
                    console.log('[Navigation] 🔧 Setting voiceDirectionsEnabled = true (di announceFromRouteData)');
                    voiceDirectionsEnabled = true;
                }
                
                // Pastikan text tidak kosong
                if (!turnInstruction || turnInstruction.trim() === '') {
                    console.warn('[Navigation] ⚠️ Empty turn instruction, skipping');
                    continue;
                }
                
                lastAnnouncedInstruction = text;
                announcedInstructions.push(text);
                
                updateVoiceStatus('🔊 ' + turnInstruction);
                
                const timestamp = new Date().toLocaleTimeString('id-ID');
                console.log(`[${timestamp}] 🔊 🔊 🔊 NAVIGATOR BERBICARA: "${turnInstruction}" 🔊 🔊 🔊`);
                
                // CRITICAL: Pastikan hasUserInteraction = true sebelum speak
                if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
                    console.log('[Navigation] 🔧 Setting hasUserInteraction = true untuk announcement (from route data)');
                    hasUserInteraction = true;
                }
                
                // CRITICAL: Pastikan voiceDirectionsEnabled = true
                if (typeof voiceDirectionsEnabled !== 'undefined' && !voiceDirectionsEnabled) {
                    console.log('[Navigation] 🔧 Setting voiceDirectionsEnabled = true untuk announcement (from route data)');
                    voiceDirectionsEnabled = true;
                }
                
                // CRITICAL: Panggil speakText dengan priority = true untuk memastikan suara muncul
                speakText(turnInstruction, 'id-ID', true, function() {
                    console.log('✅ [NAVIGATION] Selesai mengumumkan belokan:', turnInstruction);
                    updateVoiceStatus('✅ ' + turnInstruction + ' (selesai)');
                });
                
                break; // Only announce one at a time
            }
        } else {
            // Fallback: use instruction.distance if available
            const distance = instruction.distance || 0;
            if (distance > 0 && distance <= 200) {
                // Extract direction menggunakan fungsi helper yang lebih kuat
                const directionText = extractTurnDirection(text, userLatLng, null, null);
                
                // Jika tidak dapat mendeteksi arah belokan, skip instruction ini
                if (!directionText) {
                    console.log('[Navigation] ⚠️ Tidak dapat mendeteksi arah belokan (fallback), skipping:', text);
                    continue;
                }
                
                // Announce dengan format yang lebih jelas: "Belok kanan" atau "Belok kiri"
                let turnInstruction = '';
                
                if (distance > 50) {
                    turnInstruction = 'Setelah ' + Math.round(distance) + ' meter ' + directionText;
                } else if (distance >= 2) {
                    turnInstruction = 'Setelah ' + Math.round(distance) + ' meter ' + directionText;
                } else {
                    turnInstruction = directionText + ' sekarang';
                }
                
                console.log('🔊 🔊 🔊 [NAVIGATION] MENGUMUMKAN BELOKAN (from route data - fallback): 🔊 🔊 🔊');
                console.log('   📍 Text:', turnInstruction);
                console.log('   📏 Jarak:', Math.round(distance), 'meters');
                
                lastAnnouncedInstruction = text;
                announcedInstructions.push(text);
                
                updateVoiceStatus('🔊 ' + turnInstruction);
                
                const timestamp = new Date().toLocaleTimeString('id-ID');
                console.log(`[${timestamp}] 🔊 🔊 🔊 NAVIGATOR BERBICARA: "${turnInstruction}" 🔊 🔊 🔊`);
                
                speakText(turnInstruction, 'id-ID', true, function() {
                    console.log('✅ [NAVIGATION] Selesai mengumumkan belokan:', turnInstruction);
                    updateVoiceStatus('✅ ' + turnInstruction + ' (selesai)');
                });
                
                break;
            }
        }
    }
}


// Function to create turn markers for all turns in the route
function createTurnMarkers(routeData) {
    // Clear existing turn markers first
    clearTurnMarkers();
    
    if (!routeData || !routeData.instructions || !routeData.instructions.length) {
        console.log('[Navigation] ⚠️ No route instructions available for turn markers');
        return;
    }
    
    console.log('[Navigation] 📍 Creating turn markers for', routeData.instructions.length, 'instructions');
    
    // Iterate through instructions and create markers for turns
    routeData.instructions.forEach(function(instruction, index) {
        if (!instruction || !instruction.text) return;
        
        // Check if this is a turn instruction (SEMUA JENIS BELOKAN)
        const text = convertInstructionToNatural(instruction.text);
        const textLower = text.toLowerCase();
        
        // Deteksi SEMUA jenis belokan:
        // - Turn left/right (belok kiri/kanan)
        // - Slight left/right (sedikit ke kiri/kanan)
        // - Keep left/right (tetap di kiri/kanan)
        // - Merge left/right (bergabung kiri/kanan)
        // - Take ramp (ambil jalan keluar)
        // - Fork (persimpangan)
        // - Traffic circle (bundaran)
        const hasTurn = textLower.includes('belok') || 
                       textLower.includes('turn') ||
                       textLower.includes('kiri') ||
                       textLower.includes('kanan') ||
                       textLower.includes('left') ||
                       textLower.includes('right') ||
                       textLower.includes('slight') ||
                       textLower.includes('sedikit') ||
                       textLower.includes('keep') ||
                       textLower.includes('tetap') ||
                       textLower.includes('merge') ||
                       textLower.includes('bergabung') ||
                       textLower.includes('ramp') ||
                       textLower.includes('jalan keluar') ||
                       textLower.includes('fork') ||
                       textLower.includes('persimpangan') ||
                       textLower.includes('circle') ||
                       textLower.includes('bundaran') ||
                       textLower.includes('exit') ||
                       textLower.includes('keluar');
        
        // Skip non-turn instructions (head, go straight, continue straight, dll)
        const isStraight = textLower.includes('head') || 
                          textLower.includes('berangkat') ||
                          textLower.includes('go straight') ||
                          textLower.includes('lurus terus') ||
                          textLower.includes('continue straight') ||
                          textLower.includes('continue onto') && !textLower.includes('turn') && !textLower.includes('belok');
        
        if (!hasTurn || isStraight) {
            return;
        }
        
        // Get coordinates for this turn point
        // Leaflet Routing Machine stores coordinates in different ways
        let turnLatLng = null;
        
        // Method 1: Try instruction.waypoint (most reliable for Leaflet Routing Machine)
        if (instruction.waypoint) {
            const waypoint = instruction.waypoint;
            if (Array.isArray(waypoint)) {
                turnLatLng = L.latLng(waypoint[0], waypoint[1]);
            } else if (waypoint.lat !== undefined && waypoint.lng !== undefined) {
                turnLatLng = L.latLng(waypoint.lat, waypoint.lng);
            } else if (waypoint instanceof L.LatLng) {
                turnLatLng = waypoint;
            }
        }
        
        // Method 2: Try instruction.coordinate
        if (!turnLatLng && instruction.coordinate) {
            const coord = instruction.coordinate;
            if (Array.isArray(coord)) {
                turnLatLng = L.latLng(coord[0], coord[1]);
            } else if (coord.lat !== undefined && coord.lng !== undefined) {
                turnLatLng = L.latLng(coord.lat, coord.lng);
            } else if (coord instanceof L.LatLng) {
                turnLatLng = coord;
            }
        }
        
        // Method 3: Try instruction.index with routeData.coordinates
        if (!turnLatLng && instruction.index !== undefined && routeData.coordinates && routeData.coordinates[instruction.index]) {
            const turnCoord = routeData.coordinates[instruction.index];
            if (Array.isArray(turnCoord)) {
                turnLatLng = L.latLng(turnCoord[0], turnCoord[1]);
            } else if (turnCoord.lat !== undefined && turnCoord.lng !== undefined) {
                turnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
            } else if (turnCoord instanceof L.LatLng) {
                turnLatLng = turnCoord;
            }
        }
        
        // Method 4: Fallback - use coordinate index based on instruction index
        if (!turnLatLng && routeData.coordinates && routeData.coordinates.length > 0) {
            // Calculate approximate coordinate index
            // Instructions are usually spaced along the route coordinates
            const totalInstructions = routeData.instructions.length;
            const totalCoordinates = routeData.coordinates.length;
            const coordIndex = Math.floor((index / totalInstructions) * totalCoordinates);
            const safeIndex = Math.min(Math.max(coordIndex, 0), totalCoordinates - 1);
            
            if (routeData.coordinates[safeIndex]) {
                const turnCoord = routeData.coordinates[safeIndex];
                if (Array.isArray(turnCoord)) {
                    turnLatLng = L.latLng(turnCoord[0], turnCoord[1]);
                } else if (turnCoord.lat !== undefined && turnCoord.lng !== undefined) {
                    turnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
                } else if (turnCoord instanceof L.LatLng) {
                    turnLatLng = turnCoord;
                }
            }
        }
        
        // Only create marker if we have valid coordinates
        if (turnLatLng) {
            
            // Determine icon color and text based on direction (SEMUA JENIS BELOKAN)
            const textLower = text.toLowerCase();
            let iconColor = '#ff6b6b'; // Default red
            let iconText = '↻'; // Default turn icon
            
            // Deteksi arah belokan (kanan atau kiri)
            const isRight = textLower.includes('kanan') || 
                           textLower.includes('right') ||
                           (textLower.includes('keep right') || textLower.includes('tetap kanan')) ||
                           (textLower.includes('merge right') || textLower.includes('bergabung kanan')) ||
                           (textLower.includes('ramp') && textLower.includes('right')) ||
                           (textLower.includes('slight right') || textLower.includes('sedikit kanan'));
            
            const isLeft = textLower.includes('kiri') || 
                          textLower.includes('left') ||
                          (textLower.includes('keep left') || textLower.includes('tetap kiri')) ||
                          (textLower.includes('merge left') || textLower.includes('bergabung kiri')) ||
                          (textLower.includes('ramp') && textLower.includes('left')) ||
                          (textLower.includes('slight left') || textLower.includes('sedikit kiri'));
            
            // Special icons untuk jenis belokan tertentu
            if (textLower.includes('fork') || textLower.includes('persimpangan')) {
                iconText = '⚡'; // Fork icon
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('circle') || textLower.includes('bundaran')) {
                iconText = '⭕'; // Circle icon
                iconColor = '#fbbf24'; // Yellow for roundabout
            } else if (textLower.includes('ramp') || textLower.includes('jalan keluar')) {
                iconText = '⬇️'; // Ramp icon
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('slight') || textLower.includes('sedikit')) {
                iconText = isRight ? '↗️' : '↖️'; // Slight turn icon
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Lighter colors for slight turns
            } else if (textLower.includes('keep') || textLower.includes('tetap')) {
                iconText = isRight ? '→' : '←'; // Keep direction icon
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('merge') || textLower.includes('bergabung')) {
                iconText = isRight ? '⇉' : '⇇'; // Merge icon
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else {
                // Standard turn
                if (isRight) {
                    iconColor = '#4ecdc4'; // Teal for right turn
                    iconText = '↻';
                } else if (isLeft) {
                    iconColor = '#ff6b6b'; // Red for left turn
                    iconText = '↺';
                }
            }
            
            // Create custom icon for turn marker
            const turnIcon = L.divIcon({
                className: 'turn-marker-icon',
                html: '<div style="background-color: ' + iconColor + '; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">' + iconText + '</div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            
            // Create marker at turn point
            const turnMarker = L.marker(turnLatLng, {
                icon: turnIcon,
                zIndexOffset: 1000 // Ensure markers appear above route line
            }).addTo(map);
            
            // Add popup with turn instruction
            turnMarker.bindPopup('<strong>📍 Belokan</strong><br>' + text);
            
            // Store marker dengan metadata
            turnMarkers.push({
                marker: turnMarker,
                latlng: turnLatLng,
                instruction: text,
                passed: false,
                index: turnMarkers.length
            });
            console.log('[Navigation] ✅ Created turn marker #' + (turnMarkers.length) + ' at:', turnLatLng.lat.toFixed(6) + ', ' + turnLatLng.lng.toFixed(6), '-', text);
        }
    });
    
    // Reset next turn marker index
    nextTurnMarkerIndex = 0;
    
    // Highlight marker belokan pertama (jika ada)
    if (turnMarkers.length > 0) {
        highlightNextTurnMarker();
    }
    
    console.log('[Navigation] ✅ Created', turnMarkers.length, 'turn markers total');
}

// Function to clear all turn markers
function clearTurnMarkers() {
    // Ensure turnMarkers is defined
    if (typeof turnMarkers === 'undefined') {
        turnMarkers = [];
    }
    
    turnMarkers.forEach(function(turnMarkerData) {
        if (turnMarkerData && turnMarkerData.marker) {
            map.removeLayer(turnMarkerData.marker);
        }
    });
    turnMarkers = [];
    nextTurnMarkerIndex = 0;
    console.log('[Navigation] ✅ Cleared all turn markers');
}

// Function to update turn markers based on user position
// Hapus marker yang sudah dilewati dan highlight marker berikutnya
function updateTurnMarkers(userLatLng) {
    if (!isNavigating || !userLatLng || turnMarkers.length === 0) {
        return;
    }
    
    // Check each turn marker
    turnMarkers.forEach(function(turnMarkerData, index) {
        if (turnMarkerData.passed) {
            return; // Skip marker yang sudah dilewati
        }
        
        const distance = userLatLng.distanceTo(turnMarkerData.latlng);
        
        // Jika user sudah melewati belokan (jarak < 50 meter), hapus marker
        if (distance < 50) {
            console.log('[Navigation] ✅ User passed turn marker #' + (index + 1) + ' - removing');
            
            // Hapus marker dari map
            map.removeLayer(turnMarkerData.marker);
            
            // Mark as passed
            turnMarkerData.passed = true;
            
            // Update next turn marker index
            if (index === nextTurnMarkerIndex) {
                nextTurnMarkerIndex = index + 1;
            }
        }
    });
    
    // Highlight marker belokan berikutnya (update visual)
    highlightNextTurnMarker();
}

// Function to highlight next turn marker (make it more visible)
function highlightNextTurnMarker() {
    // Reset all markers to normal size
    turnMarkers.forEach(function(turnMarkerData) {
        if (!turnMarkerData.passed && turnMarkerData.marker) {
            const text = turnMarkerData.instruction;
            const textLower = text.toLowerCase();
            let iconColor = '#ff6b6b';
            let iconText = '↻';
            
            // Deteksi arah dan jenis belokan (sama seperti createTurnMarkers)
            const isRight = textLower.includes('kanan') || textLower.includes('right') ||
                          (textLower.includes('keep right') || textLower.includes('tetap kanan')) ||
                          (textLower.includes('merge right') || textLower.includes('bergabung kanan')) ||
                          (textLower.includes('slight right') || textLower.includes('sedikit kanan'));
            
            const isLeft = textLower.includes('kiri') || textLower.includes('left') ||
                          (textLower.includes('keep left') || textLower.includes('tetap kiri')) ||
                          (textLower.includes('merge left') || textLower.includes('bergabung kiri')) ||
                          (textLower.includes('slight left') || textLower.includes('sedikit kiri'));
            
            // Special icons untuk jenis belokan tertentu
            if (textLower.includes('fork') || textLower.includes('persimpangan')) {
                iconText = '⚡';
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('circle') || textLower.includes('bundaran')) {
                iconText = '⭕';
                iconColor = '#fbbf24';
            } else if (textLower.includes('ramp') || textLower.includes('jalan keluar')) {
                iconText = '⬇️';
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('slight') || textLower.includes('sedikit')) {
                iconText = isRight ? '↗️' : '↖️';
                iconColor = isRight ? '#2dd4bf' : '#f87171';
            } else if (textLower.includes('keep') || textLower.includes('tetap')) {
                iconText = isRight ? '→' : '←';
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else if (textLower.includes('merge') || textLower.includes('bergabung')) {
                iconText = isRight ? '⇉' : '⇇';
                iconColor = isRight ? '#4ecdc4' : '#ff6b6b';
            } else {
                // Standard turn
                if (isRight) {
                    iconColor = '#4ecdc4';
                    iconText = '↻';
                } else if (isLeft) {
                    iconColor = '#ff6b6b';
                    iconText = '↺';
                }
            }
            
            // Normal size icon
            const normalIcon = L.divIcon({
                className: 'turn-marker-icon',
                html: '<div style="background-color: ' + iconColor + '; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">' + iconText + '</div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            
            turnMarkerData.marker.setIcon(normalIcon);
        }
    });
    
    // Highlight next turn marker (make it bigger and brighter)
    if (nextTurnMarkerIndex < turnMarkers.length) {
        const nextTurnMarkerData = turnMarkers[nextTurnMarkerIndex];
        
        if (!nextTurnMarkerData.passed && nextTurnMarkerData.marker) {
            const text = nextTurnMarkerData.instruction;
            const textLower = text.toLowerCase();
            let iconColor = '#ff6b6b';
            let iconText = '↻';
            
            // Deteksi arah dan jenis belokan (sama seperti createTurnMarkers)
            const isRight = textLower.includes('kanan') || textLower.includes('right') ||
                          (textLower.includes('keep right') || textLower.includes('tetap kanan')) ||
                          (textLower.includes('merge right') || textLower.includes('bergabung kanan')) ||
                          (textLower.includes('slight right') || textLower.includes('sedikit kanan'));
            
            const isLeft = textLower.includes('kiri') || textLower.includes('left') ||
                          (textLower.includes('keep left') || textLower.includes('tetap kiri')) ||
                          (textLower.includes('merge left') || textLower.includes('bergabung kiri')) ||
                          (textLower.includes('slight left') || textLower.includes('sedikit kiri'));
            
            // Special icons untuk jenis belokan tertentu (highlighted version)
            if (textLower.includes('fork') || textLower.includes('persimpangan')) {
                iconText = '⚡';
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Brighter colors
            } else if (textLower.includes('circle') || textLower.includes('bundaran')) {
                iconText = '⭕';
                iconColor = '#fbbf24'; // Yellow
            } else if (textLower.includes('ramp') || textLower.includes('jalan keluar')) {
                iconText = '⬇️';
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Brighter colors
            } else if (textLower.includes('slight') || textLower.includes('sedikit')) {
                iconText = isRight ? '↗️' : '↖️';
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Brighter colors
            } else if (textLower.includes('keep') || textLower.includes('tetap')) {
                iconText = isRight ? '→' : '←';
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Brighter colors
            } else if (textLower.includes('merge') || textLower.includes('bergabung')) {
                iconText = isRight ? '⇉' : '⇇';
                iconColor = isRight ? '#2dd4bf' : '#f87171'; // Brighter colors
            } else {
                // Standard turn (highlighted)
                if (isRight) {
                    iconColor = '#2dd4bf'; // Brighter teal
                    iconText = '↻';
                } else if (isLeft) {
                    iconColor = '#f87171'; // Brighter red
                    iconText = '↺';
                }
            }
            
            // Larger, brighter icon for next turn
            const highlightIcon = L.divIcon({
                className: 'turn-marker-icon turn-marker-next',
                html: '<div style="background-color: ' + iconColor + '; width: 32px; height: 32px; border-radius: 50%; border: 4px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 18px;">' + iconText + '</div>',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });
            
            nextTurnMarkerData.marker.setIcon(highlightIcon);
            console.log('[Navigation] 🎯 Highlighted next turn marker #' + (nextTurnMarkerIndex + 1) + ':', text);
        }
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

// Function to create markers on all turns in the route
// IMPROVED: Uses DOM routing directions to get accurate turn coordinates
function createTurnMarkers(routeData) {
    // Remove existing turn markers
    clearTurnMarkers();
    
    if (!routeData || !routeData.instructions || !routeData.coordinates) {
        console.log('⚠️ No route data available for turn markers');
        return;
    }
    
    console.log('📍 Creating turn markers for', routeData.instructions.length, 'instructions');
    
    // Get route coordinates
    const routeCoords = routeData.coordinates;
    if (!routeCoords || routeCoords.length === 0) {
        console.log('⚠️ No route coordinates available');
        return;
    }
    
    // IMPROVED: Use routing directions from DOM to get accurate turn points
    // Try multiple times with retry mechanism
    let retryCount = 0;
    const maxRetries = 3;
    
    function tryCreateMarkers() {
        const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
        if (!routingContainer) {
            if (retryCount < maxRetries) {
                retryCount++;
                console.log(`⏳ Routing container not found, retrying... (${retryCount}/${maxRetries})`);
                setTimeout(tryCreateMarkers, 300);
                return;
            }
            console.log('⚠️ Routing container not found after retries, using fallback method');
            createTurnMarkersFallback(routeData, routeCoords);
            return;
        }
        
        const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
        if (!activeRoute) {
            if (retryCount < maxRetries) {
                retryCount++;
                console.log(`⏳ Active route not found, retrying... (${retryCount}/${maxRetries})`);
                setTimeout(tryCreateMarkers, 300);
                return;
            }
            console.log('⚠️ Active route not found after retries, using fallback method');
            createTurnMarkersFallback(routeData, routeCoords);
            return;
        }
        
        const instructionRows = activeRoute.querySelectorAll('tbody tr');
        if (!instructionRows.length) {
            if (retryCount < maxRetries) {
                retryCount++;
                console.log(`⏳ No instruction rows found, retrying... (${retryCount}/${maxRetries})`);
                setTimeout(tryCreateMarkers, 300);
                return;
            }
            console.log('⚠️ No instruction rows found after retries, using fallback method');
            createTurnMarkersFallback(routeData, routeCoords);
            return;
        }
        
        console.log('✅ Found', instructionRows.length, 'instruction rows in DOM');
        
        // Process each instruction row from DOM
        let processedCount = 0;
        instructionRows.forEach(function(row, rowIndex) {
            // Skip hidden rows
            if (row.style.display === 'none') return;
            
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) return;
            
            // Get instruction text
            let instructionText = row.querySelector('.leaflet-routing-instruction-text');
            if (!instructionText && cells.length >= 2) {
                instructionText = cells[1];
            }
            
            if (!instructionText) return;
            
            const originalText = instructionText.textContent.trim();
            const text = convertInstructionToNatural(originalText);
            const instructionTextLower = text.toLowerCase();
            
            // Skip generic instructions
            if (instructionTextLower.includes('head') || 
                instructionTextLower.includes('berangkat') ||
                instructionTextLower.includes('arrived') ||
                instructionTextLower.includes('tiba') ||
                instructionTextLower.includes('go straight') ||
                instructionTextLower.includes('lurus terus') ||
                instructionTextLower.includes('continue straight')) {
                return;
            }
            
            // Extract turn direction
            const turnDirection = extractTurnDirection(text);
            if (!turnDirection) return;
            
            // Find corresponding instruction in routeData
            const instructionIndex = Math.min(rowIndex, routeData.instructions.length - 1);
            const instruction = routeData.instructions[instructionIndex];
            if (!instruction) return;
            
            // FIXED: Use instruction.index or geometryIndex if available (most accurate)
            // Priority: geometryIndex > index > waypointIndex
            let turnCoordIndex = -1;
            
            // CRITICAL: geometryIndex is the most accurate - points to exact coordinate in route geometry
            if (instruction.geometryIndex !== undefined && instruction.geometryIndex !== null) {
                turnCoordIndex = instruction.geometryIndex;
                console.log('📍 Using geometryIndex for turn marker:', turnCoordIndex);
            } else if (instruction.index !== undefined && instruction.index !== null) {
                turnCoordIndex = instruction.index;
                console.log('📍 Using instruction.index for turn marker:', turnCoordIndex);
            } else if (instruction.waypointIndex !== undefined && instruction.waypointIndex !== null) {
                turnCoordIndex = instruction.waypointIndex;
                console.log('📍 Using waypointIndex for turn marker:', turnCoordIndex);
            } else {
                // Calculate based on cumulative distance from previous instructions
                let cumulativeDistance = 0;
                for (let i = 0; i < instructionIndex; i++) {
                    if (routeData.instructions[i] && routeData.instructions[i].distance) {
                        cumulativeDistance += routeData.instructions[i].distance;
                    }
                }
                
                // FIXED: Calculate coordinate index more accurately
                // Find the coordinate at the START of this instruction (where the turn happens)
                let distanceSoFar = 0;
                for (let i = 1; i < routeCoords.length; i++) {
                    const prevCoord = routeCoords[i - 1];
                    const currCoord = routeCoords[i];
                    const segmentDistance = L.latLng(prevCoord.lat, prevCoord.lng)
                        .distanceTo(L.latLng(currCoord.lat, currCoord.lng));
                    
                    distanceSoFar += segmentDistance;
                    
                    // Find the point where this instruction STARTS (where the turn happens)
                    // Use cumulativeDistance (start of instruction) not cumulativeDistance + distance
                    if (distanceSoFar >= cumulativeDistance) {
                        turnCoordIndex = i;
                        break;
                    }
                }
                
                // Fallback: use proportional index based on instruction position
                if (turnCoordIndex < 0) {
                    // More accurate: use instruction index proportionally
                    const totalInstructions = routeData.instructions.length;
                    const progress = (instructionIndex + 1) / totalInstructions;
                    turnCoordIndex = Math.min(
                        routeCoords.length - 1,
                        Math.floor(progress * routeCoords.length)
                    );
                }
            }
            
            // Validate and get the turn coordinate
            if (turnCoordIndex < 0 || turnCoordIndex >= routeCoords.length) {
                console.warn('⚠️ Invalid turn coordinate index:', turnCoordIndex, 'for instruction', instructionIndex);
                return;
            }
            
            const turnCoord = routeCoords[turnCoordIndex];
            if (!turnCoord) {
                console.warn('⚠️ No coordinate found at index:', turnCoordIndex);
                return;
            }
            
            const turnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
            
            // Create marker - IMPROVED: Use more accurate turn coordinate
            // Find the exact intersection point if possible
            let finalTurnLatLng = turnLatLng;
            
            // IMPROVED: Use the exact coordinate at the turn point for maximum accuracy
            // The instruction.index points to the exact coordinate where the turn happens
            // No interpolation needed - use the coordinate directly
            finalTurnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
            
            // Optional: For even better accuracy, we could check if there's a better intersection point
            // by analyzing the route geometry, but using instruction.index is already very accurate
            
            const marker = createSingleTurnMarker(finalTurnLatLng, turnDirection, text, instruction.distance || 0);
            
            // Store turn marker data for accurate distance calculation
            if (marker) {
                turnMarkerData.push({
                    marker: marker,
                    latLng: finalTurnLatLng,
                    direction: turnDirection,
                    text: text,
                    distance: instruction.distance || 0,
                    instructionIndex: instructionIndex
                });
            }
            
            processedCount++;
        });
        
        console.log('✅ Created', processedCount, 'turn markers from DOM');
        
        // If no markers created from DOM, use fallback
        if (processedCount === 0) {
            console.log('⚠️ No markers created from DOM, using fallback method');
            createTurnMarkersFallback(routeData, routeCoords);
        }
    }
    
    // Start trying after initial delay
    setTimeout(tryCreateMarkers, 300);
}

// Fallback method: Create markers from routeData directly
function createTurnMarkersFallback(routeData, routeCoords) {
    let cumulativeDistance = 0;
    
    routeData.instructions.forEach(function(instruction, index) {
        if (!instruction || !instruction.text) return;
        
        const instructionText = instruction.text.toLowerCase();
        const turnDirection = extractTurnDirection(instruction.text);
        
        if (!turnDirection) {
            if (instruction.distance) {
                cumulativeDistance += instruction.distance;
            }
            return;
        }
        
        if (instructionText.includes('head') || 
            instructionText.includes('berangkat') ||
            instructionText.includes('arrived') ||
            instructionText.includes('tiba')) {
            return;
        }
        
        // Use instruction.index or geometryIndex if available (most accurate)
        let turnCoordIndex = -1;
        if (instruction.index !== undefined && instruction.index !== null) {
            turnCoordIndex = instruction.index;
        } else if (instruction.geometryIndex !== undefined && instruction.geometryIndex !== null) {
            turnCoordIndex = instruction.geometryIndex;
        } else {
            // Calculate based on distance - turn happens at START of instruction
            let targetDistance = cumulativeDistance; // Start of instruction, not end
            let distanceSoFar = 0;
            
            for (let i = 1; i < routeCoords.length; i++) {
                const prevCoord = routeCoords[i - 1];
                const currCoord = routeCoords[i];
                const segmentDistance = L.latLng(prevCoord.lat, prevCoord.lng)
                    .distanceTo(L.latLng(currCoord.lat, currCoord.lng));
                
                distanceSoFar += segmentDistance;
                
                // Find coordinate at START of instruction (where turn happens)
                if (distanceSoFar >= targetDistance) {
                    turnCoordIndex = i;
                    break;
                }
            }
            
            // Fallback: use proportional index
            if (turnCoordIndex < 0) {
                const totalInstructions = routeData.instructions.length;
                const progress = (index + 1) / totalInstructions;
                turnCoordIndex = Math.min(
                    routeCoords.length - 1,
                    Math.floor(progress * routeCoords.length)
                );
            }
        }
        
        if (turnCoordIndex < 0 || turnCoordIndex >= routeCoords.length) return;
        
        const turnCoord = routeCoords[turnCoordIndex];
        if (!turnCoord) return;
        
        let finalTurnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
        
        // IMPROVED: Use exact coordinate at turn point for better accuracy
        if (turnCoordIndex > 0 && turnCoordIndex < routeCoords.length - 1) {
            // Use the coordinate at the turn point directly
            finalTurnLatLng = L.latLng(turnCoord.lat, turnCoord.lng);
        }
        
        const instructionTextId = convertInstructionToNatural(instruction.text);
        const marker = createSingleTurnMarker(finalTurnLatLng, turnDirection, instructionTextId, instruction.distance || 0);
        
        // Store turn marker data for accurate distance calculation
        if (marker) {
            turnMarkerData.push({
                marker: marker,
                latLng: finalTurnLatLng,
                direction: turnDirection,
                text: instructionTextId,
                distance: instruction.distance || 0
            });
        }
        
        if (instruction.distance) {
            cumulativeDistance += instruction.distance;
        }
    });
}

// Helper function to create a single turn marker
function createSingleTurnMarker(turnLatLng, turnDirection, instructionText, distance) {
    // Create marker icon based on turn direction
    const markerColor = turnDirection === 'kanan' ? '#ff6b6b' : '#4ecdc4'; // Red for right, teal for left
    const turnIcon = L.divIcon({
        className: 'turn-marker',
        html: `<div style="
            background: ${markerColor};
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            position: relative;
        ">
            <div style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 0;
                height: 0;
                border-left: ${turnDirection === 'kanan' ? '4px solid white' : 'none'};
                border-right: ${turnDirection === 'kiri' ? '4px solid white' : 'none'};
                border-top: 4px solid transparent;
                border-bottom: 4px solid transparent;
            "></div>
        </div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    
    // Create marker
    const turnMarker = L.marker(turnLatLng, {
        icon: turnIcon,
        zIndexOffset: 1000 // Ensure markers appear above route line
    }).addTo(map);
    
    // Add popup with turn information
    turnMarker.bindPopup(`<b>${instructionText}</b><br>${formatDistance(distance)}`);
    
    // Store marker
    turnMarkers.push(turnMarker);
    
    console.log(`📍 Turn marker created: ${turnDirection} at`, turnLatLng.lat.toFixed(6), turnLatLng.lng.toFixed(6));
    
    // Return marker for storing in turnMarkerData
    return turnMarker;
}

// Function to clear all turn markers
function clearTurnMarkers() {
    // Ensure turnMarkers is defined before using it
    if (typeof turnMarkers === 'undefined') {
        turnMarkers = [];
    }
    if (typeof turnMarkerData === 'undefined') {
        turnMarkerData = [];
    }
    
    // Clear markers - handle both formats: array of markers or array of objects with marker property
    if (turnMarkers && turnMarkers.length > 0) {
        turnMarkers.forEach(function(marker) {
            // Check if marker is an object with marker property or direct marker
            if (marker && typeof marker === 'object') {
                if (marker.marker && map.hasLayer(marker.marker)) {
                    map.removeLayer(marker.marker);
                } else if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            } else if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
    }
    
    turnMarkers = [];
    turnMarkerData = []; // Also clear stored data
    
    // Reset next turn marker index if defined
    if (typeof nextTurnMarkerIndex !== 'undefined') {
        nextTurnMarkerIndex = 0;
    }
    
    console.log('🗑️ Cleared all turn markers');
}

// Update real-time instructions: jarak berkurang dan hapus yang sudah dilewati
function updateRealTimeInstructions(userLatLng) {
    if (!isNavigating || !currentRouteData || !route) {
        return;
    }
    
    try {
        // FIXED: Ensure we're using the most recent real-time user position
        // Get the actual current position from marker or GPS
        let realTimeUserLatLng = userLatLng;
        
        if (currentUserPosition) {
            const markerPos = currentUserPosition.getLatLng();
            if (markerPos && !isNaN(markerPos.lat) && !isNaN(markerPos.lng)) {
                realTimeUserLatLng = markerPos;
            }
        }
        
        // FIXED: Use GPS position if available (more accurate and real-time)
        if (bestGPSLocation && bestGPSLocation.lat && bestGPSLocation.lng) {
            const gpsPos = L.latLng(bestGPSLocation.lat, bestGPSLocation.lng);
            const distanceBetween = realTimeUserLatLng.distanceTo(gpsPos);
            
            // Use GPS position if it's reasonable (within 100m)
            if (distanceBetween <= 100) {
                realTimeUserLatLng = gpsPos;
            }
        }
        
        // Use real-time position for all calculations
        userLatLng = realTimeUserLatLng;
        
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
        
        // FIXED: Update setiap instruction row di DOM dengan jarak real-time yang akurat
        // CRITICAL: Gunakan perhitungan jarak langsung ke turn marker untuk akurasi maksimal
        const PASSED_THRESHOLD = 30; // Hapus instruction jika sudah dilewati < 30 meter (improved accuracy)
        
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
            
            // Get instruction text to find matching turn marker
            let instructionText = row.querySelector('.leaflet-routing-instruction-text');
            if (!instructionText && cells.length >= 2) {
                instructionText = cells[1];
            }
            
            // FIXED: Hitung jarak real-time langsung ke turn marker (jika ada)
            // Ini lebih akurat daripada menggunakan route coordinates
            let remainingDistance = 0;
            let foundTurnMarker = false;
            
            if (instructionText && turnMarkerData && turnMarkerData.length > 0) {
                const text = instructionText.textContent.trim();
                const turnDirection = extractTurnDirection(text);
                
                if (turnDirection) {
                    // FIXED: Find matching turn marker - try to find the nearest one with matching direction
                    let nearestMatchingMarker = null;
                    let nearestMatchingDistance = Infinity;
                    
                    for (let i = 0; i < turnMarkerData.length; i++) {
                        const turnData = turnMarkerData[i];
                        if (turnData && turnData.direction === turnDirection && turnData.marker && map.hasLayer(turnData.marker)) {
                            // FIXED: Get actual marker position from map (most accurate)
                            let markerPos = turnData.latLng;
                            if (turnData.marker.getLatLng) {
                                const actualMarkerPos = turnData.marker.getLatLng();
                                if (actualMarkerPos && !isNaN(actualMarkerPos.lat) && !isNaN(actualMarkerPos.lng)) {
                                    markerPos = actualMarkerPos;
                                }
                            }
                            
                            // FIXED: Calculate distance using real-time user position and actual marker position
                            const distanceToMarker = userLatLng.distanceTo(markerPos);
                            
                            // Find the nearest matching marker (most likely the correct one)
                            if (distanceToMarker < nearestMatchingDistance && distanceToMarker >= 0 && distanceToMarker < 500) {
                                nearestMatchingDistance = distanceToMarker;
                                nearestMatchingMarker = {
                                    markerPos: markerPos,
                                    turnData: turnData
                                };
                            }
                        }
                    }
                    
                    if (nearestMatchingMarker) {
                        // FIXED: Use the nearest matching marker for accurate distance
                        remainingDistance = userLatLng.distanceTo(nearestMatchingMarker.markerPos);
                        foundTurnMarker = true;
                        
                        console.log('[Real-time] 📍 Distance to turn marker:', turnDirection, '=', Math.round(remainingDistance), 'm');
                    }
                }
            }
            
            // Fallback: Use route-based calculation if no turn marker found
            if (!foundTurnMarker) {
                // Baca jarak original dari DOM (jarak dari start ke instruction point ini)
                const currentDistanceText = instructionDistance.textContent.trim();
                let originalDistanceFromStart = parseDistance(currentDistanceText);
                
                // Jika tidak bisa parse, gunakan data dari route instructions
                if (originalDistanceFromStart === 0 && rowIndex > 0 && rowIndex <= instructionCumulativeDistances.length) {
                    originalDistanceFromStart = instructionCumulativeDistances[rowIndex - 1];
                }
                
                // Hitung jarak tersisa (remaining distance) dari user ke instruction point ini
                if (rowIndex === 0) {
                    // Depart instruction - user sudah di start atau sudah melewati
                    remainingDistance = Math.max(0, -distanceTraveled);
                    if (distanceTraveled > PASSED_THRESHOLD) {
                        remainingDistance = 0;
                    }
                } else {
                    // Instruction lainnya - jarak tersisa = jarak ke instruction point - jarak yang sudah ditempuh
                    remainingDistance = Math.max(0, originalDistanceFromStart - distanceTraveled);
                }
            }
            
            // FIXED: Update jarak di DOM dengan jarak real-time yang akurat
            instructionDistance.textContent = formatDistance(Math.max(0, remainingDistance));
            
            // Hapus instruction jika sudah dilewati (< 30 meter)
            if (remainingDistance < PASSED_THRESHOLD && remainingDistance >= 0) {
                row.style.display = 'none';
                console.log('✅ Hiding instruction row', rowIndex, '- already passed (remaining:', Math.round(remainingDistance), 'm)');
                
                // CRITICAL: Also remove corresponding turn marker if exists
                // Find turn marker associated with this instruction
                if (typeof turnMarkerData !== 'undefined' && turnMarkerData && turnMarkerData.length > 0) {
                    // Try to match instruction with turn marker by direction
                    const instructionText = row.querySelector('.leaflet-routing-instruction-text');
                    if (instructionText) {
                        const text = instructionText.textContent.trim().toLowerCase();
                        let turnDir = '';
                        if (text.includes('kanan') || text.includes('right')) {
                            turnDir = 'kanan';
                        } else if (text.includes('kiri') || text.includes('left')) {
                            turnDir = 'kiri';
                        }
                        
                        if (turnDir) {
                            // Find and remove matching turn marker
                            for (let i = turnMarkerData.length - 1; i >= 0; i--) {
                                const turnData = turnMarkerData[i];
                                if (turnData && turnData.direction === turnDir) {
                                    // Check if this is the closest passed marker
                                    const markerDistance = userLatLng.distanceTo(turnData.latLng);
                                    if (markerDistance < PASSED_THRESHOLD) {
                                        console.log('🗑️ Removing turn marker for passed instruction:', turnDir, 'at', Math.round(markerDistance), 'm');
                                        
                                        // Remove marker from map
                                        if (turnData.marker && map.hasLayer(turnData.marker)) {
                                            map.removeLayer(turnData.marker);
                                        }
                                        
                                        // Remove from arrays
                                        const markerIndex = turnMarkers.indexOf(turnData.marker);
                                        if (markerIndex > -1) {
                                            turnMarkers.splice(markerIndex, 1);
                                        }
                                        
                                        // Remove from turnMarkerData
                                        turnMarkerData.splice(i, 1);
                                        
                                        break; // Only remove one marker per instruction
                                    }
                                }
                            }
                        }
                    }
                }
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
    if (typeof window.SpeechCoordinator !== 'undefined' && typeof window.SpeechCoordinator.handleNavigationSpeechStart === 'function') {
        window.SpeechCoordinator.handleNavigationSpeechStart();
    }
    
    // CRITICAL: Stop microphone immediately when navigator starts speaking
    // This prevents navigator's voice from being captured by microphone
    if (recognition && isListening) {
        console.log('🔇 Stopping microphone - navigator is speaking');
        try {
            recognition._stopped = true;
            recognition.stop();
            isListening = false;
        } catch (error) {
            console.warn('⚠️ Error stopping recognition for navigator speech:', error);
        }
    }
    
    // Extend suppression window to ignore recognition results triggered by speaker output
    // Increased to 3000ms (3 seconds) to ensure microphone doesn't capture echo/trailing audio
    suppressRecognitionUntil = Date.now() + 3000;
}

function markNavigatorSpeechEnd() {
    if (navigatorSpeechDepth > 0) {
        navigatorSpeechDepth--;
    }
    if (navigatorSpeechDepth <= 0) {
        navigatorSpeechDepth = 0;
        // CRITICAL: Suppress recognition longer after speech stops to avoid capturing trailing audio/echo
        // Increased to 2500ms (2.5 seconds) to ensure microphone doesn't capture echo
        suppressRecognitionUntil = Date.now() + 2500;
        setTimeout(function() {
            if (navigatorSpeechDepth === 0) {
                isNavigatorSpeaking = false;
                if (pendingAutoMicResume && recognition && !isListening) {
                    // CRITICAL: Increased resume delay to ensure navigator speech is completely finished
                    // Minimum 2 seconds delay before resuming microphone
                    const resumeDelay = Math.max(pendingAutoMicResumeDelay, 2000);
                    setTimeout(function() {
                        if (!pendingAutoMicResume) return; // Might have been cleared by custom flow
                        // Double check that suppression period has passed
                        if (navigatorSpeechDepth === 0 && Date.now() >= suppressRecognitionUntil) {
                            try {
                                recognition._stopped = false;
                                recognition.start();
                                isListening = true;
                                console.log('🎙️ Microphone auto-resumed after navigator speech (delayed ' + resumeDelay + 'ms)');
                                updateVoiceStatus('🎤 Mikrofon aktif kembali');
                            } catch (error) {
                                console.error('❌ Failed to auto-resume microphone:', error);
                                recognition._stopped = true;
                            } finally {
                                pendingAutoMicResume = false;
                            }
                        } else {
                            console.log('⏸️ Microphone resume delayed - suppression period not yet passed');
                        }
                    }, resumeDelay);
                } else {
                    pendingAutoMicResume = false;
                }
            }
        }, 800); // Increased initial delay to 800ms
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

// ========== POI (POINTS OF INTEREST) SYSTEM ==========
// Sistem untuk mencari dan menampilkan rumah makan dan supermarket di sekitar user

// Store POI markers
let poiMarkers = [];
let currentPOIList = [];
const POI_SEARCH_RADIUS = 2000; // 2 km radius

// Search POI using Overpass API
async function searchPOI(type = 'all') {
    if (!currentUserPosition) {
        updatePOIStatus('⚠️ Tunggu hingga lokasi GPS terdeteksi');
        return;
    }
    
    const userLatLng = currentUserPosition.getLatLng();
    const lat = userLatLng.lat;
    const lng = userLatLng.lng;
    
    // Update button states
    const buttons = document.querySelectorAll('.poi-filter-btn');
    buttons.forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    updatePOIStatus('🔍 Mencari tempat terdekat...');
    
    // Clear existing markers
    clearPOIMarkers();
    
    try {
        // Build Overpass query based on type
        let query = '';
        const radius = POI_SEARCH_RADIUS;
        
        if (type === 'restaurant') {
            query = `
                [out:json][timeout:25];
                (
                    node["amenity"="restaurant"](around:${radius},${lat},${lng});
                    node["amenity"="fast_food"](around:${radius},${lat},${lng});
                    node["amenity"="cafe"](around:${radius},${lat},${lng});
                    node["amenity"="food_court"](around:${radius},${lat},${lng});
                    way["amenity"="restaurant"](around:${radius},${lat},${lng});
                    way["amenity"="fast_food"](around:${radius},${lat},${lng});
                    way["amenity"="cafe"](around:${radius},${lat},${lng});
                );
                out center meta;
            `;
        } else if (type === 'supermarket') {
            query = `
                [out:json][timeout:25];
                (
                    node["shop"="supermarket"](around:${radius},${lat},${lng});
                    node["shop"="mall"](around:${radius},${lat},${lng});
                    node["amenity"="marketplace"](around:${radius},${lat},${lng});
                    way["shop"="supermarket"](around:${radius},${lat},${lng});
                    way["shop"="mall"](around:${radius},${lat},${lng});
                );
                out center meta;
            `;
        } else if (type === 'electronics') {
            query = `
                [out:json][timeout:25];
                (
                    node["shop"="electronics"](around:${radius},${lat},${lng});
                    node["shop"="computer"](around:${radius},${lat},${lng});
                    node["shop"="mobile_phone"](around:${radius},${lat},${lng});
                    node["shop"="hifi"](around:${radius},${lat},${lng});
                    node["shop"="appliance"](around:${radius},${lat},${lng});
                    way["shop"="electronics"](around:${radius},${lat},${lng});
                    way["shop"="computer"](around:${radius},${lat},${lng});
                    way["shop"="mobile_phone"](around:${radius},${lat},${lng});
                    way["shop"="hifi"](around:${radius},${lat},${lng});
                    way["shop"="appliance"](around:${radius},${lat},${lng});
                );
                out center meta;
            `;
        } else if (type === 'service') {
            query = `
                [out:json][timeout:25];
                (
                    node["shop"="repair"](around:${radius},${lat},${lng});
                    node["craft"="electronics_repair"](around:${radius},${lat},${lng});
                    node["craft"="computer_repair"](around:${radius},${lat},${lng});
                    node["craft"="watchmaker"](around:${radius},${lat},${lng});
                    node["craft"="key_cutter"](around:${radius},${lat},${lng});
                    node["amenity"="service"](around:${radius},${lat},${lng});
                    way["shop"="repair"](around:${radius},${lat},${lng});
                    way["craft"="electronics_repair"](around:${radius},${lat},${lng});
                    way["craft"="computer_repair"](around:${radius},${lat},${lng});
                );
                out center meta;
            `;
        } else {
            // All types
            query = `
                [out:json][timeout:25];
                (
                    node["amenity"="restaurant"](around:${radius},${lat},${lng});
                    node["amenity"="fast_food"](around:${radius},${lat},${lng});
                    node["amenity"="cafe"](around:${radius},${lat},${lng});
                    node["amenity"="food_court"](around:${radius},${lat},${lng});
                    node["shop"="supermarket"](around:${radius},${lat},${lng});
                    node["shop"="mall"](around:${radius},${lat},${lng});
                    node["amenity"="marketplace"](around:${radius},${lat},${lng});
                    node["shop"="electronics"](around:${radius},${lat},${lng});
                    node["shop"="computer"](around:${radius},${lat},${lng});
                    node["shop"="mobile_phone"](around:${radius},${lat},${lng});
                    node["shop"="hifi"](around:${radius},${lat},${lng});
                    node["shop"="appliance"](around:${radius},${lat},${lng});
                    node["shop"="repair"](around:${radius},${lat},${lng});
                    node["craft"="electronics_repair"](around:${radius},${lat},${lng});
                    node["craft"="computer_repair"](around:${radius},${lat},${lng});
                    node["craft"="watchmaker"](around:${radius},${lat},${lng});
                    node["craft"="key_cutter"](around:${radius},${lat},${lng});
                    way["amenity"="restaurant"](around:${radius},${lat},${lng});
                    way["amenity"="fast_food"](around:${radius},${lat},${lng});
                    way["amenity"="cafe"](around:${radius},${lat},${lng});
                    way["shop"="supermarket"](around:${radius},${lat},${lng});
                    way["shop"="mall"](around:${radius},${lat},${lng});
                    way["shop"="electronics"](around:${radius},${lat},${lng});
                    way["shop"="computer"](around:${radius},${lat},${lng});
                    way["shop"="mobile_phone"](around:${radius},${lat},${lng});
                    way["shop"="repair"](around:${radius},${lat},${lng});
                );
                out center meta;
            `;
        }
        
        // Use Overpass API
        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const response = await fetch(overpassUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'data=' + encodeURIComponent(query)
        });
        
        if (!response.ok) {
            throw new Error('Gagal mencari tempat: ' + response.statusText);
        }
        
        const data = await response.json();
        const elements = data.elements || [];
        
        if (elements.length === 0) {
            updatePOIStatus('📍 Tidak ada tempat ditemukan dalam radius 2 km');
            renderPOIList([]);
            return;
        }
        
        // Process POI data
        const poiList = elements.map(element => {
            const tags = element.tags || {};
            // Handle both node (has lat/lon) and way (has center) elements
            const poiLat = element.lat || (element.center && element.center.lat);
            const poiLng = element.lon || (element.center && element.center.lng);
            
            if (!poiLat || !poiLng) return null;
            
            // Determine POI type and icon
            let poiType = 'other';
            let icon = '📍';
            
            if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food' || tags.amenity === 'cafe' || tags.amenity === 'food_court') {
                poiType = 'restaurant';
                icon = '🍽️';
            } else if (tags.shop === 'supermarket' || tags.shop === 'mall' || tags.amenity === 'marketplace') {
                poiType = 'supermarket';
                icon = '🛒';
            } else if (tags.shop === 'electronics' || tags.shop === 'computer' || tags.shop === 'mobile_phone' || tags.shop === 'hifi' || tags.shop === 'appliance') {
                poiType = 'electronics';
                icon = '📱';
            } else if (tags.shop === 'repair' || tags.craft === 'electronics_repair' || tags.craft === 'computer_repair' || tags.craft === 'watchmaker' || tags.craft === 'key_cutter' || tags.amenity === 'service') {
                poiType = 'service';
                icon = '🔧';
            }
            
            // Get name
            const name = tags.name || tags['name:id'] || tags['name:en'] || 'Tempat Tanpa Nama';
            
            // Calculate distance from user
            const poiLatLng = L.latLng(poiLat, poiLng);
            const distance = userLatLng.distanceTo(poiLatLng);
            
            return {
                id: element.id,
                name: name,
                lat: poiLat,
                lng: poiLng,
                type: poiType,
                icon: icon,
                distance: distance,
                tags: tags
            };
        }).filter(poi => poi !== null);
        
        // Sort by distance
        poiList.sort((a, b) => a.distance - b.distance);
        
        // Limit to 20 nearest
        const limitedList = poiList.slice(0, 20);
        
        currentPOIList = limitedList;
        
        // Display markers on map
        displayPOIMarkers(limitedList);
        
        // Render list in UI
        renderPOIList(limitedList);
        
        updatePOIStatus(`✅ Ditemukan ${limitedList.length} tempat terdekat`);
        
    } catch (error) {
        console.error('Error searching POI:', error);
        updatePOIStatus('❌ Error: ' + error.message);
        renderPOIList([]);
    }
}

// Display POI markers on map
function displayPOIMarkers(poiList) {
    poiList.forEach(poi => {
        // Create custom icon based on type
        let markerColor = '#999';
        if (poi.type === 'restaurant') {
            markerColor = '#ff6b6b';
        } else if (poi.type === 'supermarket') {
            markerColor = '#4ecdc4';
        } else if (poi.type === 'electronics') {
            markerColor = '#9b59b6';
        } else if (poi.type === 'service') {
            markerColor = '#f39c12';
        }
        
        const customIcon = L.divIcon({
            className: 'poi-marker',
            html: `<div style="background: ${markerColor}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 12px;">${poi.icon}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        const marker = L.marker([poi.lat, poi.lng], {
            icon: customIcon
        }).addTo(map);
        
        // Create popup content
        const distanceText = formatDistance(poi.distance);
        const popupContent = `
            <div style="min-width: 200px;">
                <strong>${poi.icon} ${poi.name}</strong><br>
                <span style="color: #666; font-size: 12px;">📍 Jarak: ${distanceText}</span><br>
                <button onclick="selectPOIAsDestination(${poi.lat}, ${poi.lng}, '${poi.name.replace(/'/g, "\\'")}')" 
                        style="margin-top: 8px; padding: 6px 12px; background: #3b49df; color: white; border: none; border-radius: 6px; cursor: pointer; width: 100%;">
                    🧭 Tuju Lokasi Ini
                </button>
            </div>
        `;
        
        marker.bindPopup(popupContent);
        poiMarkers.push(marker);
    });
}

// Clear all POI markers
function clearPOIMarkers() {
    poiMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    poiMarkers = [];
}

// Render POI list in UI
function renderPOIList(poiList) {
    const container = document.getElementById('poiListContainer');
    if (!container) return;
    
    // Clear placeholder
    const placeholder = container.querySelector('.poi-placeholder');
    if (placeholder) placeholder.remove();
    
    if (poiList.length === 0) {
        container.innerHTML = '<div class="poi-placeholder"><p>📍 Tidak ada tempat ditemukan</p></div>';
        return;
    }
    
    // Create list
    const listHTML = poiList.map(poi => {
        const distanceText = formatDistance(poi.distance);
        return `
            <div class="poi-item" onclick="selectPOIAsDestination(${poi.lat}, ${poi.lng}, '${poi.name.replace(/'/g, "\\'")}')">
                <div class="poi-item-icon">${poi.icon}</div>
                <div class="poi-item-content">
                    <div class="poi-item-name">${escapeHtml(poi.name)}</div>
                    <div class="poi-item-distance">📍 ${distanceText}</div>
                </div>
                <div class="poi-item-action">🧭</div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = listHTML;
}

// Select POI as destination
function selectPOIAsDestination(lat, lng, name) {
    console.log('📍 Selecting POI as destination:', name, lat, lng);
    
    // Set destination
    latLngB = [lat, lng];
    currentDestinationName = name;
    
    // Remove old destination marker if exists
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
    }
    
    // Create destination marker
    const destIcon = L.divIcon({
        className: 'destination-marker',
        html: '<div style="background: #28a745; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    destinationMarker = L.marker([lat, lng], {
        icon: destIcon
    }).addTo(map);
    
    destinationMarker.bindPopup(`🎯 Tujuan: ${name}`);
    
    // Pan map to show both user and destination
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        const group = new L.featureGroup([currentUserPosition, destinationMarker]);
        map.fitBounds(group.getBounds().pad(0.1));
    } else {
        map.setView([lat, lng], 15);
    }
    
    // Create route
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        forceUpdateRoute(userLatLng);
        
        // Announce destination
        speakText(`Tujuan ditetapkan ke ${name}. Rute sedang dihitung.`, 'id-ID', true, function() {
            // After route is calculated, it will be announced automatically
        });
    } else {
        updateVoiceStatus('📍 Tujuan ditetapkan: ' + name);
        speakText(`Tujuan ditetapkan ke ${name}. Tunggu hingga lokasi GPS terdeteksi untuk menghitung rute.`, 'id-ID', true);
    }
    
    // Switch to route tab
    switchNavbarTab('route');
}

// Update POI status message
function updatePOIStatus(message) {
    // You can add a status element in the POI tab if needed
    console.log('[POI]', message);
}

// ============================================
// Debug Console UI Functions
// ============================================

// Function to update test status in UI
function updateTestStatus(message, type = 'info') {
    const statusEl = document.getElementById('testStatus');
    if (!statusEl) return;
    
    statusEl.textContent = message;
    statusEl.className = 'debug-test-status show ' + type;
    
    // Auto-hide after 10 seconds for success/error
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusEl.classList.remove('show');
        }, 10000);
    }
}

// Test voice from UI button
function testVoiceFromUI() {
    const btn = document.getElementById('testVoiceBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Testing...';
    }
    
    updateTestStatus('🔊 Testing suara navigator...', 'loading');
    
    if (typeof testNavigation !== 'undefined' && testNavigation.testVoice) {
        testNavigation.testVoice('Setelah 50 meter Belok kiri');
        
        setTimeout(() => {
            updateTestStatus('✅ Test suara selesai! Dengarkan suara navigator.', 'success');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔊 Test Suara';
            }
        }, 3000);
    } else {
        updateTestStatus('❌ testNavigation tidak tersedia.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔊 Test Suara';
        }
    }
}

// Check navigation state from UI button
function checkNavigationStateFromUI() {
    const btn = document.getElementById('checkStateBtn');
    
    if (typeof testNavigation !== 'undefined' && testNavigation.checkState) {
        const state = testNavigation.checkState();
        
        // Format state untuk display
        let statusText = '📊 Navigation State:\n';
        statusText += `• Navigasi aktif: ${state.isNavigating ? '✅ YA' : '❌ TIDAK'}\n`;
        statusText += `• User position: ${state.hasUserPosition ? '✅ ADA' : '❌ TIDAK'}\n`;
        statusText += `• Destination: ${state.hasDestination ? '✅ ADA' : '❌ TIDAK'}\n`;
        statusText += `• Route: ${state.hasRoute ? '✅ ADA' : '❌ TIDAK'}\n`;
        statusText += `• Voice enabled: ${state.voiceEnabled ? '✅ YA' : '❌ TIDAK'}\n`;
        statusText += `• Listening: ${state.isListening ? '✅ YA' : '❌ TIDAK'}`;
        
        updateTestStatus(statusText, 'info');
        
        // Also check navigator speaking state
        if (typeof testNavigation.checkNavigatorSpeaking === 'function') {
            setTimeout(() => {
                const navState = testNavigation.checkNavigatorSpeaking();
                let navText = '\n\n🔊 Navigator State:\n';
                navText += `• Speaking: ${navState.isSpeaking ? '✅ YA' : '❌ TIDAK'}\n`;
                navText += `• Pending: ${navState.isPending ? '⏳ YA' : '❌ TIDAK'}\n`;
                navText += `• Voice enabled: ${navState.voiceDirectionsEnabled ? '✅ YA' : '❌ TIDAK'}`;
                
                updateTestStatus(statusText + navText, 'info');
            }, 500);
        }
    } else {
        updateTestStatus('❌ testNavigation tidak tersedia.', 'error');
    }
}

// ============================================
// TESTING HELPER: GPS Simulation untuk Testing di Laptop
// ============================================
// Helper script untuk testing navigasi tanpa GPS real
// Usage: testNavigation.setLocation(-6.2088, 106.8456)
window.testNavigation = {
    // Set lokasi awal (simulasi GPS)
    setLocation: function(lat, lng, accuracy = 10) {
        // CRITICAL: Set hasUserInteraction = true (diperlukan untuk speechSynthesis)
        if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
            hasUserInteraction = true;
            console.log('🔧 Auto-set hasUserInteraction = true (untuk speechSynthesis)');
        }
        
        if (typeof onLocationFound === 'function') {
            const mockEvent = {
                latlng: L.latLng(lat, lng),
                accuracy: accuracy
            };
            onLocationFound(mockEvent);
            console.log('✅ Lokasi diset:', lat, lng, '(accuracy:', accuracy + 'm)');
            return true;
        } else {
            console.error('❌ onLocationFound function tidak ditemukan');
            return false;
        }
    },
    
    // Simulasi pergerakan dari titik A ke titik B
    simulateMovement: function(startLat, startLng, endLat, endLng, duration = 30) {
        let currentLat = startLat;
        let currentLng = startLng;
        const latStep = (endLat - startLat) / duration;
        const lngStep = (endLng - startLng) / duration;
        
        let step = 0;
        const interval = setInterval(() => {
            if (step >= duration) {
                clearInterval(interval);
                console.log('✅ Simulasi pergerakan selesai');
                return;
            }
            
            currentLat += latStep;
            currentLng += lngStep;
            
            this.setLocation(currentLat, currentLng, 10);
            step++;
            console.log(`📍 Langkah ${step}/${duration}:`, currentLat.toFixed(6), currentLng.toFixed(6));
        }, 1000); // Update setiap 1 detik
        
        console.log('🚶 Simulasi pergerakan dimulai...');
        return interval;
    },
    
    // Set destination dan mulai navigasi
    startNavigation: function(destLat, destLng, destName = 'Tujuan') {
        console.log('🚀 Starting navigation to:', destName, '(', destLat, ',', destLng, ')');
        
        // CRITICAL: Set hasUserInteraction = true (diperlukan untuk speechSynthesis)
        if (typeof hasUserInteraction !== 'undefined' && !hasUserInteraction) {
            console.log('🔧 Setting hasUserInteraction = true (CRITICAL untuk speechSynthesis)');
            hasUserInteraction = true;
        }
        
        // CRITICAL: Set voiceDirectionsEnabled = true
        if (typeof voiceDirectionsEnabled !== 'undefined' && !voiceDirectionsEnabled) {
            console.log('🔧 Setting voiceDirectionsEnabled = true');
            voiceDirectionsEnabled = true;
        }
        
        // Set destination
        if (typeof updateDestination === 'function') {
            updateDestination(destLat, destLng, destName);
            console.log('✅ Destination diset:', destName, '(', destLat, ',', destLng, ')');
        } else {
            console.error('❌ updateDestination function tidak ditemukan');
            return false;
        }
        
        // Start navigation
        if (typeof startTurnByTurnNavigation === 'function') {
            startTurnByTurnNavigation();
            console.log('✅ Navigasi dimulai');
            console.log('💡 Tunggu 3-5 detik untuk route dibuat, lalu jalankan: testNavigation.simulateRouteNavigation()');
            return true;
        } else {
            console.error('❌ startTurnByTurnNavigation function tidak ditemukan');
            return false;
        }
    },
    
    // Helper: Pastikan semua prerequisites untuk suara terpenuhi
    ensureVoicePrerequisites: function() {
        console.log('🔧 Memastikan semua prerequisites untuk suara terpenuhi...');
        
        // Set hasUserInteraction = true (CRITICAL untuk speechSynthesis)
        if (typeof hasUserInteraction !== 'undefined') {
            hasUserInteraction = true;
            console.log('✅ hasUserInteraction = true');
        }
        
        // Set voiceDirectionsEnabled = true
        if (typeof voiceDirectionsEnabled !== 'undefined') {
            voiceDirectionsEnabled = true;
            console.log('✅ voiceDirectionsEnabled = true');
        }
        
        // Set isNavigating = true
        if (typeof isNavigating !== 'undefined') {
            isNavigating = true;
            console.log('✅ isNavigating = true');
        }
        
        // Set SpeechCoordinator
        if (typeof window.SpeechCoordinator !== 'undefined') {
            window.SpeechCoordinator.setNavigating(true);
            console.log('✅ SpeechCoordinator.setNavigating(true)');
        }
        
        // Check speechSynthesis
        if (!('speechSynthesis' in window)) {
            console.error('❌ SpeechSynthesis tidak tersedia di browser ini!');
            return false;
        }
        
        console.log('✅ Semua prerequisites untuk suara sudah terpenuhi!');
        console.log('💡 Pastikan volume browser/system tidak muted');
        return true;
    },
    
    // Test voice announcement langsung
    testVoice: function(text = 'Setelah 50 meter Belok kiri') {
        if (typeof speakText === 'function') {
            console.log('🧪 Testing navigation voice announcement...');
            console.log('📢 Text yang akan diucapkan:', text);
            
            // Check apakah speechSynthesis tersedia
            if (!('speechSynthesis' in window)) {
                console.error('❌ Speech synthesis tidak tersedia');
                return false;
            }
            
            // Check state sebelum speak
            const beforeState = {
                speaking: window.speechSynthesis.speaking,
                pending: window.speechSynthesis.pending,
                paused: window.speechSynthesis.paused
            };
            console.log('📊 State sebelum speak:', beforeState);
            
            // Speak dengan callback
            speakText(text, 'id-ID', true, function() {
                console.log('✅ Test: Navigator selesai berbicara');
                const afterState = {
                    speaking: window.speechSynthesis.speaking,
                    pending: window.speechSynthesis.pending,
                    paused: window.speechSynthesis.paused
                };
                console.log('📊 State setelah speak:', afterState);
            });
            
            // Monitor state selama 5 detik
            let checkCount = 0;
            const monitorInterval = setInterval(() => {
                checkCount++;
                const currentState = {
                    speaking: window.speechSynthesis.speaking,
                    pending: window.speechSynthesis.pending,
                    paused: window.speechSynthesis.paused,
                    time: checkCount + 's'
                };
                console.log('📊 State monitoring (' + checkCount + 's):', currentState);
                
                if (checkCount >= 5) {
                    clearInterval(monitorInterval);
                    console.log('✅ Test monitoring selesai');
                }
            }, 1000);
            
            console.log('✅ Test suara dimulai:', text);
            console.log('💡 Dengarkan suara navigator dan lihat log di console');
            return true;
        } else {
            console.error('❌ speakText function tidak ditemukan');
            return false;
        }
    },
    
    // Check apakah navigator sedang berbicara
    checkNavigatorSpeaking: function() {
        const state = {
            speechSynthesisAvailable: 'speechSynthesis' in window,
            isSpeaking: window.speechSynthesis ? window.speechSynthesis.speaking : false,
            isPending: window.speechSynthesis ? window.speechSynthesis.pending : false,
            isPaused: window.speechSynthesis ? window.speechSynthesis.paused : false,
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : 'undefined',
            voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : 'undefined'
        };
        
        console.log('🔊 Navigator Speaking State:', state);
        
        if (state.isSpeaking) {
            console.log('✅ Navigator SEDANG BERBICARA sekarang');
        } else if (state.isPending) {
            console.log('⏳ Navigator akan berbicara (pending)');
        } else {
            console.log('🔇 Navigator TIDAK berbicara');
        }
        
        return state;
    },
    
    // Monitor navigator announcements secara real-time
    monitorNavigator: function(duration = 30) {
        console.log('📊 Memulai monitoring navigator selama', duration, 'detik...');
        console.log('💡 Navigator akan log setiap kali berbicara');
        
        let count = 0;
        const interval = setInterval(() => {
            count++;
            const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
            
            if (isSpeaking) {
                console.log(`[${count}s] 🔊 Navigator SEDANG BERBICARA`);
            } else if (count % 5 === 0) {
                // Log setiap 5 detik jika tidak berbicara
                console.log(`[${count}s] 🔇 Navigator tidak berbicara (normal jika tidak ada belokan)`);
            }
            
            if (count >= duration) {
                clearInterval(interval);
                console.log('✅ Monitoring selesai');
            }
        }, 1000);
        
        return interval;
    },
    
    // ============================================
    // DEBUG: Test Turn Announcement (PENTING!)
    // ============================================
    // Simulasi lengkap: User bergerak → Mendekati belokan → Navigator berbicara
    debugTurnAnnouncement: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🔍 DEBUG: TEST TURN ANNOUNCEMENT                            ║
║  Simulasi: User bergerak → Mendekati belokan → Navigator     ║
║  berbicara                                                    ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        // Step 1: Check prerequisites
        console.log('\n📋 STEP 1: Checking prerequisites...');
        const checks = {
            speechSynthesis: 'speechSynthesis' in window,
            voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : false,
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : false,
            hasRoute: route !== null,
            hasUserPosition: currentUserPosition !== null,
            hasDestination: latLngB !== null
        };
        
        console.table(checks);
        
        const allGood = Object.values(checks).every(v => v === true);
        if (!allGood) {
            console.warn('⚠️ Beberapa prerequisites tidak terpenuhi. Setup dulu:');
            if (!checks.hasUserPosition) {
                console.log('  → testNavigation.setLocation(-6.2088, 106.8456)');
            }
            if (!checks.hasDestination || !checks.hasRoute) {
                console.log('  → testNavigation.startNavigation(-6.2148, 106.8456, "Tujuan")');
            }
            if (!checks.isNavigating) {
                console.log('  → Pastikan navigasi sudah dimulai (ucapkan "Navigasi")');
            }
            return false;
        }
        
        console.log('✅ Semua prerequisites OK!\n');
        
        // Step 2: Test voice announcement langsung
        console.log('📋 STEP 2: Testing voice announcement...');
        console.log('🔊 Menguji: "Setelah 50 meter Belok kiri"');
        
        let announcementStarted = false;
        let announcementEnded = false;
        
        // Monitor speech synthesis
        const checkInterval = setInterval(() => {
            const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
            if (isSpeaking && !announcementStarted) {
                announcementStarted = true;
                console.log('✅ [VERIFIED] Navigator MULAI berbicara!');
                console.log('   🔊 Speech synthesis isSpeaking = true');
            }
            if (!isSpeaking && announcementStarted && !announcementEnded) {
                announcementEnded = true;
                console.log('✅ [VERIFIED] Navigator SELESAI berbicara!');
                console.log('   ✅ Speech synthesis isSpeaking = false');
                clearInterval(checkInterval);
            }
        }, 100);
        
        // Test announcement
        this.testVoice('Setelah 50 meter Belok kiri');
        
        // Stop monitoring after 10 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!announcementStarted) {
                console.warn('⚠️ Navigator TIDAK berbicara - mungkin ada masalah');
            }
        }, 10000);
        
        return true;
    },
    
    // Helper: Pastikan semua siap untuk simulasi
    ensureReadyForSimulation: function() {
        console.log('🔍 Checking prerequisites for simulation...');
        
        const checks = {
            hasUserPosition: currentUserPosition !== null,
            hasRouteData: currentRouteData !== null,
            hasRouteCoordinates: currentRouteData && currentRouteData.coordinates && currentRouteData.coordinates.length > 0,
            hasRoute: route !== null,
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : false,
            voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : false,
            hasUserInteraction: typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : false,
            speechSynthesisAvailable: 'speechSynthesis' in window
        };
        
        console.table(checks);
        
        // Auto-fix jika perlu
        if (!checks.hasUserPosition) {
            console.error('❌ User position tidak ada!');
            return false;
        }
        
        if (!checks.hasRouteData || !checks.hasRouteCoordinates) {
            console.error('❌ Route data tidak tersedia!');
            console.log('💡 Jalankan: testNavigation.startNavigation(...) dan tunggu 3-5 detik');
            return false;
        }
        
        // CRITICAL: Set hasUserInteraction = true (diperlukan untuk speechSynthesis)
        if (!checks.hasUserInteraction) {
            console.log('⚠️ hasUserInteraction = false - mengaktifkan otomatis...');
            if (typeof hasUserInteraction !== 'undefined') {
                hasUserInteraction = true;
                console.log('✅ hasUserInteraction = true (CRITICAL untuk speechSynthesis)');
            }
        }
        
        // CRITICAL: Set voiceDirectionsEnabled = true
        if (!checks.voiceDirectionsEnabled) {
            console.log('⚠️ voiceDirectionsEnabled = false - mengaktifkan otomatis...');
            if (typeof voiceDirectionsEnabled !== 'undefined') {
                voiceDirectionsEnabled = true;
                console.log('✅ voiceDirectionsEnabled = true');
            }
        }
        
        // Auto-activate navigation
        if (!checks.isNavigating) {
            console.log('⚠️ Navigasi belum aktif - mengaktifkan otomatis...');
            if (typeof isNavigating !== 'undefined') {
                isNavigating = true;
            }
            if (typeof window.SpeechCoordinator !== 'undefined') {
                window.SpeechCoordinator.setNavigating(true);
            }
            console.log('✅ Navigasi diaktifkan');
        }
        
        // Check speechSynthesis
        if (!checks.speechSynthesisAvailable) {
            console.error('❌ SpeechSynthesis tidak tersedia di browser ini!');
            return false;
        }
        
        console.log('✅ Semua prerequisites OK!');
        console.log('💡 Pastikan volume browser/system tidak muted untuk mendengar suara');
        return true;
    },
    
    // Helper: Tunggu route selesai dibuat
    waitForRoute: function(maxWait = 10000, checkInterval = 500) {
        return new Promise((resolve, reject) => {
            let elapsed = 0;
            
            const checkRoute = setInterval(() => {
                elapsed += checkInterval;
                
                const hasRoute = route !== null;
                const hasRouteData = currentRouteData !== null;
                const hasCoordinates = currentRouteData && currentRouteData.coordinates && currentRouteData.coordinates.length > 0;
                const hasInstructions = currentRouteData && currentRouteData.instructions && currentRouteData.instructions.length > 0;
                
                if (hasRoute && hasRouteData && hasCoordinates && hasInstructions) {
                    clearInterval(checkRoute);
                    console.log(`✅ Route selesai dibuat setelah ${elapsed}ms`);
                    console.log(`   - Route points: ${currentRouteData.coordinates.length}`);
                    console.log(`   - Instructions: ${currentRouteData.instructions.length}`);
                    resolve(true);
                    return;
                }
                
                if (elapsed >= maxWait) {
                    clearInterval(checkRoute);
                    console.error(`❌ Route tidak selesai dibuat setelah ${maxWait}ms`);
                    console.log('   State:', {
                        hasRoute,
                        hasRouteData,
                        hasCoordinates,
                        hasInstructions
                    });
                    reject(new Error('Route tidak selesai dibuat'));
                    return;
                }
                
                console.log(`⏳ Menunggu route... (${elapsed}ms/${maxWait}ms)`);
            }, checkInterval);
        });
    },
    
    // Simulasi pergerakan mengikuti route dengan belokan (UNTUK LAPTOP TESTING)
    // Fungsi ini akan mengikuti route coordinates dan navigator akan berbicara saat mendekati belokan
    simulateRouteNavigation: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚶 SIMULASI: Pergerakan Mengikuti Route                     ║
║  Marker belokan akan bergerak dan navigator akan berbicara ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        // CRITICAL: Set semua prerequisites SEBELUM check
        console.log('🔧 Setting prerequisites untuk simulasi...');
        
        // Set hasUserInteraction = true (CRITICAL untuk speechSynthesis)
        if (typeof hasUserInteraction !== 'undefined') {
            hasUserInteraction = true;
            console.log('✅ hasUserInteraction = true');
        }
        
        // Set voiceDirectionsEnabled = true
        if (typeof voiceDirectionsEnabled !== 'undefined') {
            voiceDirectionsEnabled = true;
            console.log('✅ voiceDirectionsEnabled = true');
        }
        
        // Set isNavigating = true
        if (typeof isNavigating !== 'undefined') {
            isNavigating = true;
            console.log('✅ isNavigating = true');
        }
        
        // Set SpeechCoordinator
        if (typeof window.SpeechCoordinator !== 'undefined') {
            window.SpeechCoordinator.setNavigating(true);
            console.log('✅ SpeechCoordinator.setNavigating(true)');
        }
        
        // Check prerequisites dengan helper function
        if (!this.ensureReadyForSimulation()) {
            console.error('❌ Prerequisites tidak terpenuhi!');
            return false;
        }
        
        // CRITICAL: Tunggu route selesai dibuat sebelum simulasi
        console.log('\n⏳ Menunggu route selesai dibuat...');
        this.waitForRoute(15000, 500).then(() => {
            // Verify final state
            console.log('\n📊 Final State Check:');
            const finalState = {
                hasUserInteraction: typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : 'undefined',
                voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : 'undefined',
                isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : 'undefined',
                hasRoute: route !== null,
                hasRouteData: currentRouteData !== null,
                hasCoordinates: currentRouteData && currentRouteData.coordinates && currentRouteData.coordinates.length > 0,
                hasInstructions: currentRouteData && currentRouteData.instructions && currentRouteData.instructions.length > 0,
                speechSynthesisAvailable: 'speechSynthesis' in window
            };
            console.table(finalState);
            
            console.log('✅ Memulai simulasi pergerakan mengikuti route...\n');
            
            // Get route coordinates
            const routeCoordinates = currentRouteData.coordinates;
            const totalPoints = routeCoordinates.length;
            
            console.log('📍 Route memiliki', totalPoints, 'titik koordinat');
            console.log('🚶 Simulasi akan bergerak dari titik ke titik sepanjang route');
            console.log('🔊 Navigator akan berbicara saat mendekati belokan\n');
            
            // Test suara langsung untuk memastikan speechSynthesis bekerja (non-blocking)
            console.log('🧪 Testing speechSynthesis langsung...');
            if (typeof speakText === 'function') {
                speakText('Test suara navigasi', 'id-ID', true, function() {
                    console.log('✅ Test suara selesai - speechSynthesis bekerja!');
                });
            } else {
                console.warn('⚠️ speakText function tidak ditemukan!');
            }
            
            // Start simulation
            this._startSimulation(routeCoordinates, totalPoints);
        }).catch((error) => {
            console.error('❌ Gagal menunggu route:', error);
            console.log('💡 Coba jalankan testNavigation.startNavigation(...) lagi dan tunggu lebih lama');
        });
    },
    
    // Internal: Start actual simulation
    _startSimulation: function(routeCoordinates, totalPoints) {
        // CRITICAL: Pastikan prerequisites tetap true saat simulasi
        if (typeof hasUserInteraction !== 'undefined') {
            hasUserInteraction = true;
        }
        if (typeof voiceDirectionsEnabled !== 'undefined') {
            voiceDirectionsEnabled = true;
        }
        if (typeof isNavigating !== 'undefined') {
            isNavigating = true;
        }
        
        // Start from current position (or first route coordinate)
        let currentIndex = 0;
        const userLatLng = currentUserPosition.getLatLng();
        
        // Find nearest route coordinate to start
        let nearestIndex = 0;
        let minDistance = Infinity;
        for (let i = 0; i < Math.min(10, routeCoordinates.length); i++) {
            const coord = routeCoordinates[i];
            const coordLatLng = Array.isArray(coord) 
                ? L.latLng(coord[0], coord[1])
                : L.latLng(coord.lat, coord.lng);
            const distance = userLatLng.distanceTo(coordLatLng);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }
        currentIndex = nearestIndex;
        
        console.log(`📍 Mulai dari titik ${currentIndex}/${totalPoints}`);
        
        // Monitor navigator announcements
        let announcementCount = 0;
        const monitorInterval = setInterval(() => {
            const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
            if (isSpeaking) {
                announcementCount++;
                const timestamp = new Date().toLocaleTimeString('id-ID');
                console.log(`[${timestamp}] 🔊 🔊 🔊 NAVIGATOR BERBICARA (announcement #${announcementCount}) 🔊 🔊 🔊`);
            }
        }, 500);
        
        // Simulasi pergerakan sepanjang route
        const moveInterval = setInterval(() => {
            if (currentIndex >= totalPoints - 1) {
                clearInterval(moveInterval);
                clearInterval(monitorInterval);
                
                console.log('\n✅ Simulasi selesai!');
                console.log(`📊 Total announcements: ${announcementCount}`);
                console.log(`📍 Total titik yang dilalui: ${currentIndex + 1}/${totalPoints}`);
                
                if (announcementCount > 0) {
                    console.log('✅ [VERIFIED] Navigator BERHASIL berbicara saat mendekati belokan!');
                } else {
                    console.warn('⚠️ Navigator TIDAK berbicara - check:');
                    console.log('  → Apakah route memiliki belokan?');
                    console.log('  → Apakah voiceDirectionsEnabled = true?');
                    console.log('  → Apakah jarak ke belokan < 200m?');
                }
                return;
            }
            
            // Get next coordinate
            const nextCoord = routeCoordinates[currentIndex + 1];
            let nextLatLng;
            
            if (Array.isArray(nextCoord)) {
                nextLatLng = L.latLng(nextCoord[0], nextCoord[1]);
            } else if (nextCoord.lat !== undefined && nextCoord.lng !== undefined) {
                nextLatLng = L.latLng(nextCoord.lat, nextCoord.lng);
            } else {
                nextLatLng = nextCoord;
            }
            
            // Update user position (ini akan trigger announceNextDirection dan updateTurnMarkers)
            this.setLocation(nextLatLng.lat, nextLatLng.lng, 10);
            
            currentIndex++;
            
            // Log progress setiap 10 titik atau saat mendekati belokan
            if (currentIndex % 10 === 0 || currentIndex % 5 === 0) {
                const progress = ((currentIndex / totalPoints) * 100).toFixed(1);
                console.log(`📍 Progress: ${progress}% (${currentIndex}/${totalPoints} titik)`);
                
                // Check distance to next turn marker
                if (turnMarkers.length > 0 && nextTurnMarkerIndex < turnMarkers.length) {
                    const nextTurn = turnMarkers[nextTurnMarkerIndex];
                    if (!nextTurn.passed) {
                        const distanceToTurn = nextLatLng.distanceTo(nextTurn.latlng);
                        if (distanceToTurn <= 200) {
                            console.log(`  ⚠️  MENDEKATI BELOKAN! Jarak: ${Math.round(distanceToTurn)}m - Navigator seharusnya berbicara...`);
                        }
                    }
                }
            }
        }, 1000); // Update setiap 1 detik (sama seperti GPS real-time)
        
        console.log('🚶 Simulasi pergerakan dimulai...\n');
        console.log('💡 Perhatikan:');
        console.log('   - Marker belokan yang sudah dilewati akan dihapus');
        console.log('   - Marker belokan berikutnya akan di-highlight (lebih besar)');
        console.log('   - Navigator akan berbicara saat mendekati belokan (< 200m)\n');
        
        return moveInterval;
    },
    
    // Simulasi user mendekati belokan (dari 250m → 50m → 0m)
    simulateApproachingTurn: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚶 SIMULASI: User Mendekati Belokan                         ║
║  Simulasi pergerakan dari 250m → 50m → 0m ke belokan        ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        // Pastikan navigasi aktif
        if (typeof isNavigating === 'undefined' || !isNavigating) {
            console.error('❌ Navigasi belum aktif!');
            console.log('💡 Jalankan: testNavigation.startNavigation(...) dulu');
            return false;
        }
        
        if (!currentUserPosition) {
            console.error('❌ User position tidak ada!');
            console.log('💡 Jalankan: testNavigation.setLocation(...) dulu');
            return false;
        }
        
        console.log('✅ Navigasi aktif, mulai simulasi...\n');
        
        // Simulasi pergerakan mendekati belokan
        const startLat = -6.2088;
        const startLng = 106.8456;
        const endLat = -6.2148;  // 600m ke selatan
        const endLng = 106.8456;
        
        // Simulasi dengan 30 langkah (setiap langkah = ~20 meter)
        const steps = 30;
        const latStep = (endLat - startLat) / steps;
        const lngStep = (endLng - startLng) / steps;
        
        let currentLat = startLat;
        let currentLng = startLng;
        let step = 0;
        
        console.log('📍 Simulasi dimulai dari:', startLat, startLng);
        console.log('🎯 Tujuan:', endLat, endLng);
        console.log('📏 Total jarak: ~600 meter');
        console.log('⏱️  Setiap langkah = 1 detik (~20 meter)\n');
        
        // Monitor navigator announcements
        let announcementCount = 0;
        const monitorInterval = setInterval(() => {
            const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
            if (isSpeaking) {
                announcementCount++;
                const timestamp = new Date().toLocaleTimeString('id-ID');
                console.log(`[${timestamp}] 🔊 NAVIGATOR BERBICARA (announcement #${announcementCount})`);
            }
        }, 500);
        
        const moveInterval = setInterval(() => {
            if (step >= steps) {
                clearInterval(moveInterval);
                clearInterval(monitorInterval);
                
                console.log('\n✅ Simulasi selesai!');
                console.log(`📊 Total announcements: ${announcementCount}`);
                
                if (announcementCount > 0) {
                    console.log('✅ [VERIFIED] Navigator BERHASIL berbicara saat user mendekati belokan!');
                } else {
                    console.warn('⚠️ Navigator TIDAK berbicara - check:');
                    console.log('  → Apakah route sudah dibuat?');
                    console.log('  → Apakah voiceDirectionsEnabled = true?');
                    console.log('  → Apakah jarak ke belokan < 200m?');
                }
                return;
            }
            
            currentLat += latStep;
            currentLng += lngStep;
            step++;
            
            // Update user position (ini akan trigger announceNextDirection)
            this.setLocation(currentLat, currentLng, 10);
            
            // Calculate approximate distance (for logging)
            const distanceRemaining = (steps - step) * 20; // ~20 meter per step
            
            if (step % 5 === 0 || distanceRemaining <= 200) {
                console.log(`📍 Langkah ${step}/${steps} - Jarak tersisa: ~${distanceRemaining}m`);
                
                if (distanceRemaining <= 200 && distanceRemaining > 0) {
                    console.log('  ⚠️  MENDEKATI BELOKAN! Navigator seharusnya berbicara...');
                }
            }
        }, 1000); // Update setiap 1 detik
        
        console.log('🚶 Simulasi pergerakan dimulai...\n');
        return moveInterval;
    },
    
    // ============================================
    // 🚀 RUNNING TEST: Test Otomatis Berjalan
    // ============================================
    // Test lengkap yang berjalan otomatis dan memberikan hasil jelas
    runTurnAnnouncementTest: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 RUNNING TEST: Navigator Turn Announcement                ║
║  Test otomatis untuk memastikan navigator berbicara          ║
║  saat user akan berbelok                                     ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        let testResults = {
            step1_prerequisites: false,
            step2_voiceTest: false,
            step3_navigationStart: false,
            step4_movementSimulation: false,
            totalAnnouncements: 0,
            testPassed: false
        };
        
        // ============================================
        // STEP 1: Setup Prerequisites
        // ============================================
        console.log('\n📋 STEP 1: Setting up prerequisites...');
        console.log('─────────────────────────────────────────');
        
        // Set location
        console.log('📍 Setting user location...');
        this.setLocation(-6.2088, 106.8456, 10);
        
        setTimeout(() => {
            // Set destination and start navigation
            console.log('🎯 Setting destination and starting navigation...');
            this.startNavigation(-6.2148, 106.8456, 'Tujuan Test');
            
            setTimeout(() => {
                // Check prerequisites
                const checks = {
                    speechSynthesis: 'speechSynthesis' in window,
                    voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : false,
                    hasRoute: route !== null,
                    hasUserPosition: currentUserPosition !== null,
                    hasDestination: latLngB !== null
                };
                
                console.table(checks);
                
                const allGood = Object.values(checks).every(v => v === true);
                if (allGood) {
                    testResults.step1_prerequisites = true;
                    console.log('✅ STEP 1 PASSED: All prerequisites OK!\n');
                } else {
                    console.error('❌ STEP 1 FAILED: Some prerequisites missing');
                    console.log('⚠️ Test stopped. Please fix prerequisites first.');
                    return;
                }
                
                // ============================================
                // STEP 2: Test Voice Announcement
                // ============================================
                console.log('📋 STEP 2: Testing voice announcement...');
                console.log('─────────────────────────────────────────');
                
                let voiceTestPassed = false;
                let voiceTestStarted = false;
                let voiceTestEnded = false;
                
                // Monitor speech synthesis
                const voiceCheckInterval = setInterval(() => {
                    const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
                    if (isSpeaking && !voiceTestStarted) {
                        voiceTestStarted = true;
                        console.log('✅ Navigator MULAI berbicara!');
                        console.log('   🔊 Speech synthesis isSpeaking = true');
                    }
                    if (!isSpeaking && voiceTestStarted && !voiceTestEnded) {
                        voiceTestEnded = true;
                        voiceTestPassed = true;
                        testResults.step2_voiceTest = true;
                        console.log('✅ Navigator SELESAI berbicara!');
                        console.log('   ✅ Speech synthesis isSpeaking = false');
                        clearInterval(voiceCheckInterval);
                    }
                }, 100);
                
                // Test announcement
                console.log('🔊 Testing: "Setelah 50 meter Belok kiri"');
                this.testVoice('Setelah 50 meter Belok kiri');
                
                // Check result after 5 seconds
                setTimeout(() => {
                    clearInterval(voiceCheckInterval);
                    if (voiceTestPassed) {
                        console.log('✅ STEP 2 PASSED: Voice announcement works!\n');
                    } else {
                        console.error('❌ STEP 2 FAILED: Navigator did not speak');
                        console.log('⚠️ Test will continue but may fail...\n');
                    }
                    
                    // ============================================
                    // STEP 3: Start Navigation
                    // ============================================
                    console.log('📋 STEP 3: Starting navigation...');
                    console.log('─────────────────────────────────────────');
                    
                    // Simulate "Navigasi" command
                    this.simulateCommand('Navigasi');
                    
                    setTimeout(() => {
                        if (typeof isNavigating !== 'undefined' && isNavigating) {
                            testResults.step3_navigationStart = true;
                            console.log('✅ STEP 3 PASSED: Navigation started!\n');
                        } else {
                            console.warn('⚠️ STEP 3 WARNING: Navigation may not be active');
                            console.log('   Continuing test anyway...\n');
                        }
                        
                        // ============================================
                        // STEP 4: Simulate Movement & Monitor
                        // ============================================
                        console.log('📋 STEP 4: Simulating user movement approaching turn...');
                        console.log('─────────────────────────────────────────');
                        console.log('🚶 User akan bergerak dari 250m → 200m → 50m → 0m');
                        console.log('⏱️  Test akan berjalan selama ~30 detik\n');
                        
                        // Simulate movement
                        const startLat = -6.2088;
                        const startLng = 106.8456;
                        const endLat = -6.2148;
                        const endLng = 106.8456;
                        const steps = 30;
                        const latStep = (endLat - startLat) / steps;
                        const lngStep = (endLng - startLng) / steps;
                        
                        let currentLat = startLat;
                        let currentLng = startLng;
                        let step = 0;
                        let announcementCount = 0;
                        let lastAnnouncementTime = null;
                        
                        // Monitor announcements
                        const monitorInterval = setInterval(() => {
                            const isSpeaking = window.speechSynthesis ? window.speechSynthesis.speaking : false;
                            if (isSpeaking) {
                                announcementCount++;
                                lastAnnouncementTime = new Date().toLocaleTimeString('id-ID');
                                const timestamp = new Date().toLocaleTimeString('id-ID');
                                console.log(`[${timestamp}] 🔊 NAVIGATOR BERBICARA! (announcement #${announcementCount})`);
                            }
                        }, 500);
                        
                        // Movement simulation
                        const moveInterval = setInterval(() => {
                            if (step >= steps) {
                                clearInterval(moveInterval);
                                clearInterval(monitorInterval);
                                
                                testResults.totalAnnouncements = announcementCount;
                                testResults.step4_movementSimulation = announcementCount > 0;
                                
                                console.log('\n╔══════════════════════════════════════════════════════════════╗');
                                console.log('║  📊 TEST RESULTS                                                ║');
                                console.log('╚══════════════════════════════════════════════════════════════╝\n');
                                
                                console.log('📋 Test Summary:');
                                console.log('─────────────────────────────────────────');
                                console.log('STEP 1 - Prerequisites:', testResults.step1_prerequisites ? '✅ PASSED' : '❌ FAILED');
                                console.log('STEP 2 - Voice Test:', testResults.step2_voiceTest ? '✅ PASSED' : '❌ FAILED');
                                console.log('STEP 3 - Navigation Start:', testResults.step3_navigationStart ? '✅ PASSED' : '⚠️  WARNING');
                                console.log('STEP 4 - Movement Simulation:', testResults.step4_movementSimulation ? '✅ PASSED' : '❌ FAILED');
                                console.log('─────────────────────────────────────────');
                                console.log('📊 Total Announcements:', announcementCount);
                                
                                if (announcementCount > 0) {
                                    console.log('✅ Navigator BERHASIL berbicara saat user mendekati belokan!');
                                    console.log(`   Last announcement at: ${lastAnnouncementTime}`);
                                } else {
                                    console.log('❌ Navigator TIDAK berbicara saat user mendekati belokan');
                                    console.log('   Possible issues:');
                                    console.log('   → Route may not have turns');
                                    console.log('   → Distance to turn may be > 200m');
                                    console.log('   → voiceDirectionsEnabled may be false');
                                }
                                
                                // Final verdict
                                testResults.testPassed = testResults.step1_prerequisites && 
                                                         testResults.step2_voiceTest && 
                                                         testResults.step4_movementSimulation;
                                
                                console.log('\n╔══════════════════════════════════════════════════════════════╗');
                                if (testResults.testPassed) {
                                    console.log('║  ✅ TEST PASSED: Navigator berbicara saat user berbelok!     ║');
                                } else {
                                    console.log('║  ❌ TEST FAILED: Navigator tidak berbicara dengan benar        ║');
                                }
                                console.log('╚══════════════════════════════════════════════════════════════╝\n');
                                
                                return;
                            }
                            
                            currentLat += latStep;
                            currentLng += lngStep;
                            step++;
                            
                            // Update user position
                            this.setLocation(currentLat, currentLng, 10);
                            
                            // Log progress
                            const distanceRemaining = (steps - step) * 20;
                            if (step % 5 === 0 || distanceRemaining <= 200) {
                                if (distanceRemaining <= 200 && distanceRemaining > 0) {
                                    console.log(`📍 Langkah ${step}/${steps} - Jarak: ~${distanceRemaining}m ⚠️  MENDEKATI BELOKAN!`);
                                } else {
                                    console.log(`📍 Langkah ${step}/${steps} - Jarak: ~${distanceRemaining}m`);
                                }
                            }
                        }, 1000);
                        
                    }, 2000);
                }, 5000);
            }, 2000);
        }, 1000);
        
        console.log('🚀 Test started! Please wait...\n');
        return testResults;
    },
    
    // ============================================
    // 🚀 RUNNING NAVIGATION TEST: Test dengan Navigasi Benar-benar Berjalan
    // ============================================
    // Test yang benar-benar menjalankan navigasi dan monitor announcement
    // Test lengkap: Lokasi → Destination → Navigasi → Simulasi Pergerakan
    fullTest: function() {
        console.log('🧪 Memulai test lengkap...');
        
        // 1. Set lokasi awal (Jakarta)
        this.setLocation(-6.2088, 106.8456, 10);
        
        setTimeout(() => {
            // 2. Set destination (600m ke selatan)
            this.startNavigation(-6.2148, 106.8456, 'Tujuan Test');
            
            setTimeout(() => {
                // 3. Simulasi pergerakan
                this.simulateMovement(-6.2088, 106.8456, -6.2148, 106.8456, 20);
            }, 3000);
        }, 2000);
    },
    
    // Check state navigasi (untuk debugging)
    checkState: function() {
        const state = {
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : 'undefined',
            hasUserPosition: currentUserPosition !== null,
            hasDestination: latLngB !== null,
            hasRoute: route !== null,
            isListening: typeof isListening !== 'undefined' ? isListening : 'undefined',
            voiceEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : 'undefined'
        };
        
        console.log('📊 Navigation State:', state);
        return state;
    },
    
    // Simulasi voice command
    simulateCommand: function(command) {
        if (typeof handleVoiceCommand === 'function') {
            handleVoiceCommand(command);
            console.log('✅ Simulasi command:', command);
            return true;
        } else {
            console.error('❌ handleVoiceCommand function tidak ditemukan');
            return false;
        }
    },
    
    // Debug microphone state
    debugMicrophone: function() {
        const state = {
            recognitionAvailable: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
            recognitionInitialized: !!recognition,
            isListening: typeof isListening !== 'undefined' ? isListening : 'undefined',
            hasUserInteraction: typeof hasUserInteraction !== 'undefined' ? hasUserInteraction : 'undefined',
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : 'undefined',
            recognitionStopped: recognition ? (recognition._stopped || false) : 'N/A',
            recognitionLang: recognition ? recognition.lang : 'N/A',
            recognitionContinuous: recognition ? recognition.continuous : 'N/A',
            recognitionInterimResults: recognition ? recognition.interimResults : 'N/A'
        };
        
        console.log('🎤 Microphone Debug State:', state);
        
        // Check microphone permission
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'microphone' }).then(function(result) {
                console.log('🎤 Microphone Permission:', result.state);
                state.microphonePermission = result.state;
            }).catch(function(err) {
                console.log('⚠️ Could not check microphone permission:', err);
            });
        }
        
        return state;
    },
    
    // Force start microphone (with user interaction)
    forceStartMicrophone: function() {
        console.log('🔧 Force starting microphone...');
        
        // Mark user interaction
        hasUserInteraction = true;
        
        // Initialize if needed
        if (!recognition) {
            console.log('🔄 Initializing speech recognition...');
            const initResult = initSpeechRecognition();
            if (!initResult && !recognition) {
                console.error('❌ Failed to initialize speech recognition');
                updateVoiceStatus('❌ Gagal menginisialisasi speech recognition');
                return false;
            }
        }
        
        // Clear stopped flag
        if (recognition) {
            recognition._stopped = false;
            console.log('🔄 Cleared stopped flag');
        }
        
        // Stop if already listening (to restart fresh)
        if (isListening && recognition) {
            try {
                recognition.stop();
                isListening = false;
                console.log('🔄 Stopped existing recognition to restart');
                // Wait a bit before restarting
                setTimeout(() => {
                    this.forceStartMicrophone();
                }, 500);
                return;
            } catch (e) {
                console.warn('⚠️ Error stopping existing recognition:', e);
            }
        }
        
        // Start microphone
        if (recognition && !isListening) {
            try {
                finalTranscript = '';
                recognition.start();
                isListening = true;
                console.log('✅ Microphone force started successfully');
                updateVoiceStatus('🎤 Mikrofon aktif - Force start');
                
                // Verify it's actually listening
                setTimeout(() => {
                    if (isListening) {
                        console.log('✅ Microphone confirmed listening');
                    } else {
                        console.warn('⚠️ Microphone may not be listening - check permission');
                    }
                }, 1000);
                
                return true;
            } catch (error) {
                console.error('❌ Failed to force start microphone:', error);
                updateVoiceStatus('❌ Gagal: ' + (error.message || error));
                
                // If permission error, provide guidance
                if (error.name === 'NotAllowedError' || (error.message && error.message.includes('not-allowed'))) {
                    console.log('💡 TIP: Klik di halaman dan pilih "Allow" saat popup permission muncul');
                    updateVoiceStatus('⚠️ Klik di halaman dan pilih "Allow" untuk izin mikrofon');
                }
                
                return false;
            }
        } else if (!recognition) {
            console.error('❌ Recognition object not available');
            updateVoiceStatus('❌ Speech recognition tidak tersedia');
            return false;
        } else {
            console.log('ℹ️ Microphone already listening');
            return true;
        }
    },
    
    // Test microphone dengan visual feedback
    testMicrophone: function() {
        console.log('🧪 Testing microphone...');
        
        // Check support
        const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        console.log('Browser support:', supported ? '✅' : '❌');
        
        if (!supported) {
            updateVoiceStatus('❌ Browser tidak support speech recognition');
            return false;
        }
        
        // Check if initialized
        if (!recognition) {
            console.log('🔄 Initializing...');
            initSpeechRecognition();
        }
        
        // Force start
        const result = this.forceStartMicrophone();
        
        if (result) {
            console.log('✅ Test: Microphone should be listening now');
            console.log('💡 Ucapkan sesuatu dan lihat apakah muncul "Final transcript" di console');
            updateVoiceStatus('🧪 Test: Mikrofon aktif - ucapkan sesuatu');
            
            // Set timeout to check if speech detected
            setTimeout(() => {
                if (isListening) {
                    console.log('✅ Test: Microphone masih listening');
                } else {
                    console.warn('⚠️ Test: Microphone stopped - mungkin ada masalah');
                }
            }, 5000);
        }
        
        return result;
    },
    
    // ============================================
    // 🎯 TEST: Check Turn Markers (FITUR BARU!)
    // ============================================
    // Check apakah marker belokan sudah dibuat
    checkTurnMarkers: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🎯 CHECK: Turn Markers Status                               ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        const status = {
            turnMarkersDefined: typeof turnMarkers !== 'undefined',
            turnMarkersCount: typeof turnMarkers !== 'undefined' ? turnMarkers.length : 0,
            hasRoute: route !== null,
            hasRouteData: currentRouteData !== null,
            routeInstructions: currentRouteData && currentRouteData.instructions ? currentRouteData.instructions.length : 0
        };
        
        console.table(status);
        
        if (status.turnMarkersCount > 0) {
            console.log(`✅ Ditemukan ${status.turnMarkersCount} marker belokan di peta!`);
            console.log('💡 Lihat di peta - marker belokan seharusnya terlihat sebagai lingkaran berwarna');
            turnMarkers.forEach(function(marker, index) {
                const pos = marker.getLatLng();
                console.log(`   Marker #${index + 1}: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`);
            });
        } else {
            console.warn('⚠️ Belum ada marker belokan!');
            console.log('💡 Pastikan:');
            console.log('   1. Route sudah dibuat (testNavigation.startNavigation(...))');
            console.log('   2. Route memiliki instructions dengan belokan');
            console.log('   3. Fungsi createTurnMarkers() sudah dipanggil');
        }
        
        return status;
    },
    
    // ============================================
    // 🚀 TEST LENGKAP: Marker Belokan + Announcement
    // ============================================
    // Test lengkap untuk fitur baru: marker belokan dan announcement "belok kanan/kiri"
    testTurnMarkersAndAnnouncement: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 TEST LENGKAP: Marker Belokan + Announcement               ║
║  Test fitur baru: marker belokan dan "belok kanan/kiri"     ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        console.log('📋 STEP 1: Setup lokasi dan route...');
        
        // Step 1: Set lokasi awal (Jakarta)
        const startLat = -6.2088;
        const startLng = 106.8456;
        this.setLocation(startLat, startLng, 10);
        
        setTimeout(() => {
            console.log('\n📋 STEP 2: Set destination dan buat route...');
            
            // Step 2: Set destination (lokasi yang memiliki belokan)
            // Gunakan koordinat yang akan menghasilkan route dengan belokan
            const destLat = -6.2148;  // ~600m ke selatan
            const destLng = 106.8556;  // ~1km ke timur (akan ada belokan)
            const destName = 'Tujuan Test Belokan';
            
            this.startNavigation(destLat, destLng, destName);
            
            setTimeout(() => {
                console.log('\n📋 STEP 3: Check marker belokan...');
                
                // Step 3: Check marker belokan setelah route dibuat
                setTimeout(() => {
                    const markerStatus = this.checkTurnMarkers();
                    
                    if (markerStatus.turnMarkersCount > 0) {
                        console.log('\n✅ SUCCESS: Marker belokan berhasil dibuat!');
                        console.log('💡 Lihat di peta - Anda seharusnya melihat marker belokan');
                    } else {
                        console.log('\n⚠️ Marker belokan belum muncul');
                        console.log('💡 Tunggu beberapa detik, lalu jalankan: testNavigation.checkTurnMarkers()');
                    }
                    
                    // Step 4: Test announcement
                    console.log('\n📋 STEP 4: Test announcement "belok kanan/kiri"...');
                    console.log('💡 Test announcement dengan format baru...');
                    
                    setTimeout(() => {
                        // Test announcement "belok kanan"
                        console.log('\n🔊 Test 1: "Belok kanan"');
                        this.testVoice('Belok kanan sekarang');
                        
                        setTimeout(() => {
                            // Test announcement "belok kiri"
                            console.log('\n🔊 Test 2: "Belok kiri"');
                            this.testVoice('Belok kiri sekarang');
                            
                            setTimeout(() => {
                                // Test dengan jarak
                                console.log('\n🔊 Test 3: "Setelah 50 meter Belok kanan"');
                                this.testVoice('Setelah 50 meter Belok kanan');
                                
                                setTimeout(() => {
                                    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ TEST SELESAI!                                            ║
╚══════════════════════════════════════════════════════════════╝

📊 HASIL TEST:
1. ✅ Marker belokan: ${markerStatus.turnMarkersCount > 0 ? 'BERHASIL' : 'BELUM MUNCUL'}
2. ✅ Announcement "belok kanan/kiri": SUDAH DIUJI

💡 NEXT STEPS:
- Lihat di peta apakah marker belokan terlihat
- Dengarkan apakah announcement mengatakan "belok kanan/kiri" dengan jelas
- Jalankan: testNavigation.checkTurnMarkers() untuk check marker lagi
- Jalankan: testNavigation.simulateApproachingTurn() untuk test real-time
                                    `);
                                }, 3000);
                            }, 3000);
                        }, 3000);
                    }, 2000);
                }, 3000); // Tunggu route selesai dibuat
            }, 2000);
        }, 2000);
        
        return true;
    },
    
    // ============================================
    // 🧪 TEST: Announcement Langsung
    // ============================================
    // Test apakah announcement "belok kanan/kiri" bekerja
    testAnnouncement: function() {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🧪 TEST: Announcement "Belok Kanan/Kiri"                    ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        // Check prerequisites
        const checks = {
            voiceDirectionsEnabled: typeof voiceDirectionsEnabled !== 'undefined' ? voiceDirectionsEnabled : false,
            isNavigating: typeof isNavigating !== 'undefined' ? isNavigating : false,
            hasRouteData: currentRouteData !== null,
            hasInstructions: currentRouteData && currentRouteData.instructions && currentRouteData.instructions.length > 0,
            hasUserPosition: currentUserPosition !== null,
            speechSynthesis: 'speechSynthesis' in window
        };
        
        console.table(checks);
        
        if (!checks.speechSynthesis) {
            console.error('❌ Speech Synthesis tidak tersedia di browser ini');
            return false;
        }
        
        if (!checks.voiceDirectionsEnabled) {
            console.warn('⚠️ voiceDirectionsEnabled = false - mengaktifkan...');
            if (typeof voiceDirectionsEnabled !== 'undefined') {
                voiceDirectionsEnabled = true;
                console.log('✅ voiceDirectionsEnabled diaktifkan');
            }
        }
        
        if (!checks.isNavigating) {
            console.warn('⚠️ isNavigating = false - mengaktifkan...');
            if (typeof isNavigating !== 'undefined') {
                isNavigating = true;
                console.log('✅ isNavigating diaktifkan');
            }
            if (typeof window.SpeechCoordinator !== 'undefined') {
                window.SpeechCoordinator.setNavigating(true);
            }
        }
        
        if (!checks.hasRouteData || !checks.hasInstructions) {
            console.error('❌ Route data tidak tersedia!');
            console.log('💡 Jalankan: testNavigation.startNavigation(...) dulu');
            return false;
        }
        
        if (!checks.hasUserPosition) {
            console.error('❌ User position tidak ada!');
            console.log('💡 Jalankan: testNavigation.setLocation(...) dulu');
            return false;
        }
        
        console.log('\n✅ Semua prerequisites OK!');
        console.log('🔊 Testing announcement...\n');
        
        // Test 1: Test announcement langsung
        console.log('📋 TEST 1: Test announcement "Belok kanan"');
        this.testVoice('Belok kanan sekarang');
        
        setTimeout(() => {
            console.log('\n📋 TEST 2: Test announcement "Belok kiri"');
            this.testVoice('Belok kiri sekarang');
            
            setTimeout(() => {
                console.log('\n📋 TEST 3: Test dengan jarak');
                this.testVoice('Setelah 50 meter Belok kanan');
                
                setTimeout(() => {
                    console.log('\n📋 TEST 4: Test fungsi announceFromRouteData()');
                    console.log('💡 Memanggil announceFromRouteData() untuk test real announcement...\n');
                    
                    // Call announceFromRouteData directly
                    announceFromRouteData();
                    
                    setTimeout(() => {
                        console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ TEST SELESAI!                                            ║
╚══════════════════════════════════════════════════════════════╝

📊 HASIL:
- ✅ Test announcement langsung: SUDAH DIUJI
- ✅ Test announceFromRouteData(): SUDAH DIPANGGIL

💡 NEXT STEPS:
- Dengarkan apakah navigator berbicara
- Check console untuk log announcement
- Jika tidak berbicara, check:
  1. Volume browser/system tidak muted
  2. Jarak ke belokan < 200m
  3. Route memiliki instructions dengan belokan
                        `);
                    }, 2000);
                }, 3000);
            }, 3000);
        }, 3000);
        
        return true;
    }
};

// Print usage instructions saat helper di-load
console.log(`
🧪 TESTING HELPER LOADED!

📖 CARA PAKAI:
1. testNavigation.setLocation(-6.2088, 106.8456)  // Set lokasi awal
2. testNavigation.startNavigation(-6.2148, 106.8456, 'Tujuan')  // Set tujuan & mulai navigasi
3. testNavigation.testVoice('Setelah 50 meter Belok kiri')  // Test suara
4. testNavigation.simulateCommand('Rute 1')  // Simulasi voice command
5. testNavigation.simulateMovement(-6.2088, 106.8456, -6.2148, 106.8456, 20)  // Simulasi pergerakan
6. testNavigation.fullTest()  // Test lengkap otomatis
7. testNavigation.checkState()  // Check state navigasi
8. testNavigation.testMicrophone()  // Test mikrofon (PENTING!)
9. testNavigation.debugMicrophone()  // Debug state mikrofon
10. testNavigation.forceStartMicrophone()  // Force start mikrofon

📍 Contoh Koordinat:
- Jakarta: -6.2088, 106.8456
- Solo: -7.5667, 110.8167
- Bandung: -6.9175, 107.6191

🔊 DEBUG NAVIGATOR:
- testNavigation.debugTurnAnnouncement()  // Test lengkap announcement belokan

🎯 FITUR BARU: Marker Belokan & Announcement "Belok Kanan/Kiri"
- testNavigation.checkTurnMarkers()  // Check marker belokan
- testNavigation.testTurnMarkersAndAnnouncement()  // Test lengkap fitur baru
- testNavigation.simulateRouteNavigation()  // Simulasi pergerakan mengikuti route (UNTUK LAPTOP!)
- testNavigation.testAnnouncement()  // Test announcement langsung

📍 MARKER BELOKAN: Sekarang mendukung SEMUA jenis belokan:
   - Belok kiri/kanan (Turn left/right)
   - Sedikit ke kiri/kanan (Slight left/right)
   - Tetap di kiri/kanan (Keep left/right)
   - Bergabung kiri/kanan (Merge left/right)
   - Ambil jalan keluar (Take ramp)
   - Persimpangan (Fork)
   - Bundaran (Traffic circle)
`);
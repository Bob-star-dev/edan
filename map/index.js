// Init Leaflet Map - Start with a default location
const map = L.map('map', {
    center: [3.59, 98.67],
    zoom: 15
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Variables to track current user location
let currentUserPosition = null;
let currentAccuracy = null;
let hasPermission = false;
let locationInterval = null;
let isFirstLocationUpdate = true; // Track if this is the first location update

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

// Voice Directions Variables - AUTO ENABLED for blind users
let voiceDirectionsEnabled = true; // Automatically enabled for accessibility
let lastAnnouncedDirection = '';
let isSpeaking = false;
let announcementQueue = [];

// Navigation tracking variables
let currentRouteData = null; // Store current route details
let currentLegIndex = 0; // Track which instruction leg we're on
let lastAnnouncedInstruction = null; // Prevent duplicate announcements
let isNavigating = false; // Track if user is actively navigating

// Function to handle when user's location is found
function onLocationFound(e) {
    // Hide permission popup when location is found
    hidePermissionPopup();
    
    // Update status display
    const statusEl = document.getElementById('status');
    const coordsEl = document.getElementById('coordinates');
    const accuracyEl = document.getElementById('accuracy');
    
    if (statusEl) statusEl.textContent = '✅ Location found!';
    if (coordsEl) coordsEl.textContent = `Lat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`;
    
    // Calculate accuracy
    const radius = e.accuracy / 2;
    if (accuracyEl) accuracyEl.textContent = `Accuracy: ${radius.toFixed(0)}m`;
    
    // Remove old position markers if they exist
    if (currentUserPosition) {
        map.removeLayer(currentUserPosition);
    }
    if (currentAccuracy) {
        map.removeLayer(currentAccuracy);
    }
    
    // Create accuracy circle (yellow for user location area)
    currentAccuracy = L.circle(e.latlng, radius, {
        color: '#ffd700',
        fillColor: '#ffd700',
        fillOpacity: 0.2
    }).addTo(map);
    
    // Create user position marker with custom icon
    const customIcon = L.divIcon({
        className: 'custom-user-marker',
        html: '<div style="background: #3b49df; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    currentUserPosition = L.marker(e.latlng, {icon: customIcon}).addTo(map)
        .bindPopup("📍 Lokasi Anda (Akurasi: " + radius.toFixed(0) + "m)").openPopup();
    
    // Auto-center map to user location (only first time)
    // This makes the map automatically zoom to user's position when opened
    if (isFirstLocationUpdate) {
        map.setView(e.latlng, 16);
        isFirstLocationUpdate = false; // Reset flag after first update
    }
    
    // Don't create route automatically - wait for user to set destination
    // Route will be created when user sets destination via voice command
    if (latLngB && destinationMarker) {
        updateRoute(e.latlng);
    }
    
    // Hide permission popup if shown
    const popup = document.getElementById('permissionPopup');
    if (popup) popup.style.display = 'none';
    
    // Mark that we have permission
    hasPermission = true;
    
    // Check for next navigation direction if navigating (Google Maps style)
    if (isNavigating) {
        // Small delay to ensure DOM is ready
        setTimeout(function() {
            announceNextDirection();
        }, 500);
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
        speakText('Gagal menghitung rute. Server OSRM mungkin sedang bermasalah.', 'id-ID', true);
        updateVoiceStatus('⚠️ Error menghitung rute');
    });
    
    // Re-attach event listener
    route.on('routesfound', function(e) {
        console.log('✅✅✅ NEW ROUTE FOUND FOR NEW DESTINATION!');
        console.log('📍 Route distance:', e.routes[0].summary.totalDistance / 1000, 'km');
        console.log('⏱️ Route time:', e.routes[0].summary.totalTime / 60, 'minutes');
        
        // Save route data for navigation tracking
        currentRouteData = e.routes[0];
        currentLegIndex = 0;
        lastAnnouncedInstruction = null;
        isNavigating = true;
        
        const routeHash = JSON.stringify(e.routes[0].coordinates);
        
        // Force new announcement
        lastRouteHash = null;
        isAnnouncingRoute = false;
        lastAnnouncementTime = 0;
        
        // Trigger announcement with longer delay to ensure DOM is fully rendered
        setTimeout(function() {
            console.log('🔔 Triggering announcement for NEW destination');
            
            // Translate instructions to Indonesian (retry-based, handles dynamic content)
            translateRouteInstructions();
            
            // Also try again after a bit more delay
            setTimeout(translateRouteInstructions, 1000);
            
            if (voiceDirectionsEnabled) {
                announceRouteDirections(true);
            }
        }, 3000); // Increased from 2000 to 3000ms
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
            speakText('Gagal menghitung rute. Server mungkin sedang bermasalah.', 'id-ID', false);
            updateVoiceStatus('⚠️ Error menghitung rute');
        });
        
        // Listen for route found events to announce directions
        route.on('routesfound', function(e) {
            // Save route data for navigation tracking
            currentRouteData = e.routes[0];
            currentLegIndex = 0;
            lastAnnouncedInstruction = null;
            isNavigating = true;
            
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
                
                console.log('🗺️ NEW ROUTE DETECTED - Preparing announcement!');
                
                // Delay to allow routing control to render
                setTimeout(function() {
                    console.log('⏰ Timeout: Checking if we should announce...');
                    
                    // Translate instructions to Indonesian
                    translateRouteInstructions();
                    // Try again after more delay
                    setTimeout(translateRouteInstructions, 1000);
                    
                    if (voiceDirectionsEnabled) {
                        console.log('✅ Voice directions enabled - Calling announceRouteDirections');
                        announceRouteDirections(true);
                    } else {
                        console.log('❌ Voice directions disabled - Skipping announcement');
                    }
                    // Reset flag after announcement starts
                    setTimeout(function() {
                        isAnnouncingRoute = false;
                        console.log('🔄 Reset isAnnouncingRoute flag');
                    }, 5000); // Give it 5 seconds to finish announcement
                }, 2000); // Increased from 1500 to 2000ms
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
                    console.log('🔄 Updating route waypoints - end destination changed to', newEnd);
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
                        
                        // Save route data for navigation tracking
                        currentRouteData = e.routes[0];
                        currentLegIndex = 0;
                        lastAnnouncedInstruction = null;
                        isNavigating = true;
                        
                        const routeHash = JSON.stringify(e.routes[0].coordinates);
                        
                        // Force new announcement
                        lastRouteHash = null;
                        isAnnouncingRoute = false;
                        lastAnnouncementTime = 0;
                        
                        // Trigger announcement after route is calculated
                        setTimeout(function() {
                            console.log('🔔 Triggering announcement for NEW destination');
                            
                            // Translate instructions to Indonesian
                            translateRouteInstructions();
                            // Try again after more delay
                            setTimeout(translateRouteInstructions, 1000);
                            
                            if (voiceDirectionsEnabled) {
                                announceRouteDirections(true);
                            }
                        }, 3000); // Increased from 2000 to 3000ms
                    });
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
function requestLocation() {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '⏳ Requesting location...';
    
    // Request location with options
    navigator.geolocation.getCurrentPosition(
        function(position) {
            // Success - trigger locationfound event
            map.fire('locationfound', {
                latlng: L.latLng(position.coords.latitude, position.coords.longitude),
                accuracy: position.coords.accuracy
            });
        },
        function(error) {
            // Error - trigger locationerror event
            map.fire('locationerror', {
                message: error.message
            });
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
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
function locate() {
    map.locate({
        setView: false, // Don't auto center - let user control
        watch: false,
        maxZoom: 16,
        enableHighAccuracy: true,
        timeout: 10000
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
    hidePermissionPopup();
    requestLocation();
    setTimeout(function() {
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
        let interimTranscript = '';
        
        // Process all results
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
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
        updateVoiceStatus('❌ Error: ' + event.error);
        isListening = false;
        updateVoiceButton();
    };
    
    // Handle speech recognition end
    recognition.onend = function() {
        console.log('Speech recognition ended');
        isListening = false;
        updateVoiceButton();
    };
}

// Known cities list
const knownCities = {
    'jakarta': { lat: -6.2088, lng: 106.8456, name: 'Jakarta, Indonesia' },
    'surakarta': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    'solo': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    'bandung': { lat: -6.9175, lng: 107.6191, name: 'Bandung, Indonesia' },
    'yogyakarta': { lat: -7.7956, lng: 110.3695, name: 'Yogyakarta, Indonesia' },
    'medan': { lat: 3.5952, lng: 98.6722, name: 'Medan, Indonesia' },
    'surabaya': { lat: -7.2575, lng: 112.7521, name: 'Surabaya, Indonesia' },
    'makassar': { lat: -5.1477, lng: 119.4327, name: 'Makassar, Indonesia' }
};

// Handle voice commands
function handleVoiceCommand(transcript) {
    // Convert transcript to lowercase for easier matching
    const command = transcript.toLowerCase().trim();
    
    console.log('Handling voice command:', command);
    
    // Show what was recognized
    updateVoiceStatus('🎤 Aku mendengar: "' + transcript + '"');
    
    // Voice trigger commands for blind users - activate microphone
    if (command === 'halo' || command === 'hello' || command === 'aktivasi' || command === 'activate' || command === 'buka mikrofon' || command === 'aktifkan') {
        if (!isListening) {
            if (!recognition) {
                initSpeechRecognition();
            }
            recognition.start();
            isListening = true;
            updateVoiceStatus('🎤 Mikrofon aktif. Sebutkan tujuan Anda.');
            speakText('Mikrofon aktif. Sebutkan nama kota tujuan Anda', 'id-ID', true);
        } else {
            updateVoiceStatus('🎤 Mikrofon sudah aktif');
            speakText('Mikrofon sudah aktif', 'id-ID', true);
        }
        return;
    }
    
    // Check for navigation commands in Indonesian
    if (command.includes('mulai rute') || command.includes('mulai navigasi') || command.includes('ikut rute') || command === 'mulai' || command.trim() === 'mulai') {
        startRouteNavigation();
        return;
    }
    
    // Check if command is a known city name directly
    // Clean up the command - remove punctuation and extra spaces
    const cityKey = command.toLowerCase().trim().replace(/[.,;:!?]/g, '').trim();
    console.log('Checking for city:', cityKey);
    console.log('Known cities:', Object.keys(knownCities));
    
    if (knownCities[cityKey]) {
        console.log('Found city:', cityKey, knownCities[cityKey]);
        const city = knownCities[cityKey];
        
        // Stop microphone first to prevent overlap
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        updateDestination(city.lat, city.lng, city.name);
        updateVoiceStatus('✅ Tujuan: ' + city.name);
        // updateDestination will handle the announcement
        return;
    } else {
        console.log('City NOT found:', cityKey);
    }
    
    // Try to extract location from command (supports both English and Indonesian)
    // English: "go to <location>", "navigate to <location>"
    // Indonesian: "pergi ke <location>", "navigasi ke <location>", "ke <location>"
    let location = extractLocation(command);
    
    if (location) {
        // Geocode the location using Nominatim (OpenStreetMap)
        geocodeLocation(location);
        
        // Keep microphone listening for more commands (hands-free for blind users)
        // Don't auto-stop - user can give more voice commands
    } else {
        updateVoiceStatus('❓ Tidak mengerti lokasi. Coba sebutkan nama kota seperti: "Jakarta"');
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

// Geocode location using Nominatim (OpenStreetMap API)
async function geocodeLocation(location) {
    try {
        updateVoiceStatus('🔍 Mencari: ' + location);
        speakText('Mencari lokasi ' + location + '...', 'id-ID', true);
        
        // Use OpenStreetMap Geocoding API (works better with CORS)
        const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=id&format=json`;
        
        try {
            const response = await fetch(geocodeUrl);
            const data = await response.json();
            
            if (data && data.results && data.results.length > 0) {
                const result = data.results[0];
                const newLat = result.latitude;
                const newLng = result.longitude;
                const name = result.name + ', ' + result.admin1;
                
                // Stop microphone first to prevent overlap
                if (isListening && recognition) {
                    recognition.stop();
                    isListening = false;
                }
                
                // Update destination
                updateDestination(newLat, newLng, name);
                updateVoiceStatus('✅ Tujuan: ' + name);
                return;
            }
        } catch (openMeteoError) {
            console.log('OpenMeteo failed, trying alternative...');
        }
        
        // Fallback to hardcoded cities for Indonesia
        // Clean up the location name - remove punctuation and extra spaces
        const cityKey = location.toLowerCase().trim().replace(/[.,;:!?]/g, '').trim();
        console.log('Looking for city:', cityKey);
        
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            
            // Stop microphone first to prevent overlap
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            updateDestination(city.lat, city.lng, city.name);
            updateVoiceStatus('✅ Tujuan: ' + city.name);
        } else {
            console.log('City not found:', cityKey, 'Available cities:', Object.keys(knownCities));
            
            // Stop microphone first to prevent overlap
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
            }
            
            // Announce location not found
            speakText('Lokasi tidak ditemukan: ' + location, 'id-ID', true, function() {
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
            
            updateVoiceStatus('❌ Lokasi tidak ditemukan: ' + location);
        }
        
    } catch (error) {
        console.error('Geocoding error:', error);
        // Stop microphone first to prevent overlap
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
        }
        
        // Announce error
        speakText('Error saat mencari lokasi. Coba gunakan nama kota lain.', 'id-ID', true, function() {
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
    
    // Announce new destination if voice directions are enabled
    if (voiceDirectionsEnabled) {
        speakText('Menuju ' + name + '. Mencari rute...', 'id-ID', true);
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
    
    // Pan to new destination
    map.setView(latLngB, 13);
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
        
        // Auto-announce voice directions are ready for blind users
        setTimeout(function() {
            if (voiceDirectionsEnabled) {
                // Activate microphone AFTER announcement completes (prevent overlap)
                speakText('Aplikasi navigasi siap. Ucapkan nama kota tujuan Anda. Contoh: Jakarta.', 'id-ID', true, function() {
                    // Callback: announce "Mikrofon aktif" first
                    console.log('First announcement completed');
                    speakText('Mikrofon aktif', 'id-ID', true, function() {
                        // Callback: NOW activate microphone AFTER "Mikrofon aktif" announcement finishes
                        console.log('Mikrofon aktif announcement completed, activating microphone...');
                        setTimeout(function() {
                            if (recognition && !isListening) {
                                recognition.start();
                                isListening = true;
                                updateVoiceStatus('🎤 Mikrofon aktif. Sebutkan tujuan Anda.');
                            }
                        }, 500); // Small delay after announcement to ensure clean transition
                    });
                });
            }
        }, 2000);
    });
} else {
    initSpeechRecognition();
    initSpeechSynthesis();
    
    // Auto-announce voice directions are ready for blind users
    setTimeout(function() {
        if (voiceDirectionsEnabled) {
            // Activate microphone AFTER announcement completes (prevent overlap)
            speakText('Aplikasi navigasi siap. Ucapkan nama kota tujuan Anda. Contoh: Jakarta.', 'id-ID', true, function() {
                // Callback: announce "Mikrofon aktif" first
                console.log('First announcement completed');
                speakText('Mikrofon aktif', 'id-ID', true, function() {
                    // Callback: NOW activate microphone AFTER "Mikrofon aktif" announcement finishes
                    console.log('Mikrofon aktif announcement completed, activating microphone...');
                    setTimeout(function() {
                        if (recognition && !isListening) {
                            recognition.start();
                            isListening = true;
                            updateVoiceStatus('🎤 Mikrofon aktif. Sebutkan tujuan Anda.');
                        }
                    }, 500); // Small delay after announcement to ensure clean transition
                });
            });
        }
    }, 2000);
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
    
    // If there's ongoing speech and this is not priority, queue it
    if (isSpeaking && !priority) {
        announcementQueue.push({ text, lang, onComplete });
        console.log('Queued:', text);
        return;
    }
    
    // If there's ongoing speech and this is priority, cancel current speech
    if (isSpeaking && priority) {
        window.speechSynthesis.cancel();
    }
    
    // Cancel any pending speech
    window.speechSynthesis.cancel();
    
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
            isSpeaking = true;
            lastSpokenMessage = text; // Remember this message
            // Only log short preview to avoid cluttering console
            const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
            console.log('Speech started:', preview);
        };
        utterance.onerror = function(event) {
            if (event.error !== 'interrupted') {
                console.error('Speech error:', event.error);
            }
            isSpeaking = false;
            // Process next in queue
            processAnnouncementQueue();
        };
        utterance.onend = function() {
            console.log('Speech ended');
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
function announceRouteDirections(priority = false) {
    if (!voiceDirectionsEnabled) return;
    
    // Find the routing control container
    const routingContainer = document.querySelector('.leaflet-routing-alternatives-container');
    if (!routingContainer) return;
    
    // Get the first (active) route
    const activeRoute = routingContainer.querySelector('.leaflet-routing-alt:not(.leaflet-routing-alt-minimized)');
    if (!activeRoute) return;
    
    // Get route summary
    const routeInfo = activeRoute.querySelector('h3');
    const instructionRows = activeRoute.querySelectorAll('tbody tr');
    
    if (!instructionRows.length) return;
    
    // Get route summary
    let announcement = '';
    if (routeInfo) {
        const info = routeInfo.textContent.trim();
        console.log('📏 Route info read from DOM:', info);
        announcement = 'Rute ditemukan. ' + convertDistanceToIndonesian(info) + '. ';
    } else {
        console.log('⚠️ No route info found in DOM');
    }
    
    // Read first few instructions in Google Maps style
    console.log('📋 Reading instructions from', instructionRows.length, 'rows');
    
    let validInstructions = [];
    for (let i = 0; i < instructionRows.length - 1; i++) {
        const row = instructionRows[i];
        
        // Get all cells in the row
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue; // Skip rows without proper structure
        
        // Column structure: [0] = icon, [1] = instruction text, [2] = distance
        // Try to find instruction with class first
        let instructionText = row.querySelector('.leaflet-routing-instruction-text');
        if (!instructionText && cells.length >= 2) {
            // Fallback: use second column (index 1) for instruction text
            instructionText = cells[1];
        }
        
        // Try to find distance with class first
        let instructionDistance = row.querySelector('.leaflet-routing-instruction-distance');
        if (!instructionDistance) {
            instructionDistance = row.querySelector('.leaflet-routing-distance');
        }
        if (!instructionDistance && cells.length >= 3) {
            // Fallback: use third column (index 2) for distance
            instructionDistance = cells[2];
        }
        
        if (instructionText) {
            let text = instructionText.textContent.trim();
            
            // Debug: log first instruction
            if (i === 0) {
                console.log('📝 First instruction text:', text.substring(0, 100));
            }
            
            // Skip "Head" instructions
            if (text.toLowerCase().startsWith('head')) {
                continue;
            }
            
            const distance = instructionDistance ? instructionDistance.textContent.trim() : '';
            if (text) { // Only add if text is not empty
                validInstructions.push({ text: text, distance: distance });
            }
        }
    }
    
    console.log('✓ Found', validInstructions.length, 'valid instructions');
    
    // Announce first 2-3 instructions to give overview
    if (validInstructions.length > 0) {
        announcement += 'Petunjuk arah: ';
        
        for (let i = 0; i < Math.min(3, validInstructions.length); i++) {
            const inst = validInstructions[i];
            let instruction = convertInstructionToNatural(inst.text);
            
            // Add distance if available and meaningful
            if (inst.distance && inst.distance !== '35 m' && inst.distance !== '0 m' && inst.distance.length > 0) {
                instruction += ' dalam ' + convertDistance(inst.distance);
            }
            
            if (i === 0) {
                announcement += instruction;
            } else {
                announcement += '. Kemudian, ' + instruction;
            }
        }
        
        announcement += '. ';
    } else {
        // If no instructions found, at least say something
        announcement += 'Ikuti rute yang ditampilkan di peta. ';
    }
    
    // Announce navigation start message
    announcement += 'Memulai navigasi.';
    
    // Debug: log the full announcement with line breaks for readability
    console.log('📢 Full announcement to be spoken:');
    console.log('=========================================');
    console.log(announcement);
    console.log('=================================');
    
    // Callback after announcement is done
    function afterRouteAnnouncement() {
        console.log('✓ Route announcement completed');
        
        // Keep microphone listening for blind users (hands-free operation)
        // Microphone remains active so user can give more commands
        
        // Update status with instructions for user
        updateVoiceStatus('📍 Navigasi aktif - Siap menerima perintah suara');
        
        // Announce that microphone is ready for further commands
        setTimeout(function() {
            console.log('✓ Announcing microphone availability');
            speakText('Navigasi sudah aktif. Ucapkan perintah lain kapan saja.', 'id-ID', false);
        }, 2000); // Wait 2 seconds after route announcement
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
            if (!text || text === lastAnnouncedInstruction) {
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
                    
                    // Only announce if different from last announced
                    if (text !== lastAnnouncedInstruction) {
                        lastAnnouncedInstruction = text;
                        
                        // Announce the turn instruction
                        if (distanceInMeters >= 100) {
                            speakText(text + ' dalam ' + Math.round(distanceInMeters) + ' meter', 'id-ID', true);
                        } else {
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
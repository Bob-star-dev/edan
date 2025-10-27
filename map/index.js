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

// Destination point (changeable via voice command)
let latLngB = [3.58, 98.66];
let destinationMarker = L.marker(latLngB).addTo(map)
  .bindPopup("Destination");

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

// Function to handle when user's location is found
function onLocationFound(e) {
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
    
    // Update route from current location to destination
    updateRoute(e.latlng);
    
    // Hide permission popup if shown
    const popup = document.getElementById('permissionPopup');
    if (popup) popup.style.display = 'none';
    
    // Mark that we have permission
    hasPermission = true;
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

// Function to update or create the route from user location to destination
function updateRoute(userLatLng) {
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
        
        // Listen for route found events to announce directions
        route.on('routesfound', function(e) {
            // Create route hash
            const routeHash = JSON.stringify(e.routes[0].coordinates);
            
            // Only announce if this is a new route (different hash)
            if (routeHash !== lastRouteHash) {
                lastRouteHash = routeHash;
                
                // Delay to allow routing control to render
                setTimeout(function() {
                    if (voiceDirectionsEnabled) {
                        announceRouteDirections(true);
                    }
                }, 1500);
            }
        });
        
    } else {
        // Update existing route
        route.setWaypoints([
            L.latLng(userLatLng.lat || userLatLng[0], userLatLng.lng || userLatLng[1]),
            L.latLng(latLngB[0], latLngB[1])
        ]);
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
    
    // Continue locating every 3 seconds
    locationInterval = setInterval(locate, 3000);
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
    recognition.lang = 'en-US'; // Can be changed to 'id-ID' for Indonesian
    
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

// Handle voice commands
function handleVoiceCommand(transcript) {
    // Convert transcript to lowercase for easier matching
    const command = transcript.toLowerCase().trim();
    
    console.log('Handling voice command:', command);
    
    // Show what was recognized
    updateVoiceStatus('🎤 Aku mendengar: "' + transcript + '"');
    
    // Check for navigation commands in Indonesian
    if (command.includes('mulai rute') || command.includes('mulai navigasi') || command.includes('ikut rute') || command === 'mulayi' || command.trim() === 'mulayi') {
        startRouteNavigation();
        return;
    }
    
    // Try to extract location from command (supports both English and Indonesian)
    // English: "go to <location>", "navigate to <location>"
    // Indonesian: "pergi ke <location>", "navigasi ke <location>", "ke <location>"
    let location = extractLocation(command);
    
    if (location) {
        // Geocode the location using Nominatim (OpenStreetMap)
        geocodeLocation(location);
        
        // Auto-stop listening after receiving location
        setTimeout(function() {
            if (isListening && recognition) {
                recognition.stop();
                isListening = false;
                updateVoiceButton();
            }
        }, 500);
    } else {
        updateVoiceStatus('❓ Tidak mengerti lokasi. Coba: "pergi ke Jakarta" atau "mulai"');
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
    
    // Stop listening after starting navigation
    setTimeout(function() {
        if (isListening && recognition) {
            recognition.stop();
            isListening = false;
            updateVoiceButton();
        }
    }, 500);
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
        
        // Use Nominatim API for geocoding
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data && data.length > 0) {
            const result = data[0];
            const newLat = parseFloat(result.lat);
            const newLng = parseFloat(result.lon);
            
            // Update destination
            updateDestination(newLat, newLng, result.display_name);
            updateVoiceStatus('✅ Tujuan: ' + result.display_name);
        } else {
            speakText('Lokasi tidak ditemukan: ' + location, 'id-ID', true);
            updateVoiceStatus('❌ Lokasi tidak ditemukan: ' + location);
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        speakText('Error saat mencari lokasi', 'id-ID', true);
        updateVoiceStatus('❌ Error saat mencari lokasi');
    }
}

// Update destination marker and route
function updateDestination(lat, lng, name) {
    // Remove old marker
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
    
    // Update route if user location exists
    if (currentUserPosition) {
        const userLatLng = currentUserPosition.getLatLng();
        updateRoute(userLatLng);
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

// Update voice button appearance
function updateVoiceButton() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
        if (isListening) {
            voiceBtn.innerHTML = '🛑 Berhenti';
            voiceBtn.style.background = '#dc3545';
        } else {
            voiceBtn.innerHTML = '🎤 Aktifkan Mikrofon';
            voiceBtn.style.background = '#3b49df';
        }
    }
}

// Initialize speech recognition on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initSpeechRecognition();
        initSpeechSynthesis();
        
        // Auto-announce voice directions are ready
        setTimeout(function() {
            if (voiceDirectionsEnabled) {
                speakText('Panduan suara aktif. Aplikasi siap digunakan.', 'id-ID', true);
            }
        }, 1000);
    });
} else {
    initSpeechRecognition();
    initSpeechSynthesis();
    
    // Auto-announce voice directions are ready
    setTimeout(function() {
        if (voiceDirectionsEnabled) {
            speakText('Panduan suara aktif. Aplikasi siap digunakan.', 'id-ID', true);
        }
    }, 1000);
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
            console.log('Speech started:', text);
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
        announcement = 'Rute ditemukan. ' + convertDistanceToIndonesian(info) + '. ';
    }
    
    // Read first 3 instructions in Google Maps style
    let validInstructions = [];
    for (let i = 0; i < instructionRows.length - 1; i++) {
        const instructionText = instructionRows[i].querySelector('.leaflet-routing-instruction-text');
        const instructionDistance = instructionRows[i].querySelector('.leaflet-routing-instruction-distance');
        
        if (instructionText) {
            let text = instructionText.textContent.trim();
            
            // Skip "Head" instructions
            if (text.toLowerCase().startsWith('head')) {
                continue;
            }
            
            const distance = instructionDistance ? instructionDistance.textContent.trim() : '';
            validInstructions.push({ text: text, distance: distance });
        }
    }
    
    // Announce first 3-4 instructions
    if (validInstructions.length > 0) {
        announcement += 'Petunjuk arah. ';
        
        for (let i = 0; i < Math.min(4, validInstructions.length); i++) {
            const inst = validInstructions[i];
            let instruction = convertInstructionToNatural(inst.text);
            
            // Add distance if available
            if (inst.distance && inst.distance !== '35 m' && inst.distance !== '0 m') {
                instruction += ' dalam ' + convertDistance(inst.distance);
            }
            
            if (i === 0) {
                announcement += instruction;
            } else {
                announcement += '. Kemudian, ' + instruction;
            }
        }
        
        announcement += '. ';
    }
    
    // Announce arrival message
    announcement += 'Anda akan tiba di tujuan.';
    
    // Callback to auto-restart microphone after route announcement
    function restartMicrophone() {
        console.log('Auto-restarting microphone...');
        setTimeout(function() {
            if (!isListening && recognition) {
                recognition.start();
                isListening = true;
                updateVoiceStatus('🎤 Siap mendengarkan. Ucapkan "Mulai" untuk memulai navigasi.');
                updateVoiceButton();
                speakText('Siap. Ucapkan "mulai" untuk memulai navigasi.', 'id-ID', true);
            }
        }, 500);
    }
    
    // Speak the announcement using browser's Web Speech API with priority and callback
    speakText(announcement, 'id-ID', priority, restartMicrophone);
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

// Convert instruction to natural Indonesian like Google Maps
function convertInstructionToNatural(text) {
    text = String(text || '');
    
    // Handle specific patterns
    const patterns = [
        { pattern: /^Turn right onto (.+)$/i, replacement: 'Belok kanan ke $1' },
        { pattern: /^Turn left onto (.+)$/i, replacement: 'Belok kiri ke $1' },
        { pattern: /^Go straight onto (.+)$/i, replacement: 'Lurus terus ke $1' },
        { pattern: /^Continue onto (.+)$/i, replacement: 'Lanjutkan ke $1' },
        { pattern: /^Make a sharp left$/i, replacement: 'Lakukan putaran tajam ke kiri' },
        { pattern: /^Make a slight right onto (.+)$/i, replacement: 'Lakukan sedikit ke kanan menuju $1' },
        { pattern: /^Keep left onto (.+)$/i, replacement: 'Tetap di kiri ke $1' },
        { pattern: /^Enter the traffic circle and take the (\w+) exit onto (.+)$/i, replacement: 'Masuk bundaran dan ambil exit $1 ke $2' },
        { pattern: /^Exit the traffic circle onto (.+)$/i, replacement: 'Keluar bundaran ke $1' },
        { pattern: /^Head (.+)$/i, replacement: 'Berangkat $1' },
        { pattern: /^You have arrived$/i, replacement: 'Anda telah tiba' },
        { pattern: /^You have arrived at your destination, on the (.+)$/i, replacement: 'Anda tiba di tujuan, di $1' }
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
    text = text.replace(/Continue/gi, 'Lanjutkan');
    text = text.replace(/straight/gi, 'lurus');
    text = text.replace(/onto/gi, 'ke');
    text = text.replace(/traffic circle/gi, 'bundaran');
    text = text.replace(/and take the/gi, 'dan ambil');
    text = text.replace(/exit/gi, 'keluar');
    
    return text;
}

// Function to speak turn-by-turn directions based on user position
function announceNextDirection() {
    if (!voiceDirectionsEnabled || !route) return;
    
    // This would ideally track the user's position along the route
    // and announce upcoming turns
    console.log('Checking for next direction...');
}
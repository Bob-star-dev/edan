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

// Destination point (fixed) - This can be changed to any destination
const latLngB = [3.58, 98.66];
const destinationMarker = L.marker(latLngB).addTo(map)
  .bindPopup("Destination");

// Route control - will be created after we get user's location
let route = null;

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
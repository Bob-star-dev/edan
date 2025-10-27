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
    
    if (statusEl) statusEl.textContent = 'Location found!';
    if (coordsEl) coordsEl.textContent = `Lat: ${e.latlng.lat.toFixed(6)}, Lng: ${e.latlng.lng.toFixed(6)}`;
    
    // Remove old position markers if they exist
    if (currentUserPosition) {
        map.removeLayer(currentUserPosition);
    }
    if (currentAccuracy) {
        map.removeLayer(currentAccuracy);
    }
    
    // Create accuracy circle
    const radius = e.accuracy / 2;
    currentAccuracy = L.circle(e.latlng, radius).addTo(map);
    
    // Create user position marker
    currentUserPosition = L.marker(e.latlng).addTo(map)
        .bindPopup("Your current location (accuracy: " + radius.toFixed(0) + "m)").openPopup();
    
    // Update route if route exists
    updateRoute(e.latlng);
}

// Function to handle location errors
function onLocationError(e) {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Location error: ' + e.message;
    
    // Use default location for testing if geolocation fails
    if (!currentUserPosition) {
        const defaultLatLng = { lat: 3.59, lng: 98.67 };
        currentUserPosition = L.marker([defaultLatLng.lat, defaultLatLng.lng]).addTo(map);
        updateRoute([defaultLatLng.lat, defaultLatLng.lng]);
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

// Function to locate user
function locate() {
    map.locate({
        setView: true,
        maxZoom: 16
    });
}

// Start locating user immediately
locate();

// Continue locating user every 3 seconds
setInterval(locate, 3000);
/**
 * Firebase Realtime Database Integration
 * Untuk monitoring ML results dan ESP32 status secara realtime
 */

// Firebase Configuration (sesuaikan dengan project Anda)
const firebaseConfig = {
  apiKey: "AIzaSyDrKWMsQvJgtgGRvE2FEHPTnpq7MrKLQTQ",
  authDomain: "senavision-id.firebaseapp.com",
  databaseURL: "https://senavision-id-default-rtdb.firebaseio.com",
  projectId: "senavision-id",
  storageBucket: "senavision-id.firebasestorage.app",
  messagingSenderId: "1073477417711",
  appId: "1:1073477417711:web:681c33a68733fc2b35391a",
  measurementId: "G-7HJF81K0GE"
};

// Firebase Realtime Database instance
let database = null;
let mlResultsRef = null;
let esp32StatusRef = null;

// State
const firebaseState = {
  initialized: false,
  connected: false,
  mlDirection: null,
  esp32Connected: false,
  esp32MotorState: null,
  listeners: {
    mlResults: null,
    esp32Status: null
  }
};

/**
 * Initialize Firebase Realtime Database
 */
async function initFirebaseRealtime() {
  if (firebaseState.initialized) {
    console.log('[Firebase Realtime] Already initialized');
    return;
  }

  try {
    // Load Firebase SDK dynamically
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js');
    const { getDatabase, ref, onValue, set, serverTimestamp, getAuth } = 
      await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');

    // Initialize Firebase App
    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    
    firebaseState.initialized = true;
    firebaseState.connected = true;
    
    console.log('[Firebase Realtime] ✅ Initialized successfully');
    
    // Setup listeners
    setupMLResultsListener();
    setupESP32StatusListener();
    
    return true;
  } catch (error) {
    console.error('[Firebase Realtime] ❌ Initialization failed:', error);
    firebaseState.initialized = false;
    firebaseState.connected = false;
    return false;
  }
}

/**
 * Setup listener untuk ML Results
 */
async function setupMLResultsListener() {
  if (!database) return;
  
  try {
    const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
    const { ref, onValue, off } = dbModule;
    const mlRef = ref(database, 'ml_results/direction');
    
    // Remove previous listener if exists
    if (firebaseState.listeners.mlResults) {
      off(mlRef, 'value', firebaseState.listeners.mlResults);
    }
    
    // Create new listener
    firebaseState.listeners.mlResults = onValue(mlRef, (snapshot) => {
      const direction = snapshot.val();
      if (direction && direction !== firebaseState.mlDirection) {
        firebaseState.mlDirection = direction;
        console.log(`[Firebase Realtime] 📡 ML Direction: ${direction}`);
        
        // Trigger custom event
        window.dispatchEvent(new CustomEvent('mlDirectionChanged', {
          detail: { direction }
        }));
        
        // Update UI if elements exist
        updateMLDirectionUI(direction);
      }
    }, (error) => {
      console.error('[Firebase Realtime] ❌ ML Results listener error:', error);
    });
    
    console.log('[Firebase Realtime] ✅ ML Results listener setup');
  } catch (error) {
    console.error('[Firebase Realtime] ❌ Failed to setup ML Results listener:', error);
  }
}

/**
 * Setup listener untuk ESP32 Status
 */
async function setupESP32StatusListener() {
  if (!database) return;
  
  try {
    const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
    const { ref, onValue, off } = dbModule;
    const statusRef = ref(database, 'esp32_status');
    
    // Remove previous listener if exists
    if (firebaseState.listeners.esp32Status) {
      off(statusRef, 'value', firebaseState.listeners.esp32Status);
    }
    
    // Create new listener
    firebaseState.listeners.esp32Status = onValue(statusRef, (snapshot) => {
      const status = snapshot.val();
      if (status) {
        firebaseState.esp32Connected = status.connected || false;
        firebaseState.esp32MotorState = status.motor_active || 'none';
        
        console.log(`[Firebase Realtime] 📡 ESP32 Status:`, status);
        
        // Trigger custom event
        window.dispatchEvent(new CustomEvent('esp32StatusChanged', {
          detail: { status }
        }));
        
        // Update UI if elements exist
        updateESP32StatusUI(status);
      }
    }, (error) => {
      console.error('[Firebase Realtime] ❌ ESP32 Status listener error:', error);
    });
    
    console.log('[Firebase Realtime] ✅ ESP32 Status listener setup');
  } catch (error) {
    console.error('[Firebase Realtime] ❌ Failed to setup ESP32 Status listener:', error);
  }
}

/**
 * Update ML Direction ke Firebase (dari ML processing)
 */
async function updateMLDirection(direction, confidence = null, objectDetected = null) {
  if (!database) {
    console.warn('[Firebase Realtime] Database not initialized');
    return false;
  }
  
  try {
    const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
    const { ref, set, serverTimestamp } = dbModule;
    const mlRef = ref(database, 'ml_results');
    
    const data = {
      direction: direction, // 'left', 'right', 'both', 'stop', 'none'
      timestamp: Date.now(),
      confidence: confidence || 0,
      object_detected: objectDetected || 'none'
    };
    
    await set(mlRef, data);
    console.log(`[Firebase Realtime] ✅ ML Direction updated: ${direction}`);
    return true;
  } catch (error) {
    console.error('[Firebase Realtime] ❌ Failed to update ML direction:', error);
    return false;
  }
}

/**
 * Update UI untuk ML Direction
 */
function updateMLDirectionUI(direction) {
  const directionElement = document.getElementById('ml-direction-display');
  if (directionElement) {
    directionElement.textContent = `Direction: ${direction}`;
    
    // Update styling based on direction
    directionElement.className = `ml-direction ml-direction-${direction}`;
    
    // Add icons
    const icon = direction === 'left' ? '⬅️' : 
                 direction === 'right' ? '➡️' : 
                 direction === 'both' ? '📳' : '⏹️';
    directionElement.innerHTML = `${icon} ${direction.toUpperCase()}`;
  }
}

/**
 * Update UI untuk ESP32 Status
 */
function updateESP32StatusUI(status) {
  const statusElement = document.getElementById('esp32-status-display');
  if (statusElement) {
    const isConnected = status.connected || false;
    const motorState = status.motor_active || 'none';
    const ipAddress = status.ip_address || 'N/A';
    
    statusElement.innerHTML = `
      <div class="esp32-status-item">
        <span class="status-indicator ${isConnected ? 'connected' : 'disconnected'}"></span>
        <span>ESP32: ${isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div class="esp32-status-item">
        <span>Motor: ${motorState}</span>
      </div>
      <div class="esp32-status-item">
        <span>IP: ${ipAddress}</span>
      </div>
    `;
  }
}

/**
 * Get current ML Direction
 */
function getMLDirection() {
  return firebaseState.mlDirection;
}

/**
 * Get current ESP32 Status
 */
function getESP32Status() {
  return {
    connected: firebaseState.esp32Connected,
    motorState: firebaseState.esp32MotorState
  };
}

/**
 * Cleanup listeners
 */
async function cleanupFirebaseListeners() {
  if (!database) return;
  
  try {
    const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
    const { ref, off } = dbModule;
    
    if (firebaseState.listeners.mlResults) {
      const mlRef = ref(database, 'ml_results/direction');
      off(mlRef, 'value', firebaseState.listeners.mlResults);
      firebaseState.listeners.mlResults = null;
    }
    
    if (firebaseState.listeners.esp32Status) {
      const statusRef = ref(database, 'esp32_status');
      off(statusRef, 'value', firebaseState.listeners.esp32Status);
      firebaseState.listeners.esp32Status = null;
    }
    
    console.log('[Firebase Realtime] ✅ Listeners cleaned up');
  } catch (error) {
    console.error('[Firebase Realtime] ❌ Failed to cleanup listeners:', error);
  }
}

// Expose functions globally
if (typeof window !== 'undefined') {
  window.initFirebaseRealtime = initFirebaseRealtime;
  window.updateMLDirection = updateMLDirection;
  window.getMLDirection = getMLDirection;
  window.getESP32Status = getESP32Status;
  window.cleanupFirebaseListeners = cleanupFirebaseListeners;
  window.firebaseRealtimeState = firebaseState;
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initFirebaseRealtime();
    });
  } else {
    initFirebaseRealtime();
  }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initFirebaseRealtime,
    updateMLDirection,
    getMLDirection,
    getESP32Status,
    cleanupFirebaseListeners,
    firebaseState
  };
}


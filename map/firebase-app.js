// Firebase App bootstrap for map pages
// NOTE: Fill in your Firebase config below. Keep this file small and focused.
// This file exposes minimal globals used by map/index.js without refactoring that file.

// --- Firebase v10 modular CDN imports (ESM) ---
// Loaded via dynamic import to avoid breaking non-module scripts in map.html

(function() {
  const firebaseCdnBase = 'https://www.gstatic.com/firebasejs/10.12.4';

  const config = {
    apiKey: "AIzaSyDrKWMsQvJgtgGRvE2FEHPTnpq7MrKLQTQ",
    authDomain: "senavision-id.firebaseapp.com",
    projectId: "senavision-id",
    storageBucket: "senavision-id.firebasestorage.app",
    messagingSenderId: "1073477417711",
    appId: "1:1073477417711:web:681c33a68733fc2b35391a",
    measurementId: "G-7HJF81K0GE"
  };

  let app, auth, db, rtdb, googleProvider, currentUser = null;
  let vibrationListener = null;
  let reconnectTimer = null;
  const RECONNECT_DELAY = 5000; // 5 seconds

  async function initFirebaseIfNeeded() {
    if (app) return;
    const [{ initializeApp }, { getAuth, onAuthStateChanged, GoogleAuthProvider }, { getFirestore }, { getDatabase } ] = await Promise.all([
      import(`${firebaseCdnBase}/firebase-app.js`),
      import(`${firebaseCdnBase}/firebase-auth.js`),
      import(`${firebaseCdnBase}/firebase-firestore.js`),
      import(`${firebaseCdnBase}/firebase-database.js`)
    ]);

    if (!config || !config.apiKey) {
      console.warn('[Firebase] Missing config. Please set your Firebase config in map/firebase-app.js');
    }

    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    
    // Initialize Realtime Database with custom host
    const databaseURL = 'https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app';
    rtdb = getDatabase(app, databaseURL);
    googleProvider = new GoogleAuthProvider();

    onAuthStateChanged(auth, (user) => {
      currentUser = user || null;
      if (window.__onAuthReadyCallbacks) {
        window.__onAuthReadyCallbacks.forEach(cb => {
          try { cb(user); } catch (_) {}
        });
        window.__onAuthReadyCallbacks = [];
      }
    });

    // Expose minimal globals
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseRTDB = rtdb;
    window.firebaseGoogleProvider = googleProvider;
  }

  // Public: wait for auth ready
  window.onAuthReady = function(callback) {
    if (typeof callback !== 'function') return;
    if (!window.__onAuthReadyCallbacks) window.__onAuthReadyCallbacks = [];
    window.__onAuthReadyCallbacks.push(callback);
    initFirebaseIfNeeded();
  };

  // Public: ensure user logged-in; redirect to /login.html if not
  window.requireAuth = function() {
    initFirebaseIfNeeded();
    const check = () => {
      if (!currentUser) {
        window.location.href = '/login.html';
      }
    };
    if (currentUser !== null) {
      check();
    } else {
      // Wait for first auth event
      window.onAuthReady(() => check());
    }
  };

  // Public: save route change to Firestore under users/{uid}
  window.saveUserRouteUpdate = async function(routeUpdate) {
    try {
      await initFirebaseIfNeeded();
      if (!window.firebaseDB || !window.firebaseAuth || !window.firebaseAuth.currentUser) return;
      const [{ doc, setDoc, serverTimestamp, collection, addDoc, updateDoc }] = await Promise.all([
        import(`${firebaseCdnBase}/firebase-firestore.js`)
      ]);

      const uid = window.firebaseAuth.currentUser.uid;
      const userRef = doc(window.firebaseDB, 'users', uid);

      // Ensure user document exists, update lastActive
      await setDoc(userRef, {
        uid,
        lastActive: serverTimestamp()
      }, { merge: true });

      // Append to routes history subcollection for realtime log
      const routesCol = collection(window.firebaseDB, 'users', uid, 'routes');
      const payload = Object.assign({}, routeUpdate, { createdAt: serverTimestamp() });
      await addDoc(routesCol, payload);

      // Also store latest snapshot on user doc for quick access
      await updateDoc(userRef, {
        latestRoute: payload
      });
    } catch (err) {
      console.warn('[Firebase] Failed to save route update:', err);
    }
  };

  // Public: save the 6 saved routes (array) under users/{uid}.savedRoutes
  window.saveUserSavedRoutes = async function(savedRoutesArray) {
    try {
      await initFirebaseIfNeeded();
      if (!window.firebaseDB || !window.firebaseAuth || !window.firebaseAuth.currentUser) return;
      const [{ doc, setDoc, updateDoc }] = await Promise.all([
        import(`${firebaseCdnBase}/firebase-firestore.js`)
      ]);
      const uid = window.firebaseAuth.currentUser.uid;
      const userRef = doc(window.firebaseDB, 'users', uid);
      // Ensure document exists and update savedRoutes atomically
      await setDoc(userRef, { savedRoutes: savedRoutesArray || [] }, { merge: true });
    } catch (err) {
      console.warn('[Firebase] Failed to save savedRoutes:', err);
    }
  };

  // Public: load saved routes from users/{uid}.savedRoutes
  window.loadUserSavedRoutes = async function() {
    try {
      await initFirebaseIfNeeded();
      if (!window.firebaseDB || !window.firebaseAuth || !window.firebaseAuth.currentUser) return null;
      const [{ doc, getDoc }] = await Promise.all([
        import(`${firebaseCdnBase}/firebase-firestore.js`)
      ]);
      const uid = window.firebaseAuth.currentUser.uid;
      const userRef = doc(window.firebaseDB, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        return Array.isArray(data.savedRoutes) ? data.savedRoutes : null;
      }
      return null;
    } catch (err) {
      console.warn('[Firebase] Failed to load savedRoutes:', err);
      return null;
    }
  };

  // Public: Initialize vibration control with Firebase Realtime Database
  window.initVibrationControl = async function() {
    try {
      await initFirebaseIfNeeded();
      if (!rtdb) {
        console.error('[Vibration] Realtime Database not initialized');
        return false;
      }

      const { ref, onValue, set } = await import(`${firebaseCdnBase}/firebase-database.js`);
      
      // Reference to vibration/side path
      const vibrationSideRef = ref(rtdb, 'vibration/side');
      
      // Function to control GPIO pins
      const controlGPIO = async (side) => {
        try {
          const gpio12Ref = ref(rtdb, 'vibration/gpio12');
          const gpio13Ref = ref(rtdb, 'vibration/gpio13');
          
          let gpio12State = false;
          let gpio13State = false;
          
          if (side === 'left') {
            gpio12State = true;  // HIGH
            gpio13State = false; // LOW
            console.log('[Vibration] Left: GPIO12 HIGH, GPIO13 LOW');
          } else if (side === 'right') {
            gpio12State = false; // LOW
            gpio13State = true;  // HIGH
            console.log('[Vibration] Right: GPIO12 LOW, GPIO13 HIGH');
          } else if (side === 'stop') {
            gpio12State = false; // LOW
            gpio13State = false; // LOW
            console.log('[Vibration] Stop: GPIO12 LOW, GPIO13 LOW');
          }
          
          // Write GPIO states to Firebase
          await Promise.all([
            set(gpio12Ref, gpio12State),
            set(gpio13Ref, gpio13State)
          ]);
          
          console.log(`[Vibration] ✅ GPIO states updated: GPIO12=${gpio12State}, GPIO13=${gpio13State}`);
        } catch (error) {
          console.error('[Vibration] ❌ Error controlling GPIO:', error);
        }
      };
      
      // Listen for changes in vibration/side
      const handleValueChange = (snapshot) => {
        const value = snapshot.val();
        if (value && typeof value === 'string') {
          const side = value.toLowerCase().trim();
          console.log('[Vibration] 📡 Received vibration side:', side);
          controlGPIO(side);
        }
      };
      
      // Set up listener (onValue returns an unsubscribe function)
      const unsubscribe = onValue(vibrationSideRef, handleValueChange, (error) => {
        console.error('[Vibration] ❌ Error reading vibration/side:', error);
        // Schedule reconnect
        scheduleReconnect();
      });
      
      vibrationListener = { ref: vibrationSideRef, handler: handleValueChange, unsubscribe: unsubscribe };
      
      // Set up disconnect handler for automatic reconnect
      const setupDisconnectHandler = async () => {
        try {
          const connectedRef = ref(rtdb, '.info/connected');
          onValue(connectedRef, (snapshot) => {
            const connected = snapshot.val();
            if (connected === false) {
              console.warn('[Vibration] ⚠️ Firebase Realtime Database disconnected');
              scheduleReconnect();
            } else if (connected === true) {
              console.log('[Vibration] ✅ Firebase Realtime Database connected');
              if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
              }
            }
          });
        } catch (error) {
          console.error('[Vibration] Error setting up disconnect handler:', error);
        }
      };
      
      setupDisconnectHandler();
      
      console.log('[Vibration] ✅ Vibration control initialized');
      return true;
    } catch (error) {
      console.error('[Vibration] ❌ Failed to initialize vibration control:', error);
      scheduleReconnect();
      return false;
    }
  };
  
  // Function to schedule reconnection
  function scheduleReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    console.log(`[Vibration] ⏳ Scheduling reconnect in ${RECONNECT_DELAY}ms...`);
    reconnectTimer = setTimeout(async () => {
      console.log('[Vibration] 🔄 Attempting to reconnect...');
      // Remove old listener if exists
      if (vibrationListener && vibrationListener.unsubscribe) {
        try {
          vibrationListener.unsubscribe();
        } catch (error) {
          console.warn('[Vibration] Error removing old listener:', error);
        }
        vibrationListener = null;
      }
      // Reinitialize
      await window.initVibrationControl();
    }, RECONNECT_DELAY);
  }
  
  // Public: Stop vibration control
  window.stopVibrationControl = async function() {
    if (vibrationListener && vibrationListener.unsubscribe) {
      try {
        vibrationListener.unsubscribe();
        vibrationListener = null;
        console.log('[Vibration] ✅ Vibration control stopped');
      } catch (error) {
        console.error('[Vibration] Error stopping vibration control:', error);
      }
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
})();



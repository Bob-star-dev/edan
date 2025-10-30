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

  let app, auth, db, googleProvider, currentUser = null;

  async function initFirebaseIfNeeded() {
    if (app) return;
    const [{ initializeApp }, { getAuth, onAuthStateChanged, GoogleAuthProvider }, { getFirestore } ] = await Promise.all([
      import(`${firebaseCdnBase}/firebase-app.js`),
      import(`${firebaseCdnBase}/firebase-auth.js`),
      import(`${firebaseCdnBase}/firebase-firestore.js`)
    ]);

    if (!config || !config.apiKey) {
      console.warn('[Firebase] Missing config. Please set your Firebase config in map/firebase-app.js');
    }

    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
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
})();



// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDrKWMsQvJgtgGRvE2FEHPTnpq7MrKLQTQ",
  authDomain: "senavision-id.firebaseapp.com",
  databaseURL: "https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "senavision-id",
  storageBucket: "senavision-id.firebasestorage.app",
  messagingSenderId: "1073477417711",
  appId: "1:1073477417711:web:681c33a68733fc2b35391a",
  measurementId: "G-7HJF81K0GE"
};

// Initialize Firebase
let app, database;

async function initFirebase() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js');
    const { getDatabase } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');

    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    
    console.log('✅ Firebase initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    return false;
  }
}

// Export for use in app.js
window.initFirebase = initFirebase;
window.getFirebaseDatabase = () => database;


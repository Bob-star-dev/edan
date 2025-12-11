// Initialize Firebase when page loads
let database = null;
let navModeRef = null;
let isActive = false;

// Initialize Firebase and setup listeners
async function init() {
  // Initialize Firebase
  await window.initFirebase();
  database = window.getFirebaseDatabase();
  
  if (!database) {
    console.error('❌ Database not initialized');
    updateStatus('error', 'Gagal menginisialisasi Firebase');
    return;
  }

  // Import Firebase Database functions
  const { ref, set, onValue } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
  
  // Setup reference to navigation mode
  navModeRef = ref(database, '/navigation/mode');
  
  // Listen to changes in navigation mode
  onValue(navModeRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      isActive = data.active || false;
      const timestamp = data.timestamp || 0;
      
      updateStatus(isActive ? 'active' : 'inactive', isActive ? 'AKTIF' : 'TIDAK AKTIF', timestamp);
      updateButton();
    } else {
      // No data yet - default to inactive
      isActive = false;
      updateStatus('inactive', 'TIDAK AKTIF', null);
      updateButton();
    }
  }, (error) => {
    console.error('❌ Error listening to navigation mode:', error);
    updateStatus('error', 'Error membaca status');
  });
}

// Toggle navigation mode
async function toggleNavigationMode() {
  if (!database || !navModeRef) {
    console.error('❌ Database not initialized');
    alert('Firebase belum terinisialisasi. Silakan refresh halaman.');
    return;
  }

  const { set } = await import('https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js');
  
  // Toggle: if currently active, set to false; if inactive, set to true
  const newActive = !isActive;
  
  const data = {
    active: newActive,
    timestamp: Date.now()
  };

  try {
    // Disable button during update
    const btn = document.getElementById('navModeBtn');
    btn.disabled = true;
    btn.classList.add('loading');
    
    await set(navModeRef, data);
    
    console.log(`✅ Navigation mode set to: ${newActive ? 'ACTIVE' : 'INACTIVE'}`);
    console.log('📤 Data sent:', data);
    
    // Button will be re-enabled by updateButton() when status updates
  } catch (error) {
    console.error('❌ Failed to set navigation mode:', error);
    alert('Gagal mengubah navigation mode: ' + error.message);
    
    // Re-enable button on error
    const btn = document.getElementById('navModeBtn');
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// Update status display
function updateStatus(status, text, timestamp) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const timestampEl = document.getElementById('timestamp');
  
  // Remove all status classes
  statusDot.className = 'status-dot';
  statusText.textContent = text;
  
  if (status === 'active') {
    statusDot.classList.add('active');
    statusText.textContent = 'AKTIF';
  } else if (status === 'inactive') {
    statusDot.classList.add('inactive');
    statusText.textContent = 'TIDAK AKTIF';
  } else if (status === 'error') {
    statusDot.classList.add('error');
    statusText.textContent = text;
  }
  
  // Update timestamp
  if (timestamp) {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    timestampEl.textContent = `Terakhir diupdate: ${timeStr}`;
  } else {
    timestampEl.textContent = '-';
  }
}

// Update button state
function updateButton() {
  const btn = document.getElementById('navModeBtn');
  const btnText = btn.querySelector('.button-text');
  
  btn.disabled = false;
  btn.classList.remove('loading');
  
  if (isActive) {
    btn.classList.add('active');
    btnText.textContent = 'Nonaktifkan Navigation Mode';
  } else {
    btn.classList.remove('active');
    btnText.textContent = 'Aktifkan Mode Navigation';
  }
}

// Make toggleNavigationMode available globally
window.toggleNavigationMode = toggleNavigationMode;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


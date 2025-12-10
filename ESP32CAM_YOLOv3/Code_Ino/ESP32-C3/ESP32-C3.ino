// ============================================================================
// ESP32-C3 VIBRATOR - Firebase Realtime Database Version
// ============================================================================

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/RTDBHelper.h"
// Removed WebServer and mDNS to save memory - communication via Firebase only

// ======================
// WIFI CREDENTIALS
// ======================
const char* WIFI_SSID = "senavision";
const char* WIFI_PASS = "senavision331";
// HOSTNAME removed - mDNS not needed (communication via Firebase only)
 
// ======================
// FIREBASE CONFIGURATION
// ======================
#define DATABASE_URL "https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app/"
#define DATABASE_LEGACY_TOKEN "cY0AwFCw41qXIab0t3f4lU2P4exj376pxAiiDe6J"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ======================
// FIREBASE POLLING (instead of Stream - ESP32-C3 single core compatible)
// ======================
String navigationModePath = "/navigation/mode";
String detectionPath = "/detection/object";
unsigned long lastVibrateTime = 0;
unsigned long lastPollTime = 0;
unsigned long lastNavModeCheck = 0;
bool navigationModeActive = false;
#define VIBRATE_DEBOUNCE_MS 500  // Debounce 500ms
#define POLL_INTERVAL_MS 200     // Poll every 200ms
#define NAV_MODE_CHECK_INTERVAL_MS 1000  // Check navigation mode every 1 second

// ======================
// IP CONFIGURATION
// ======================
// OPSI 1: DHCP (Recommended untuk Hotspot HP) - Set USE_STATIC_IP = false
// OPSI 2: Static IP - Set USE_STATIC_IP = true dan sesuaikan IP sesuai hotspot HP
// 
// IP Range Hotspot HP:
// - Android: 192.168.43.x (gateway: 192.168.43.1)
// - iPhone: 172.20.10.x (gateway: 172.20.10.1)
// - Beberapa Android: 192.168.137.x (gateway: 192.168.137.1)
//
#define USE_STATIC_IP false  // Set true untuk menggunakan IP static, false untuk DHCP

#if USE_STATIC_IP
  // Konfigurasi IP Static (sesuaikan dengan hotspot HP Anda)
  // Untuk Android hotspot: gunakan 192.168.43.x
  IPAddress local_IP(192, 168, 43, 27);      // IP ESP32-C3
  IPAddress gateway(192, 168, 43, 1);        // Gateway hotspot Android
  IPAddress subnet(255, 255, 255, 0);
  IPAddress primaryDNS(8, 8, 8, 8);
  IPAddress secondaryDNS(8, 8, 4, 4);
#else
  // DHCP Mode - IP akan otomatis dari hotspot HP
  // Lebih mudah dan fleksibel, tidak perlu konfigurasi manual
#endif

// ======================
// PIN VIBRATOR
// ======================
#define VIB_LEFT 4
#define VIB_RIGHT 5

// ======================
// DURASI VIBRATE (ms)
// ======================
#define VIBRATE_DURATION 250

// ===========================================================================
// FUNGSI VIBRATE
// ===========================================================================
void vibrateLeft() {
  digitalWrite(VIB_LEFT, HIGH);
  delay(VIBRATE_DURATION);
  digitalWrite(VIB_LEFT, LOW);
}

void vibrateRight() {
  digitalWrite(VIB_RIGHT, HIGH);
  delay(VIBRATE_DURATION);
  digitalWrite(VIB_RIGHT, LOW);
}

// ===========================================================================
// CHECK NAVIGATION MODE (untuk tahu kapan harus aktif)
// ESP32-C3 standby check navigation mode dari web
// ===========================================================================
void checkNavigationMode() {
  FirebaseJson json;
  
  // Get navigation mode from Firebase (set by web app)
  if (Firebase.RTDB.getJSON(&fbdo, navigationModePath))
  {
    // Check if data exists (path might be null/empty)
    if (fbdo.dataType() == "json")
    {
      json = fbdo.jsonObject();
      FirebaseJsonData jsonData;
      
      // Get active status
      if (json.get(jsonData, "active"))
      {
        bool newMode = jsonData.boolValue;
        
        if (newMode != navigationModeActive)
        {
          navigationModeActive = newMode;
          
          if (navigationModeActive)
          {
            Serial.println("========================================");
            Serial.println("🧭 Navigation mode: ACTIVE");
            Serial.println("✅ Web sudah masuk mode navigasi");
            Serial.println("🔄 ESP32-C3 sekarang membaca data detection dari ESP32CAM");
            Serial.println("📳 Siap menerima vibrate signal");
            Serial.println("========================================");
          }
          else
          {
            Serial.println("========================================");
            Serial.println("🧭 Navigation mode: INACTIVE");
            Serial.println("⏸️  Web belum masuk mode navigasi");
            Serial.println("💤 ESP32-C3 standby - tidak membaca detection");
            Serial.println("⏳ Menunggu web aktifkan navigation mode...");
            Serial.println("========================================");
          }
        }
      }
      else
      {
        // Path exists but "active" field not found - set default to false
        if (navigationModeActive) {
          navigationModeActive = false;
          Serial.println("🧭 Navigation mode: INACTIVE (no active field in Firebase)");
        }
      }
    }
    else if (fbdo.dataType() == "null")
    {
      // Path doesn't exist yet - this is normal, web hasn't set it
      if (navigationModeActive) {
        navigationModeActive = false;
      }
      
      // Log only once to avoid spam
      static bool loggedNull = false;
      if (!loggedNull) {
        loggedNull = true;
        Serial.println("ℹ️ Navigation mode path is empty (web hasn't set it yet) - Default: INACTIVE");
        Serial.println("💡 This is normal - web will set navigation mode when user starts navigation");
      }
    }
  }
  else
  {
    // Error reading from Firebase
    static unsigned long lastErrorLog = 0;
    unsigned long now = millis();
    if (now - lastErrorLog > 10000) {  // Log error setiap 10 detik
      lastErrorLog = now;
      Serial.print("⚠️ Failed to read navigation mode from Firebase: ");
      Serial.print(fbdo.errorReason());
      Serial.print(" (Error code: ");
      Serial.print(fbdo.errorCode());
      Serial.println(")");
      Serial.println("💡 Check Firebase connection and database rules");
    }
  }
}

// ===========================================================================
// FIREBASE POLLING (untuk listen detection data - ESP32-C3 compatible)
// Hanya membaca detection data jika navigation mode aktif
// ===========================================================================
void checkDetectionData() {
  // Only check detection if navigation mode is active
  if (!navigationModeActive)
  {
    // Navigation mode belum aktif - tidak baca detection
    return; // Skip if navigation not active
  }
  
  // ===========================================================================
  // STEP 4: BACA DETECTION OBJECT DARI FIREBASE
  // ===========================================================================
  // Navigation mode aktif - baca detection data dari ESP32CAM
  
  FirebaseJson json;
  
  // Get detection data from Firebase
  if (Firebase.RTDB.getJSON(&fbdo, detectionPath))
  {
    json = fbdo.jsonObject();
    FirebaseJsonData jsonData;
    
    // Get side (left/right)
    if (json.get(jsonData, "side"))
    {
      String side = jsonData.stringValue;
      bool active = false;
      float distance = 0.0;
      String objectName = "";
      
      // Get active status
      if (json.get(jsonData, "active"))
      {
        active = jsonData.boolValue;
      }
      
      // Get distance
      if (json.get(jsonData, "distance"))
      {
        distance = jsonData.floatValue;
      }
      
      // Get object name
      if (json.get(jsonData, "object"))
      {
        objectName = jsonData.stringValue;
      }
      
      // ===========================================================================
      // STEP 5: CEK APAKAH ADA OBJECT DAN SISI (KIRI/KANAN)
      // ===========================================================================
      if (active)
      {
        unsigned long now = millis();
        if (now - lastVibrateTime > VIBRATE_DEBOUNCE_MS)
        {
          lastVibrateTime = now;
          
          Serial.print("📳 Detection: ");
          Serial.print(side);
          Serial.print(" - ");
          Serial.print(distance);
          Serial.print("m - ");
          Serial.println(objectName);
          
          // ===========================================================================
          // STEP 6: VIBRATE BERDASARKAN SISI
          // ===========================================================================
          if (side == "left")
          {
            // Object di kiri → vibrate kiri
            vibrateLeft();
            Serial.println("✅ LEFT vibrator activated (object detected on LEFT)");
          }
          else if (side == "right")
          {
            // Object di kanan → vibrate kanan
            vibrateRight();
            Serial.println("✅ RIGHT vibrator activated (object detected on RIGHT)");
          }
        }
      }
    }
  }
}

// ===========================================================================
// FIREBASE INITIALIZATION
// ===========================================================================
void initFirebase() {
  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = DATABASE_LEGACY_TOKEN;
  
  Firebase.reconnectWiFi(true);
  
  Serial.print("Connecting to Firebase...");
  Firebase.begin(&config, &auth);
  
  // Wait for connection
  int firebaseAttempts = 0;
  while (!Firebase.ready() && firebaseAttempts < 10) {
    delay(500);
    Serial.print(".");
    firebaseAttempts++;
  }
  
  if (Firebase.ready()) {
    Serial.println(" OK");
  
  // Set status online
    if (Firebase.RTDB.setBool(&fbdo, "/esp32c3/online", true)) {
      Serial.println("Status set to online");
    } else {
      Serial.print("Failed to set status: ");
      Serial.println(fbdo.errorReason());
    }
    
    if (Firebase.RTDB.setString(&fbdo, "/esp32c3/ip", WiFi.localIP().toString())) {
      Serial.print("IP saved: ");
      Serial.println(WiFi.localIP());
    }
  
  // Start polling for navigation mode and detection data (ESP32-C3 compatible - no stream)
    Serial.println("Using polling mode (ESP32-C3 compatible)");
    Serial.println("========================================");
    Serial.println("📡 ESP32-C3 Status:");
    Serial.println("  - Polling navigation mode: every 1s");
    Serial.println("  - Polling detection data: every 200ms (only when navigation active)");
    Serial.println("========================================");
    Serial.println("💤 ESP32-C3 sekarang STANDBY");
    Serial.println("⏳ Menunggu web masuk mode navigasi...");
    Serial.println("💡 Setelah web aktifkan navigation mode:");
    Serial.println("   → ESP32-C3 akan otomatis baca detection dari ESP32CAM");
    Serial.println("   → ESP32-C3 akan vibrate jika ada object terdeteksi");
    Serial.println("========================================");
  } else {
    Serial.println(" FAILED");
    Serial.print("Error: ");
    Serial.println(fbdo.errorReason());
  }
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  // CRITICAL: ESP32-C3 dengan USB-Serial/JTAG butuh delay lebih lama
  // Start Serial immediately - don't wait for Serial Monitor
  Serial.begin(115200);
  
  // CRITICAL: ESP32-C3 USB-Serial/JTAG - don't wait for Serial.available()
  // Just delay to let Serial Monitor connect, but continue anyway
  delay(3000);  // 3 second delay untuk Serial Monitor connect
  
  // Force output immediately - ESP32-C3 akan output meskipun Serial Monitor belum buka
  Serial.print("\n\n\n\n\n\n\n\n");
  Serial.println("========================================");
  Serial.println("ESP32-C3 Vibrator Starting...");
  Serial.println("========================================");
  Serial.println("USB-Serial/JTAG Mode");
  Serial.print("Uptime: ");
  Serial.print(millis());
  Serial.println(" ms");
  Serial.println("========================================");
  Serial.flush();
  
  // Additional flush and delay
  delay(500);
  Serial.println("Serial Monitor: OK");
  Serial.flush();

  // Setup pins
  pinMode(VIB_LEFT, OUTPUT);
  pinMode(VIB_RIGHT, OUTPUT);
  digitalWrite(VIB_LEFT, LOW);
  digitalWrite(VIB_RIGHT, LOW);
  Serial.println("Pins initialized");
  
  // Configure WiFi
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  
  // Enable WiFi debug output to Serial
  Serial.setDebugOutput(true);
  
  #if USE_STATIC_IP
    Serial.println("Using static IP");
    WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);
  #else
    Serial.println("Using DHCP");
  #endif

  // Scan for available WiFi networks first (for debugging)
  Serial.println("\nScanning for WiFi networks...");
  Serial.println("(Note: If hotspot not found, ESP32-C3 will still try to connect)");
  int n = WiFi.scanNetworks();
  if (n == 0) {
    Serial.println("No networks found in scan!");
    Serial.println("(This is OK - hotspot might not be active yet, will try to connect anyway)");
  } else {
    Serial.print(n);
    Serial.println(" networks found:");
    bool ssidFound = false;
    for (int i = 0; i < n; ++i) {
      Serial.print("  ");
      Serial.print(i + 1);
      Serial.print(": ");
      Serial.print(WiFi.SSID(i));
      Serial.print(" (");
      Serial.print(WiFi.RSSI(i));
      Serial.println(" dBm)");
      if (WiFi.SSID(i) == WIFI_SSID) {
        ssidFound = true;
        Serial.print("  ✅ Found target SSID: ");
        Serial.print(WIFI_SSID);
        Serial.print(" (Signal: ");
        Serial.print(WiFi.RSSI(i));
        Serial.println(" dBm)");
      }
    }
    if (!ssidFound) {
      Serial.print("  ⚠️ SSID '");
      Serial.print(WIFI_SSID);
      Serial.println("' NOT FOUND in scan!");
      Serial.println("  💡 Don't worry - will still try to connect (hotspot might activate later)");
    }
  }
  Serial.println();
  
  // ===========================================================================
  // STEP 1: CONNECT TO WIFI (LOOP SAMPAI CONNECT)
  // ===========================================================================
  Serial.println("========================================");
  Serial.println("STEP 1: Connecting to WiFi");
  Serial.println("========================================");
  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);
  Serial.print("Password: ");
  Serial.println(WIFI_PASS);
  Serial.println("Frequency: 2.4GHz");
  Serial.println("----------------------------------------");
  Serial.println("🔄 Looping until WiFi connected...");
  Serial.println();
  
  // Disconnect first to ensure clean state
  WiFi.disconnect(true);
  delay(1000);
  
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int wifiAttempts = 0;
  wl_status_t lastStatus = WiFi.status();
  bool wifiConnected = false;
  
  // LOOP SAMPAI WIFI CONNECT - tidak ada timeout, akan terus loop
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    wl_status_t currentStatus = WiFi.status();
    
    // Print status changes
    if (currentStatus != lastStatus) {
      Serial.print("[WiFi Status: ");
      switch(currentStatus) {
        case WL_IDLE_STATUS: Serial.print("IDLE"); break;
        case WL_NO_SSID_AVAIL: Serial.print("NO_SSID_AVAIL"); break;
        case WL_SCAN_COMPLETED: Serial.print("SCAN_COMPLETED"); break;
        case WL_CONNECTED: Serial.print("CONNECTED"); break;
        case WL_CONNECT_FAILED: Serial.print("CONNECT_FAILED"); break;
        case WL_CONNECTION_LOST: Serial.print("CONNECTION_LOST"); break;
        case WL_DISCONNECTED: Serial.print("DISCONNECTED"); break;
        default: Serial.print("UNKNOWN("); Serial.print(currentStatus); Serial.print(")"); break;
      }
      Serial.println("]");
      lastStatus = currentStatus;
    }
    
    Serial.print(".");
    wifiAttempts++;
    
    // Print progress every 20 attempts (10 seconds)
    if (wifiAttempts % 20 == 0) {
      Serial.print(" (");
      Serial.print(wifiAttempts * 500 / 1000);
      Serial.println("s)");
    }
    
    // Retry connection every 60 attempts (30 seconds) if still not connected
    if (wifiAttempts % 60 == 0 && wifiAttempts > 0) {
      Serial.println("\n[WiFi] Retrying connection...");
      WiFi.disconnect(true);
      delay(1000);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
  }
  
  wifiConnected = true;
  
  if (wifiConnected && WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅✅✅ WiFi CONNECTED!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("Subnet: ");
    Serial.println(WiFi.subnetMask());
    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.println("========================================");
    
    // ===========================================================================
    // STEP 2: CONNECT TO FIREBASE (LANGSUNG SETELAH WIFI CONNECT)
    // ===========================================================================
    Serial.println("STEP 2: Connecting to Firebase");
    Serial.println("========================================");
    initFirebase();
    
    if (Firebase.ready()) {
      Serial.println("========================================");
      Serial.println("✅✅✅ Firebase CONNECTED!");
      Serial.println("========================================");
      Serial.println("📡 ESP32-C3 siap membaca data dari Firebase");
      Serial.println("========================================");
    } else {
      Serial.println("========================================");
      Serial.println("❌ Firebase connection failed!");
      Serial.println("Will retry in loop...");
      Serial.println("========================================");
    }
  } else {
    Serial.println("\n❌ WiFi connection failed!");
    Serial.print("Status code: ");
    Serial.println(WiFi.status());
    Serial.println("Will retry in loop...");
  }
  
  Serial.println("\n========================================");
  Serial.println("Setup complete!");
  Serial.println("Ready to receive vibrate signals from Firebase");
  Serial.print("Total setup time: ");
  Serial.print(millis() / 1000);
  Serial.println(" seconds");
  Serial.println("========================================\n");
  Serial.flush();
}

// ===========================================================================
// LOOP
// ===========================================================================
void loop() {
  static unsigned long lastStatusPrint = 0;
  static unsigned long lastWiFiCheck = 0;
  static bool firstLoop = true;
  static bool firebaseInitialized = false;  // Track Firebase initialization
  
  unsigned long now = millis();
  
  // Print first loop message immediately
  if (firstLoop) {
    firstLoop = false;
    Serial.println("\n[LOOP] ✅ Loop started - ESP32-C3 is running!");
    Serial.flush();
  }
  
  // Initialize Firebase if WiFi is connected but Firebase not initialized yet
  if (WiFi.status() == WL_CONNECTED && !firebaseInitialized && !Firebase.ready()) {
    Serial.println("\n[Firebase] WiFi connected - Initializing Firebase...");
    initFirebase();
    if (Firebase.ready()) {
      firebaseInitialized = true;
      Serial.println("[Firebase] ✅ Firebase initialized successfully!");
    } else {
      Serial.println("[Firebase] ⚠️ Firebase initialization failed, will retry...");
    }
  }
  
  // Reset Firebase flag if WiFi disconnected
  if (WiFi.status() != WL_CONNECTED && firebaseInitialized) {
    firebaseInitialized = false;
    Serial.println("[Firebase] ⚠️ WiFi disconnected - Firebase will reinitialize when WiFi reconnects");
  }
  
  // Print status every 30 seconds (optional, untuk monitoring)
  if (now - lastStatusPrint >= 30000) {
    lastStatusPrint = now;
    Serial.print("[Status] Uptime: ");
    Serial.print(now / 1000);
    Serial.print("s | WiFi: ");
    Serial.print(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print(" (");
      Serial.print(WiFi.localIP());
      Serial.print(")");
    }
    Serial.print(" | Firebase: ");
    Serial.println(Firebase.ready() ? "Ready (Polling)" : "Not ready");
    Serial.flush();
  }
  
  // Check WiFi connection - FIXED: Don't call WiFi.begin() if already connecting
  wl_status_t wifiStatus = WiFi.status();
  if (wifiStatus != WL_CONNECTED) {
    // Only try to reconnect if not already connecting
    if (wifiStatus != WL_IDLE_STATUS && wifiStatus != WL_SCAN_COMPLETED) {
      if (now - lastWiFiCheck > 10000) {  // Check every 10 seconds (longer interval)
        lastWiFiCheck = now;
        
        // Disconnect first if needed
        if (wifiStatus == WL_CONNECT_FAILED || wifiStatus == WL_CONNECTION_LOST) {
          Serial.println("\n[WiFi] Disconnecting before reconnect...");
          WiFi.disconnect(true);
          delay(1000);
        }
        
        Serial.print("\n[WiFi] Reconnecting... (Status: ");
        Serial.print(wifiStatus);
        Serial.println(")");
        Serial.flush();
        
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      }
    } else {
      // WiFi is connecting, just wait
      lastWiFiCheck = now; // Reset timer to prevent spam
    }
  } else {
    lastWiFiCheck = now; // Reset timer if connected
  }
  
  // ===========================================================================
  // STEP 3: BACA NAVIGATION MODE DARI FIREBASE
  // ===========================================================================
  // Check navigation mode (every 1 second) - ESP32-C3 standby check
  if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
    // STEP 3: Check navigation mode dari web (setiap 1 detik)
    // Cek apakah web sudah masuk mode navigasi atau belum
    if (now - lastNavModeCheck >= NAV_MODE_CHECK_INTERVAL_MS) {
      lastNavModeCheck = now;
      checkNavigationMode();  // Check apakah web sudah masuk mode navigasi
    }
    
    // ===========================================================================
    // STEP 4-6: BACA DETECTION OBJECT (HANYA JIKA NAVIGATION MODE AKTIF)
    // ===========================================================================
    // Hanya baca detection jika navigation mode sudah aktif
    if (navigationModeActive) {
      // Navigation mode AKTIF → baca detection object
      if (now - lastPollTime >= POLL_INTERVAL_MS) {
        lastPollTime = now;
        checkDetectionData();  // Baca detection dari ESP32CAM, cek kiri/kanan, vibrate
      }
    } else {
      // Navigation mode BELUM aktif - reset poll timer
      lastPollTime = now;
    }
  }
  
  delay(100); // Small delay to prevent watchdog
}
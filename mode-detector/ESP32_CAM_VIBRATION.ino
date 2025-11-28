#include <WiFi.h>
#include <FirebaseESP32.h>

// ================= WIFI =================
#define WIFI_SSID "enumatechz"
#define WIFI_PASSWORD "3numaTechn0l0gy"

// ================= FIREBASE =================
#define FIREBASE_HOST "senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyDrKWMsQvJgtgGRvE2FEHPTnpq7MrKLQTQ"

// Objek Firebase
FirebaseData fbData;
FirebaseAuth auth;
FirebaseConfig config;

// ================= PIN MOTOR =================
#define MOTOR_LEFT 12
#define MOTOR_RIGHT 13

// ================= THRESHOLD JARAK =================
#define DISTANCE_THRESHOLD 150  // cm

// Status tracking
float lastDistance = 999.0;
bool motorActive = false;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=== ESP32-CAM Vibration Motor dengan Firebase ===");

  // Pin Mode
  pinMode(MOTOR_LEFT, OUTPUT);
  pinMode(MOTOR_RIGHT, OUTPUT);

  digitalWrite(MOTOR_LEFT, LOW);
  digitalWrite(MOTOR_RIGHT, LOW);
  Serial.println("✅ Motor pins initialized");

  // WIFI
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Menghubungkan ke WiFi");
  int wifiTimeout = 0;
  while (WiFi.status() != WL_CONNECTED && wifiTimeout < 30) {
    delay(500);
    Serial.print(".");
    wifiTimeout++;
  }
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n❌ WiFi connection failed!");
    return;
  }
  
  Serial.println("\n✅ WiFi Terhubung!");
  Serial.print("Alamat IP: ");
  Serial.println(WiFi.localIP());

  // FIREBASE - Sintaks baru
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  // Set timeout dan buffer size
  fbData.setBSSLBufferSize(4096, 1024);
  fbData.setResponseSize(4096);
  Firebase.setReadTimeout(fbData, 1000 * 60);
  Firebase.setwriteSizeLimit(fbData, "tiny");

  Serial.println("✅ Firebase Terhubung");
  Serial.print("   Host: ");
  Serial.println(FIREBASE_HOST);
  Serial.println();
  Serial.println("📡 Monitoring distance dari Firebase...");
  Serial.println("   - Path: /ml_results/distance atau /ml_results/min_distance");
  Serial.println("   - Threshold: < " + String(DISTANCE_THRESHOLD) + " cm");
  Serial.println();
}

void updateMotorControl(int cmd, int pwmL, int pwmR) {
  if (!Firebase.ready()) {
    return;
  }

  // Update motor control di Firebase
  FirebaseJson motorJson;
  motorJson.set("cmd", cmd);
  motorJson.set("pwmL", pwmL);
  motorJson.set("pwmR", pwmR);

  if (Firebase.setJSON(fbData, "/motor", motorJson)) {
    Serial.printf("✅ Motor control updated: cmd=%d, pwmL=%d, pwmR=%d\n", cmd, pwmL, pwmR);
  } else {
    Serial.printf("❌ Failed to update motor control: %s\n", fbData.errorReason().c_str());
  }
}

void controlMotor(bool activate) {
  if (activate && !motorActive) {
    // Aktifkan motor vibration
    digitalWrite(MOTOR_LEFT, HIGH);
    digitalWrite(MOTOR_RIGHT, HIGH);
    motorActive = true;
    
    // Update Firebase: cmd=1 (aktif), pwmL=255, pwmR=255 (full power)
    updateMotorControl(1, 255, 255);
    
    Serial.println("📳 Motor VIBRATION AKTIF (jarak < " + String(DISTANCE_THRESHOLD) + " cm)");
  } 
  else if (!activate && motorActive) {
    // Matikan motor
    digitalWrite(MOTOR_LEFT, LOW);
    digitalWrite(MOTOR_RIGHT, LOW);
    motorActive = false;
    
    // Update Firebase: cmd=0 (stop), pwmL=0, pwmR=0
    updateMotorControl(0, 0, 0);
    
    Serial.println("⏹️  Motor MATI (jarak >= " + String(DISTANCE_THRESHOLD) + " cm atau tidak ada object)");
  }
}

void loop() {
  // Cek koneksi Firebase, reconnect jika terputus
  if (!Firebase.ready()) {
    Serial.println("⚠️  Firebase terputus, mencoba reconnect...");
    Firebase.reconnectWiFi(true);
    delay(1000);
    return;
  }

  // Baca distance dari Firebase
  float currentDistance = 999.0;
  bool distanceRead = false;

  // Coba baca dari /ml_results/distance
  if (Firebase.getFloat(fbData, "/ml_results/distance")) {
    currentDistance = fbData.floatData();
    distanceRead = true;
  }
  // Jika tidak ada, coba baca dari /ml_results/min_distance
  else if (Firebase.getFloat(fbData, "/ml_results/min_distance")) {
    currentDistance = fbData.floatData();
    distanceRead = true;
  }

  if (distanceRead) {
    // Update lastDistance jika berubah signifikan
    if (abs(currentDistance - lastDistance) > 1.0) {
      lastDistance = currentDistance;
      Serial.printf("📏 Distance: %.1f cm\n", currentDistance);
    }

    // Kontrol motor berdasarkan distance
    if (currentDistance > 0 && currentDistance < DISTANCE_THRESHOLD) {
      // Object terdeteksi dalam jarak < 150 cm
      controlMotor(true);
    } else {
      // Object tidak terdeteksi atau jarak >= 150 cm
      controlMotor(false);
    }
  } else {
    // Tidak ada data distance, matikan motor
    if (motorActive) {
      controlMotor(false);
    }
  }

  delay(200);  // Delay 200ms untuk check distance
}

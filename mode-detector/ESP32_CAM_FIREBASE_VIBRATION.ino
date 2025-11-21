#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <FirebaseESP32.h>
#include <ArduinoJson.h>
#include "board_config.h"

// WiFi credentials
const char *ssid = "enumatechz";
const char *password = "3numaTechn0l0gy";

// Firebase credentials
#define FIREBASE_HOST "senavision-id-default-rtdb.firebaseio.com"
#define FIREBASE_AUTH "YOUR_FIREBASE_AUTH_TOKEN"  // Ganti dengan Database Secret atau OAuth token

// Pin definitions
#define MOTOR_R 14  // Vibrator kanan
#define MOTOR_L 15  // Vibrator kiri

// Firebase Data object
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// WebServer untuk HTTP endpoint
WebServer server(80);

// Status tracking
String currentMotorState = "none";
unsigned long lastStatusUpdate = 0;
unsigned long lastMLCheck = 0;
const unsigned long STATUS_UPDATE_INTERVAL = 2000;  // Update status setiap 2 detik
const unsigned long ML_CHECK_INTERVAL = 100;        // Check ML results setiap 100ms

/**
 * Fungsi untuk mengontrol motor berdasarkan arah
 * direction: "left", "right", "both", "stop", "none"
 */
void kontrolMotor(String direction) {
  direction.toLowerCase();
  
  if (direction == "right" || direction == "r") {
    Serial.println("➡️  Getar motor kanan");
    digitalWrite(MOTOR_R, HIGH);
    digitalWrite(MOTOR_L, LOW);
    currentMotorState = "right";
  } 
  else if (direction == "left" || direction == "l") {
    Serial.println("⬅️  Getar motor kiri");
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, HIGH);
    currentMotorState = "left";
  }
  else if (direction == "both" || direction == "b") {
    Serial.println("📳 Getar kedua motor");
    digitalWrite(MOTOR_R, HIGH);
    digitalWrite(MOTOR_L, HIGH);
    currentMotorState = "both";
  }
  else {
    Serial.println("⏹️  Motor mati");
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, LOW);
    currentMotorState = "none";
  }
}

/**
 * Update status ESP32 ke Firebase
 */
void updateESP32Status() {
  if (Firebase.ready() && (millis() - lastStatusUpdate >= STATUS_UPDATE_INTERVAL)) {
    // Update status ke Firebase
    FirebaseJson json;
    json.set("connected", true);
    json.set("motor_active", currentMotorState);
    json.set("last_update", millis() / 1000);
    json.set("ip_address", WiFi.localIP().toString());
    
    if (Firebase.setJSON(fbdo, "/esp32_status", json)) {
      Serial.println("✅ Status updated to Firebase");
    } else {
      Serial.printf("❌ Failed to update status: %s\n", fbdo.errorReason().c_str());
    }
    
    lastStatusUpdate = millis();
  }
}

/**
 * Check ML results dari Firebase dan kontrol motor
 */
void checkMLResults() {
  if (Firebase.ready() && (millis() - lastMLCheck >= ML_CHECK_INTERVAL)) {
    // Baca ML results dari Firebase
    if (Firebase.getString(fbdo, "/ml_results/direction")) {
      String direction = fbdo.stringData();
      direction.toLowerCase();
      
      // Update motor jika direction berubah
      if (direction != currentMotorState && 
          (direction == "left" || direction == "right" || direction == "both" || 
           direction == "stop" || direction == "none")) {
        Serial.printf("📡 Received ML direction: %s\n", direction.c_str());
        kontrolMotor(direction);
        
        // Update status setelah motor diaktifkan
        updateESP32Status();
      }
    } else {
      // Jika tidak ada data, matikan motor
      if (currentMotorState != "none") {
        Serial.println("⚠️  No ML data, stopping motor");
        kontrolMotor("none");
        updateESP32Status();
      }
    }
    
    lastMLCheck = millis();
  }
}

/**
 * Handler untuk endpoint /vibrate (HTTP fallback)
 */
void handleVibrate() {
  Serial.println("📡 Received /vibrate request");
  
  if (server.hasArg("direction")) {
    String direction = server.arg("direction");
    kontrolMotor(direction);
    
    // Update Firebase juga
    updateESP32Status();
    
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", 
                "{\"status\":\"ok\",\"direction\":\"" + direction + "\",\"motor_state\":\"" + currentMotorState + "\"}");
  } else {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing direction parameter\"}");
  }
}

/**
 * Handler untuk OPTIONS request (CORS preflight)
 */
void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(200, "text/plain", "");
}

/**
 * Handler untuk endpoint /status
 */
void handleStatus() {
  StaticJsonDocument<200> doc;
  doc["connected"] = true;
  doc["motor_active"] = currentMotorState;
  doc["ip_address"] = WiFi.localIP().toString();
  doc["firebase_connected"] = Firebase.ready();
  
  String response;
  serializeJson(doc, response);
  
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", response);
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  delay(1000);
  Serial.println();
  Serial.println("=== ESP32-CAM dengan Firebase Realtime Database ===");
  
  // Setup vibration motor pins
  pinMode(MOTOR_R, OUTPUT);
  pinMode(MOTOR_L, OUTPUT);
  digitalWrite(MOTOR_R, LOW);
  digitalWrite(MOTOR_L, LOW);
  Serial.println("✅ Vibration motors initialized");
  Serial.println("   - MOTOR_R (GPIO 14) = Kanan");
  Serial.println("   - MOTOR_L (GPIO 15) = Kiri");
  
  // === Inisialisasi kamera ===
  camera_config_t camera_config;
  camera_config.ledc_channel = LEDC_CHANNEL_0;
  camera_config.ledc_timer = LEDC_TIMER_0;
  camera_config.pin_d0 = Y2_GPIO_NUM;
  camera_config.pin_d1 = Y3_GPIO_NUM;
  camera_config.pin_d2 = Y4_GPIO_NUM;
  camera_config.pin_d3 = Y5_GPIO_NUM;
  camera_config.pin_d4 = Y6_GPIO_NUM;
  camera_config.pin_d5 = Y7_GPIO_NUM;
  camera_config.pin_d6 = Y8_GPIO_NUM;
  camera_config.pin_d7 = Y9_GPIO_NUM;
  camera_config.pin_xclk = XCLK_GPIO_NUM;
  camera_config.pin_pclk = PCLK_GPIO_NUM;
  camera_config.pin_vsync = VSYNC_GPIO_NUM;
  camera_config.pin_href = HREF_GPIO_NUM;
  camera_config.pin_sccb_sda = SIOD_GPIO_NUM;
  camera_config.pin_sccb_scl = SIOC_GPIO_NUM;
  camera_config.pin_pwdn = PWDN_GPIO_NUM;
  camera_config.pin_reset = RESET_GPIO_NUM;
  camera_config.xclk_freq_hz = 20000000;
  camera_config.frame_size = FRAMESIZE_QVGA;
  camera_config.pixel_format = PIXFORMAT_JPEG;
  camera_config.fb_location = CAMERA_FB_IN_PSRAM;
  camera_config.jpeg_quality = 12;
  camera_config.fb_count = 1;
  camera_config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  
  if (esp_camera_init(&camera_config) != ESP_OK) {
    Serial.println("❌ Camera init failed!");
    return;
  }
  Serial.println("✅ Camera initialized");
  
  // === Setup WiFi ===
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  Serial.print("WiFi connecting");
  
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
  
  Serial.println();
  Serial.print("✅ WiFi connected! IP: ");
  Serial.println(WiFi.localIP());
  
  // === Setup mDNS ===
  if (!MDNS.begin("esp32cam")) {
    Serial.println("❌ MDNS failed!");
  } else {
    Serial.println("✅ MDNS aktif di http://esp32cam.local");
  }
  
  // === Setup Firebase ===
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  // Set timeout
  fbdo.setBSSLBufferSize(4096, 1024);
  fbdo.setResponseSize(4096);
  Firebase.setReadTimeout(fbdo, 1000 * 60);
  Firebase.setwriteSizeLimit(fbdo, "tiny");
  
  Serial.println("✅ Firebase initialized");
  Serial.printf("   Host: %s\n", FIREBASE_HOST);
  
  // === Setup HTTP Server ===
  server.on("/vibrate", HTTP_GET, handleVibrate);
  server.on("/vibrate", HTTP_OPTIONS, handleOptions);
  server.on("/status", HTTP_GET, handleStatus);
  
  server.on("/capture", []() {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      server.send(500, "text/plain", "Camera capture failed");
      return;
    }
    server.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
  });
  
  server.begin();
  Serial.println("✅ HTTP server started");
  Serial.println("📡 Endpoints:");
  Serial.println("   - GET /vibrate?direction=left|right|both|stop");
  Serial.println("   - GET /status");
  Serial.println("   - GET /capture");
  
  Serial.println();
  Serial.println("=== Setup Complete ===");
  Serial.println("🔄 Monitoring Firebase Realtime Database for ML results...");
  Serial.println();
}

void loop() {
  // Handle HTTP requests
  server.handleClient();
  
  // Check ML results dari Firebase dan update motor
  checkMLResults();
  
  // Update status ESP32 ke Firebase
  updateESP32Status();
  
  // Handle Serial Monitor input (untuk testing manual)
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toLowerCase();
    
    if (cmd == "1" || cmd == "right") {
      kontrolMotor("right");
    } else if (cmd == "2" || cmd == "left") {
      kontrolMotor("left");
    } else if (cmd == "0" || cmd == "stop") {
      kontrolMotor("stop");
    } else if (cmd == "status") {
      Serial.printf("Motor State: %s\n", currentMotorState.c_str());
      Serial.printf("Firebase Ready: %s\n", Firebase.ready() ? "Yes" : "No");
      Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
    }
  }
  
  delay(10); // Small delay untuk prevent watchdog
}


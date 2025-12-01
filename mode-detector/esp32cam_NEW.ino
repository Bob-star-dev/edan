#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include "esp_camera.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ================= WIFI =================
#define WIFI_SSID "enumatechz"
#define WIFI_PASSWORD "3numaTechn0l0gy"

// ================= FIREBASE =================
#define DATABASE_URL "https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app/"
#define DATABASE_LEGACY_TOKEN "cY0AwFCw41qXIab0t3f4lU2P4exj376pxAiiDe6J"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ================= PIN MOTOR =================
#define MOTOR_LEFT 12
#define MOTOR_RIGHT 13

// ================= THRESHOLD =================
#define DISTANCE_THRESHOLD 150

float lastDistance = 999.0;
bool motorActive = false;

// ================= WEB SERVER =================
WebServer server(80);

// ================= CAMERA CONFIG =================
camera_config_t camera_config = {
  .pin_pwdn = 32,
  .pin_reset = -1,
  .pin_xclk = 0,
  .pin_sscb_sda = 26,
  .pin_sscb_scl = 27,
  .pin_d7 = 35,
  .pin_d6 = 34,
  .pin_d5 = 39,
  .pin_d4 = 36,
  .pin_d3 = 21,
  .pin_d2 = 19,
  .pin_d1 = 18,
  .pin_d0 = 5,
  .pin_vsync = 25,
  .pin_href = 23,
  .pin_pclk = 22,
  .xclk_freq_hz = 20000000,
  .ledc_timer = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG,
  .frame_size = FRAMESIZE_QVGA,
  .jpeg_quality = 12,
  .fb_count = 2
};

// ================= CORS HANDLERS =================
void sendCORS() {
  // CRITICAL: Send CORS headers for cross-origin requests
  // This allows browser to read response data (blob, image data, etc.)
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");
  server.sendHeader("Access-Control-Expose-Headers", "Content-Type, Content-Length");
  // Allow browser to cache response if needed
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
}

void handleOptions() {
  sendCORS();
  server.send(200);
}

// ================= MOTOR CONTROL =================
void updateMotorControl(int cmd, int pwmL, int pwmR) {
  FirebaseJson json;
  json.set("cmd", cmd);
  json.set("pwmL", pwmL);
  json.set("pwmR", pwmR);
  Firebase.RTDB.setJSON(&fbdo, "/motor", &json);
}

void controlMotor(bool activate) {
  if (activate && !motorActive) {
    digitalWrite(MOTOR_LEFT, HIGH);
    digitalWrite(MOTOR_RIGHT, HIGH);
    motorActive = true;
    updateMotorControl(1, 255, 255);
    Serial.println("📳 Motor ON (Object dekat)");
  }
  else if (!activate && motorActive) {
    digitalWrite(MOTOR_LEFT, LOW);
    digitalWrite(MOTOR_RIGHT, LOW);
    motorActive = false;
    updateMotorControl(0, 0, 0);
    Serial.println("⏹️ Motor OFF");
  }
}

// ================= VIBRATION HANDLER =================
void handleVibrate() {
  sendCORS();
  
  // Parse parameters
  String direction = server.arg("direction");
  String durationStr = server.arg("duration");
  String patternStr = server.arg("pattern");
  
  // Handle pattern vibration (Mario pattern, etc.)
  if (patternStr.length() > 0) {
    // Parse pattern: "125,75,125,275,..."
    int pattern[20]; // Max 20 values
    int patternCount = 0;
    int startIdx = 0;
    
    for (int i = 0; i <= patternStr.length() && patternCount < 20; i++) {
      if (i == patternStr.length() || patternStr.charAt(i) == ',') {
        if (i > startIdx) {
          pattern[patternCount] = patternStr.substring(startIdx, i).toInt();
          patternCount++;
        }
        startIdx = i + 1;
      }
    }
    
    // Execute pattern
    for (int i = 0; i < patternCount; i += 2) {
      int onDuration = pattern[i];
      int offDuration = (i + 1 < patternCount) ? pattern[i + 1] : 0;
      
      // Control motor based on direction
      if (direction == "left" || direction == "both" || direction.length() == 0) {
        digitalWrite(MOTOR_LEFT, HIGH);
      }
      if (direction == "right" || direction == "both" || direction.length() == 0) {
        digitalWrite(MOTOR_RIGHT, HIGH);
      }
      
      delay(onDuration);
      
      digitalWrite(MOTOR_LEFT, LOW);
      digitalWrite(MOTOR_RIGHT, LOW);
      
      if (offDuration > 0 && i + 1 < patternCount) {
        delay(offDuration);
      }
    }
    
    Serial.printf("📳 Vibration pattern executed: %s (direction: %s)\n", patternStr.c_str(), direction.length() > 0 ? direction.c_str() : "both");
    server.send(200, "text/plain", "OK");
    return;
  }
  
  // Handle simple duration vibration
  int duration = durationStr.toInt();
  if (duration <= 0) duration = 200; // Default 200ms
  
  // Control motor based on direction
  if (direction == "left" || direction == "both" || direction.length() == 0) {
    digitalWrite(MOTOR_LEFT, HIGH);
  }
  if (direction == "right" || direction == "both" || direction.length() == 0) {
    digitalWrite(MOTOR_RIGHT, HIGH);
  }
  
  delay(duration);
  
  digitalWrite(MOTOR_LEFT, LOW);
  digitalWrite(MOTOR_RIGHT, LOW);
  
  Serial.printf("📳 Vibration: %dms (direction: %s)\n", duration, direction.length() > 0 ? direction.c_str() : "both");
  server.send(200, "text/plain", "OK");
}

// ================= WEB ENDPOINTS =================
void handleStatus() {
  sendCORS();
  String json = "{\"status\":\"ok\",\"device\":\"esp32cam\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  server.send(200, "application/json", json);
}

void handleCapture() {
  // CRITICAL: Send CORS headers FIRST before any content
  // This is essential for browser to allow reading image data as blob
  sendCORS();
  
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    // Send CORS headers even for error responses
    sendCORS();
    server.send(500, "text/plain", "Camera capture failed");
    return;
  }
  
  // Send Content-Type header
  server.sendHeader("Content-Type", "image/jpeg");
  server.sendHeader("Content-Length", String(fb->len));
  
  // Send response with status 200
  // Using send_P to send binary data efficiently
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  
  // Return frame buffer to camera
  esp_camera_fb_return(fb);
  
  // Log successful capture (throttled to avoid spam)
  static uint32_t lastCaptureLog = 0;
  if (millis() - lastCaptureLog > 5000) {
    Serial.println("📸 /capture endpoint called - CORS headers sent");
    lastCaptureLog = millis();
  }
}

void handleStream() {
  // IMPORTANT: Send CORS headers FIRST before any content
  // This is critical for browser to allow reading pixel data from MJPEG stream
  sendCORS();
  
  // Send MJPEG stream headers
  // Note: Using sendContent for proper MJPEG stream format
  String response = 
    "HTTP/1.1 200 OK\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type, Cache-Control\r\n"
    "Access-Control-Expose-Headers: Content-Type, Content-Length\r\n"
    "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  
  server.sendContent(response);
  
  while (true) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("❌ Camera capture failed in stream");
      break;
    }
    
    // Send frame boundary
    server.sendContent("--frame\r\n");
    server.sendContent("Content-Type: image/jpeg\r\n");
    // IMPORTANT: Send CORS header with each frame chunk
    // Some browsers require CORS headers in multipart responses
    server.sendContent("Access-Control-Allow-Origin: *\r\n");
    server.sendContent("Content-Length: " + String(fb->len) + "\r\n\r\n");
    server.sendContent((const char*)fb->buf, fb->len);
    server.sendContent("\r\n");
    
    esp_camera_fb_return(fb);
    
    // Check if client is still connected
    if (!server.client().connected()) {
      Serial.println("Client disconnected");
      break;
    }
    
    delay(25); // ~40 FPS
  }
}

// ================= SETUP =================
void setup() {
  // Disable brownout detector
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n\n🚀 ESP32-CAM Starting...\n");
  
  // Setup motor pins
  pinMode(MOTOR_LEFT, OUTPUT);
  pinMode(MOTOR_RIGHT, OUTPUT);
  digitalWrite(MOTOR_LEFT, LOW);
  digitalWrite(MOTOR_RIGHT, LOW);
  Serial.println("✅ Motor pins initialized (GPIO 12 & 13)");
  
  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("📡 Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\n✅ WiFi Connected!");
  Serial.print("📡 IP Address: ");
  Serial.println(WiFi.localIP());
  
  // Initialize camera
  if (esp_camera_init(&camera_config) != ESP_OK) {
    Serial.println("❌ CAMERA INIT FAILED");
    return;
  }
  Serial.println("✅ Camera initialized");
  
  // Setup mDNS
  if (MDNS.begin("esp32cam")) {
    Serial.println("✅ mDNS active: http://esp32cam.local");
  } else {
    Serial.println("⚠️ mDNS failed");
  }
  
  // Register CORS OPTIONS handlers (for preflight requests)
  server.on("/status", HTTP_OPTIONS, handleOptions);
  server.on("/capture", HTTP_OPTIONS, handleOptions);
  server.on("/stream", HTTP_OPTIONS, handleOptions);
  server.on("/vibrate", HTTP_OPTIONS, handleOptions);
  
  // Register route handlers
  server.on("/status", handleStatus);
  server.on("/capture", handleCapture);
  server.on("/stream", handleStream);
  server.on("/vibrate", handleVibrate);
  
  // Start web server
  server.begin();
  Serial.println("✅ Web server running on port 80");
  Serial.println("\n📋 Available endpoints:");
  Serial.println("   - http://" + WiFi.localIP().toString() + "/status");
  Serial.println("   - http://" + WiFi.localIP().toString() + "/capture");
  Serial.println("   - http://" + WiFi.localIP().toString() + "/stream");
  Serial.println("   - http://" + WiFi.localIP().toString() + "/vibrate?duration=200&direction=both");
  Serial.println("   - http://" + WiFi.localIP().toString() + "/vibrate?pattern=125,75,125,275&direction=both");
  Serial.println("\n✅ ESP32-CAM Ready!\n");
  
  // Initialize Firebase
  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = DATABASE_LEGACY_TOKEN;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  // Set initial Firebase status
  Firebase.RTDB.setBool(&fbdo, "/status/camera_online", true);
  Firebase.RTDB.setString(&fbdo, "/status/ip", WiFi.localIP().toString());
  Serial.println("✅ Firebase initialized");
}

// ================= LOOP =================
void loop() {
  // Handle web server requests
  server.handleClient();
  
  static uint32_t lastDistanceCheck = 0;
  static uint32_t lastFirebaseUpdate = 0;
  
  // Check distance from Firebase every 200ms
  if (millis() - lastDistanceCheck >= 200) {
    lastDistanceCheck = millis();
    
    float dist = 999;
    bool ok = false;
    
    // Try to get distance from Firebase
    if (Firebase.RTDB.getFloat(&fbdo, "/ml_results/distance")) {
      dist = fbdo.floatData();
      ok = true;
    }
    else if (Firebase.RTDB.getFloat(&fbdo, "/ml_results/min_distance")) {
      dist = fbdo.floatData();
      ok = true;
    }
    
    if (ok) {
      // Only log if distance changed significantly
      if (abs(dist - lastDistance) > 5.0) {
        Serial.printf("📏 Distance: %.1f cm\n", dist);
        lastDistance = dist;
      }
      
      // Control motor based on distance
      if (dist > 0 && dist < DISTANCE_THRESHOLD) {
        controlMotor(true);
      } else {
        controlMotor(false);
      }
    } else {
      // No distance data, turn off motor
      controlMotor(false);
    }
  }
  
  // Update Firebase status every 1 second
  if (millis() - lastFirebaseUpdate >= 1000) {
    lastFirebaseUpdate = millis();
    
    static uint32_t frameID = 0;
    Firebase.RTDB.setInt(&fbdo, "/esp32cam/frame_id", frameID++);
    Firebase.RTDB.setString(&fbdo, "/esp32cam/timestamp", String(millis()));
    
    // Only log every 10 seconds to reduce serial spam
    if (frameID % 10 == 0) {
      Serial.println("🔥 Firebase updated");
    }
  }
}


#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include "board_config.h"

const char *ssid = "enumatechz";
const char *password = "3numaTechn0l0gy";

#define MOTOR_R 14  // Vibrator kanan
#define MOTOR_L 15  // Vibrator kiri

// WebServer untuk HTTP endpoint
WebServer server(80);

/**
 * Fungsi untuk mengontrol motor berdasarkan arah
 * 1 = kanan, 2 = kiri, 0 = stop
 */
void kontrolMotor(int hasilML) {
  if (hasilML == 1) {
    Serial.println("➡️  Getar motor kanan");
    digitalWrite(MOTOR_R, HIGH);
    digitalWrite(MOTOR_L, LOW);
  } 
  else if (hasilML == 2) {
    Serial.println("⬅️  Getar motor kiri");
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, HIGH);
  } 
  else {
    Serial.println("⏹️  Motor mati");
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, LOW);
  }
}

/**
 * Handler untuk endpoint /vibrate
 * Menerima parameter:
 * - direction: "left" (kiri), "right" (kanan), "both" (kedua), "stop" (mati)
 * - duration: Durasi vibration dalam ms (optional, untuk auto-stop)
 * - pattern: Pattern vibration dipisahkan koma (optional)
 */
void handleVibrate() {
  Serial.println("📡 Received /vibrate request");
  
  // Cek parameter direction terlebih dahulu (prioritas tinggi)
  if (server.hasArg("direction")) {
    String direction = server.arg("direction");
    direction.toLowerCase();
    
    Serial.printf("📳 Direction vibration: %s\n", direction.c_str());
    
    // Kontrol motor berdasarkan direction
    if (direction == "left" || direction == "l") {
      Serial.println("⬅️  Getar motor kiri");
      kontrolMotor(2); // 2 = kiri
    } else if (direction == "right" || direction == "r") {
      Serial.println("➡️  Getar motor kanan");
      kontrolMotor(1); // 1 = kanan
    } else if (direction == "both" || direction == "b") {
      Serial.println("📳 Getar kedua motor");
      // Aktifkan kedua motor
      digitalWrite(MOTOR_R, HIGH);
      digitalWrite(MOTOR_L, HIGH);
    } else if (direction == "stop" || direction == "s" || direction == "0") {
      Serial.println("⏹️  Motor mati");
      kontrolMotor(0); // 0 = stop
    } else {
      Serial.printf("❌ Invalid direction: %s\n", direction.c_str());
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid direction. Use: left, right, both, or stop\"}");
      return;
    }
    
    // Jika ada parameter duration, gunakan untuk auto-stop setelah durasi tertentu
    int duration = 0;
    if (server.hasArg("duration")) {
      duration = server.arg("duration").toInt();
      duration = constrain(duration, 0, 5000);
      
      if (duration > 0 && (direction == "left" || direction == "right" || direction == "both")) {
        // Tunggu sesuai durasi, lalu matikan motor
        delay(duration);
        digitalWrite(MOTOR_R, LOW);
        digitalWrite(MOTOR_L, LOW);
        Serial.println("✅ Vibration completed (auto-stop)");
      }
    }
    
    // Kirim response dengan CORS header
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200, "application/json", "{\"status\":\"ok\",\"direction\":\"" + direction + "\",\"duration\":" + String(duration) + "}");
    return;
  }
  
  // Cek apakah menggunakan parameter duration (tanpa direction - kedua motor)
  if (server.hasArg("duration")) {
    int duration = server.arg("duration").toInt();
    duration = constrain(duration, 0, 5000); // Limit 0-5000ms
    
    Serial.printf("📳 Duration vibration: %dms (both motors)\n", duration);
    
    // Getarkan kedua motor secara bersamaan
    digitalWrite(MOTOR_R, HIGH);
    digitalWrite(MOTOR_L, HIGH);
    delay(duration);
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, LOW);
    
    // Kirim response dengan CORS header
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200, "application/json", "{\"status\":\"ok\",\"duration\":" + String(duration) + "}");
    return;
  }
  
  // Parameter tidak valid
  Serial.println("❌ Invalid request: Missing 'direction' or 'duration' parameter");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'direction' or 'duration' parameter\"}");
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

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  
  // Setup vibration motor pins
  pinMode(MOTOR_R, OUTPUT);
  pinMode(MOTOR_L, OUTPUT);
  digitalWrite(MOTOR_R, LOW);
  digitalWrite(MOTOR_L, LOW);
  Serial.println("✅ Vibration motors initialized");
  Serial.println("   - MOTOR_R (GPIO 14) = Kanan");
  Serial.println("   - MOTOR_L (GPIO 15) = Kiri");
  
  // === Inisialisasi kamera ===
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_QVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  
  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("❌ Camera init failed!");
    return;
  }
  Serial.println("✅ Camera initialized");
  
  // === Setup WiFi ===
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  Serial.print("WiFi connecting");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
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
  
  // === Setup HTTP Server ===
  // Register endpoint untuk vibration
  server.on("/vibrate", HTTP_GET, handleVibrate);
  server.on("/vibrate", HTTP_OPTIONS, handleOptions);
  
  // Start HTTP server
  server.begin();
  Serial.println("✅ HTTP server started");
  Serial.println("📡 Vibration endpoint: http://esp32cam.local/vibrate");
  Serial.println("   - Direction: GET /vibrate?direction=left&duration=200");
  Serial.println("   - Direction: GET /vibrate?direction=right&duration=200");
  Serial.println("   - Direction: GET /vibrate?direction=both&duration=200");
  Serial.println("   - Stop: GET /vibrate?direction=stop");
  Serial.println("   - Duration: GET /vibrate?duration=200 (both motors)");
  
  // === Start Camera Server ===
  // Note: Jika Anda menggunakan library ESP32-CAM yang sudah ada (seperti dari ESP32 CameraWebServer example),
  // fungsi startCameraServer() biasanya sudah tersedia. Jika tidak, Anda bisa menggunakan WebServer
  // untuk membuat endpoint /stream dan /capture sendiri.
  
  // Untuk sementara, kita akan membuat endpoint kamera sederhana
  server.on("/stream", []() {
    // Handle MJPEG stream request
    // Implementasi stream biasanya menggunakan library khusus
    server.send(200, "text/plain", "Stream endpoint - use camera library");
  });
  
  server.on("/capture", []() {
    // Handle capture request
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      server.send(500, "text/plain", "Camera capture failed");
      return;
    }
    server.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
  });
  
  Serial.println("✅ Camera Server Ready!");
  Serial.println();
  Serial.println("=== ESP32-CAM dengan Vibration Motor (Directional) ===");
  Serial.println("📡 Endpoint vibration: http://esp32cam.local/vibrate");
  Serial.println("📱 Serial Monitor: Ketik '1' (kanan), '2' (kiri), atau '0' (stop)");
  Serial.println();
}

void loop() {
  // Handle HTTP requests
  server.handleClient();
  
  // Handle Serial Monitor input (untuk testing manual)
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == '1') kontrolMotor(1);
    else if (cmd == '2') kontrolMotor(2);
    else if (cmd == '0') kontrolMotor(0);
  }
}



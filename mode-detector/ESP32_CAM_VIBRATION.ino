#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

// WiFi credentials - sesuaikan dengan WiFi Anda
const char *ssid = "enumatechz";
const char *password = "3numaTechn0l0gy";

// ESP32-CAM Pin Definitions (AI Thinker ESP32-CAM)
// Pin definitions untuk ESP32-CAM
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Pin untuk vibration motor
#define MOTOR_R 14  // Vibrator kanan
#define MOTOR_L 15  // Vibrator kiri

// WebServer untuk HTTP endpoint
WebServer server(80);

/**
 * Fungsi untuk mengontrol motor berdasarkan arah (untuk Serial Monitor)
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
 * Fungsi untuk menggetarkan kedua motor secara bersamaan
 * @param duration Durasi getaran dalam milidetik (ms)
 */
void vibrateBothMotors(int duration) {
  // Limit durasi untuk melindungi motor (max 5000ms = 5 detik)
  duration = constrain(duration, 0, 5000);
  
  if (duration > 0) {
    Serial.printf("📳 Vibrating both motors: %dms\n", duration);
    
    // Aktifkan kedua motor secara bersamaan
    digitalWrite(MOTOR_R, HIGH);
    digitalWrite(MOTOR_L, HIGH);
    
    // Tunggu sesuai durasi
    delay(duration);
    
    // Matikan kedua motor
    digitalWrite(MOTOR_R, LOW);
    digitalWrite(MOTOR_L, LOW);
    
    Serial.println("✅ Vibration completed");
  }
}

/**
 * Fungsi untuk menjalankan pattern vibration
 * Pattern format: [on, off, on, off, ...] dalam milidetik
 * @param pattern Array pattern
 * @param count Jumlah elemen dalam array
 */
void vibratePattern(int pattern[], int count) {
  Serial.printf("📳 Vibrating pattern: %d steps\n", count);
  
  for (int i = 0; i < count; i++) {
    if (i % 2 == 0) {
      // Even index = ON duration (getar)
      int duration = constrain(pattern[i], 0, 5000);
      if (duration > 0) {
        digitalWrite(MOTOR_R, HIGH);
        digitalWrite(MOTOR_L, HIGH);
        delay(duration);
        digitalWrite(MOTOR_R, LOW);
        digitalWrite(MOTOR_L, LOW);
      }
    } else {
      // Odd index = OFF duration (delay/jeda)
      int delayTime = constrain(pattern[i], 0, 5000);
      if (delayTime > 0) {
        delay(delayTime);
      }
    }
  }
  
  Serial.println("✅ Pattern vibration completed");
}

/**
 * Handler untuk endpoint /vibrate
 * Menerima parameter:
 * - duration: Durasi vibration dalam ms (contoh: ?duration=200)
 * - pattern: Pattern vibration dipisahkan koma (contoh: ?pattern=200,100,200,100)
 */
void handleVibrate() {
  Serial.println("📡 Received /vibrate request");
  
  // Cek apakah menggunakan parameter duration
  if (server.hasArg("duration")) {
    int duration = server.arg("duration").toInt();
    duration = constrain(duration, 0, 5000); // Limit 0-5000ms
    
    Serial.printf("📳 Duration vibration: %dms\n", duration);
    
    // Getarkan kedua motor secara bersamaan
    vibrateBothMotors(duration);
    
    // Kirim response dengan CORS header (untuk web browser)
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200, "application/json", "{\"status\":\"ok\",\"duration\":" + String(duration) + "}");
    
  } 
  // Cek apakah menggunakan parameter pattern
  else if (server.hasArg("pattern")) {
    String patternStr = server.arg("pattern");
    Serial.printf("📳 Pattern vibration: %s\n", patternStr.c_str());
    
    // Parse pattern string (format: "200,100,200,100")
    int values[20]; // Max 20 values (10 on/off pairs)
    int count = 0;
    int startPos = 0;
    
    // Parse comma-separated values
    for (int i = 0; i <= patternStr.length(); i++) {
      if (i == patternStr.length() || patternStr.charAt(i) == ',') {
        if (count < 20) {
          values[count] = patternStr.substring(startPos, i).toInt();
          count++;
        }
        startPos = i + 1;
      }
    }
    
    // Jalankan pattern vibration
    if (count > 0) {
      vibratePattern(values, count);
      
      // Kirim response dengan CORS header
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
      server.send(200, "application/json", "{\"status\":\"ok\",\"pattern\":\"" + patternStr + "\"}");
    } else {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid pattern\"}");
    }
    
  } 
  // Parameter tidak valid
  else {
    Serial.println("❌ Invalid request: Missing 'duration' or 'pattern' parameter");
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing 'duration' or 'pattern' parameter\"}");
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
  Serial.println("   - Duration: GET /vibrate?duration=200");
  Serial.println("   - Pattern:  GET /vibrate?pattern=200,100,200,100");
  
  // === Start Camera Server ===
  // Note: Jika Anda menggunakan library ESP32-CAM yang sudah ada (seperti dari ESP32 CameraWebServer example),
  // fungsi startCameraServer() biasanya sudah tersedia. Jika tidak, Anda bisa menggunakan WebServer
  // untuk membuat endpoint /stream dan /capture sendiri, atau gunakan library yang sudah ada.
  
  // Untuk sementara, kita akan membuat endpoint kamera sederhana
  // Jika Anda menggunakan library yang sudah ada, uncomment baris berikut:
  // startCameraServer();
  
  // Atau buat endpoint kamera sendiri menggunakan WebServer
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
  Serial.println("=== ESP32-CAM dengan Vibration Motor ===");
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

// Catatan tentang Camera Server:
// - Jika Anda menggunakan contoh ESP32 CameraWebServer dari Arduino IDE,
//   fungsi startCameraServer() biasanya sudah tersedia di library.
// - Atau Anda bisa menggunakan implementasi endpoint kamera sederhana
//   yang sudah ditambahkan di setup() di atas.
// - Endpoint /stream untuk MJPEG stream dan /capture untuk single image capture


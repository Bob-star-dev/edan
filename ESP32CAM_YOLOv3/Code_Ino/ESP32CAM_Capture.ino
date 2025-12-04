#include "WebServer.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "esp32cam.h"
#include <HTTPClient.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

const char* WIFI_SSID = "enumatechz";
const char* WIFI_PASS = "3numaTechn0l0gy";
const char* URL = "/cam.jpg";
const char* HOSTNAME = "senavision";

// ======================
// IP STATIC (tetap pakai)
// ======================
IPAddress local_IP(192, 168, 1, 97);
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// ======================
// IP ESP32-C3 VIBRATOR
// ======================
// Pastikan IP ini sesuai dengan IP static di ESP32-C3.ino
String ESP32C3_IP = "http://192.168.1.27";   // IP ESP32-C3 Vibrator

static auto RES = esp32cam::Resolution::find(800, 600);
WebServer server(80);

// ===========================================================================
//  KIRIM SIGNAL KE ESP32-C3 (NON-BLOCKING dengan FreeRTOS Task)
// ===========================================================================
void sendToVibratorTask(void *parameter)
{
  String* path = (String*)parameter;
  HTTPClient http;
  String url = ESP32C3_IP + *path;

  Serial.print("📤 Sending vibrate signal to ESP32-C3: ");
  Serial.println(url);

  // Set timeout untuk HTTPClient (2 detik - lebih pendek agar tidak blocking lama)
  http.setTimeout(2000);
  http.begin(url);
  
  // Kirim request dengan timeout
  http.setTimeout(1000);  // Timeout 1 detik
  http.setConnectTimeout(1000);  // Connection timeout 1 detik
  
  int code = http.GET();
  
  if (code > 0) {
    Serial.print("✓ ESP32-C3 Response Code: ");
    Serial.println(code);
  } else {
    Serial.print("✗ ESP32-C3 Error: ");
    Serial.print(http.errorToString(code));
    Serial.print(" (Code: ");
    Serial.print(code);
    Serial.println(")");
    Serial.println("   Check if ESP32-C3 is connected and IP is correct!");
  }
  
  http.end();
  
  // Hapus string yang dialokasikan
  delete path;
  
  // Hapus task setelah selesai
  vTaskDelete(NULL);
}

void sendToVibrator(String path)
{
  // Buat copy string untuk task
  String* pathCopy = new String(path);
  
  // Buat task baru yang akan menjalankan request secara async
  xTaskCreate(
    sendToVibratorTask,    // Function to be called
    "VibratorTask",        // Name of task
    4096,                  // Stack size (bytes)
    pathCopy,              // Parameter to pass
    1,                     // Priority (0-25, higher = higher priority)
    NULL                   // Task handle (optional)
  );
}

// ===========================================================================
// Endpoint yang bisa dipanggil YOLO
// ===========================================================================
void handleLeft()
{
  Serial.println("📥 Received LEFT vibrate request from Python");
  // Kirim response ke Python segera (tidak menunggu ESP32-C3)
  server.send(200, "text/plain", "LEFT OK");
  // Kirim ke ESP32-C3 setelah response (non-blocking via FreeRTOS task)
  sendToVibrator("/left");
}

void handleRight()
{
  Serial.println("📥 Received RIGHT vibrate request from Python");
  // Kirim response ke Python segera (tidak menunggu ESP32-C3)
  server.send(200, "text/plain", "RIGHT OK");
  // Kirim ke ESP32-C3 setelah response (non-blocking via FreeRTOS task)
  sendToVibrator("/right");
}

// ===========================================================================
// KAMERA
// ===========================================================================
void serveJpg() {
  auto frame = esp32cam::capture();
  if (frame == nullptr) {
    Serial.println("CAPTURE FAILED!");
    server.send(503, "", "");
    return;
  }
  Serial.printf("CAPTURE OK %dx%d %db\n",
                frame->getWidth(), frame->getHeight(),
                static_cast<int>(frame->size()));

  server.setContentLength(frame->size());
  server.send(200, "image/jpeg");

  WiFiClient client = server.client();
  frame->writeTo(client);
}

void handleJpg() {
  if (!esp32cam::Camera.changeResolution(RES)) {
    Serial.println("CAN'T SET RESOLUTION!");
  }
  serveJpg();
}

void initCamera() {
  using namespace esp32cam;
  Config cfg;
  cfg.setPins(pins::AiThinker);
  cfg.setResolution(RES);
  cfg.setBufferCount(2);
  cfg.setJpeg(80);

  bool ok = Camera.begin(cfg);
  Serial.println(ok ? "CAMERA OK" : "CAMERA FAIL");
}

// ===========================================================================
// WIFI
// ===========================================================================
void initWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);

  Serial.println("Setting static IP configuration...");
  WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.println(WiFi.localIP());

  if (!MDNS.begin(HOSTNAME)) {
    Serial.println("mDNS start FAILED");
  }
  else {
    MDNS.addService("http", "tcp", 80);
  }
}

// ===========================================================================
// SERVER
// ===========================================================================
void initServer() {
  server.on(URL, handleJpg);

  // Endpoint untuk YOLO
  server.on("/left", handleLeft);
  server.on("/right", handleRight);

  server.begin();
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  initWifi();
  initCamera();
  initServer();

  Serial.println("SETUP DONE!");
}

// ===========================================================================
// LOOP
// ===========================================================================
void loop() {
  server.handleClient();
}
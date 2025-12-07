#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

// ======================
// WIFI CREDENTIALS
// ======================
const char* WIFI_SSID = "enumatechz";
const char* WIFI_PASS = "3numaTechn0l0gy";
const char* HOSTNAME = "esp32c3-vibrator";

// ======================
// IP STATIC (harus sesuai dengan IP di ESP32CAM_Capture.ino)
// ======================
IPAddress local_IP(192, 168, 1, 27);  // IP ESP32-C3 Vibrator
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// ======================
// PIN VIBRATOR
// ======================
#define VIB_LEFT 4
#define VIB_RIGHT 5

// ======================
// DURASI VIBRATE (ms)
// ======================
#define VIBRATE_DURATION 250

WebServer server(80);

// ===========================================================================
// FUNGSI VIBRATE
// ===========================================================================
void vibrateLeft() {
  digitalWrite(VIB_LEFT, HIGH);
  delay(VIBRATE_DURATION);
  digitalWrite(VIB_LEFT, LOW);
  Serial.println("📳 LEFT vibrator activated");
}

void vibrateRight() {
  digitalWrite(VIB_RIGHT, HIGH);
  delay(VIBRATE_DURATION);
  digitalWrite(VIB_RIGHT, LOW);
  Serial.println("📳 RIGHT vibrator activated");
}

// ===========================================================================
// HANDLERS
// ===========================================================================
void handleRoot() {
  server.send(200, "text/plain", "ESP32-C3 Vibrator Ready");
}

void handleLeft() {
  vibrateLeft();
  server.send(200, "text/plain", "LEFT OK");
}

void handleRight() {
  vibrateRight();
  server.send(200, "text/plain", "RIGHT OK");
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  // Setup pins
  pinMode(VIB_LEFT, OUTPUT);
  pinMode(VIB_RIGHT, OUTPUT);
  digitalWrite(VIB_LEFT, LOW);
  digitalWrite(VIB_RIGHT, LOW);

  Serial.println("ESP32-C3 Vibrator Starting...");
  Serial.println("Setting static IP configuration...");
  
  // Configure static IP
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // Setup mDNS
  if (!MDNS.begin(HOSTNAME)) {
    Serial.println("mDNS start FAILED");
  } else {
    Serial.print("mDNS started: http://");
    Serial.print(HOSTNAME);
    Serial.println(".local");
    MDNS.addService("http", "tcp", 80);
  }

  // Setup server routes
  server.on("/", handleRoot);
  server.on("/left", handleLeft);
  server.on("/right", handleRight);

  server.begin();
  Serial.println("Server started!");
  Serial.println("Ready to receive vibrate commands");
}

// ===========================================================================
// LOOP
// ===========================================================================
void loop() {
  server.handleClient();
  // Note: ESP32-C3 mDNS tidak memerlukan update() di loop
  // mDNS bekerja otomatis setelah MDNS.begin() dipanggil
}
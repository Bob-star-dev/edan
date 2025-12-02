#include "WebServer.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "esp32cam.h"

const char* WIFI_SSID = "enumatechz";
const char* WIFI_PASS = "3numaTechn0l0gy";
const char* URL = "/cam.jpg";
const char* HOSTNAME = "senavision";  // Nama DNS (akan menjadi senavision.local)

// Static IP Configuration (SOLUSI TERBAIK - IP tidak akan berubah)
// Uncomment dan sesuaikan dengan network Anda jika ingin menggunakan Static IP
// Cara mengetahui IP, Gateway, Subnet:
//   1. Upload code ini dulu (tanpa static IP)
//   2. Lihat Serial Monitor - akan menampilkan IP, Gateway, Subnet
//   3. Copy nilai-nilai tersebut ke bawah ini
//   4. Uncomment baris-baris di bawah dan upload lagi

IPAddress local_IP(192, 168, 1, 97);        // IP yang Anda inginkan
IPAddress gateway(192, 168, 1, 1);           // Ganti dengan gateway router Anda
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);            // DNS server (Google DNS)
IPAddress secondaryDNS(8, 8, 4, 4);          // DNS server backup

static auto RES = esp32cam::Resolution::find(800, 600);

WebServer server(80);

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
  {
    using namespace esp32cam;
    Config cfg;
    cfg.setPins(pins::AiThinker);
    cfg.setResolution(RES);
    cfg.setBufferCount(2);
    cfg.setJpeg(80);

    bool ok = Camera.begin(cfg);
    Serial.println(ok ? "CAMERA OK" : "CAMERA FAIL");
  }
}

void initWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  
  // Static IP Configuration (uncomment jika ingin menggunakan static IP)
  // Jika menggunakan static IP, IP tidak akan berubah meskipun router restart
  // UNCOMMENT BARIS DI BAWAH INI UNTUK MENGGUNAKAN STATIC IP:
  if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS)) {
    Serial.println("STA Failed to configure static IP!");
  }
  
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi connection FAILED!");
    return;
  }
  
  // Setup mDNS
  if (!MDNS.begin(HOSTNAME)) {
    Serial.println("Error setting up MDNS responder!");
  } else {
    Serial.println("mDNS responder started");
    MDNS.addService("http", "tcp", 80);
  }
  
  Serial.println("WiFi connected!");
  Serial.println("========================================");
  Serial.println("ESP32-CAM READY - Use this IP address:");
  Serial.printf(">>> http://%s%s <<<\n",
                WiFi.localIP().toString().c_str(), URL);
  Serial.println("========================================");
  Serial.printf("(mDNS: http://%s.local%s - may not work on Windows)\n", HOSTNAME, URL);
  Serial.println();
  Serial.println("INFO: Untuk Static IP (agar IP tidak berubah):");
  Serial.println("  1. Lihat IP, Gateway, Subnet di atas");
  Serial.println("  2. Uncomment bagian Static IP di code");
  Serial.println("  3. Sesuaikan nilai IP, Gateway, Subnet");
  Serial.println("  4. Upload ulang code");
  Serial.println("========================================");
}

void initServer() {
  server.on(URL, handleJpg);
  server.begin();
}

void setup() {
  Serial.begin(115200);
  initWifi();
  initCamera();
  initServer();
}

void loop() {
  server.handleClient();
}
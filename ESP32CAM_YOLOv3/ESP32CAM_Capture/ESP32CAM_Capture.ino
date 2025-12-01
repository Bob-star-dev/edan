#include "WebServer.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "esp32cam.h"

const char* WIFI_SSID = "enumatechz";
const char* WIFI_PASS = "3numaTechn0l0gy";
const char* URL = "/cam.jpg";
const char* HOSTNAME = "senavision";  // Nama DNS (akan menjadi senavision.local)

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
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED)
    ;
  
  // Setup mDNS
  if (!MDNS.begin(HOSTNAME)) {
    Serial.println("Error setting up MDNS responder!");
  } else {
    Serial.println("mDNS responder started");
    MDNS.addService("http", "tcp", 80);
  }
  
  Serial.println("WiFi connected!");
  Serial.printf("IP address: http://%s%s\n",
                WiFi.localIP().toString().c_str(), URL);
  Serial.printf("DNS address: http://%s.local%s\n", HOSTNAME, URL);
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
# Setup ESP32-CAM Vibration Motor

## Overview

Aplikasi web akan mengirim sinyal HTTP ke ESP32-CAM ketika object terdeteksi dalam jarak **≤150 cm**. ESP32-CAM akan menggetarkan kedua vibration motor secara bersamaan.

## Solusi: Upload Kode Arduino ke ESP32-CAM

**File kode lengkap:** `ESP32_CAM_VIBRATION.ino`

Kode ini sudah termasuk:
- ✅ Endpoint HTTP `/vibrate` untuk menerima sinyal dari aplikasi web
- ✅ Kontrol 2 vibration motor (MOTOR_R dan MOTOR_L) secara bersamaan
- ✅ Support parameter `duration` dan `pattern`
- ✅ CORS headers untuk web browser
- ✅ Limit durasi untuk melindungi motor (max 5000ms)

## Format Request yang Dikirim

Aplikasi web mengirim request dengan format berikut:

### 1. Simple Vibration (durasi tunggal)
```
GET http://esp32cam.local/vibrate?duration=200&t=1234567890
```
- Parameter `duration`: Durasi vibration dalam milidetik (ms)
- Parameter `t`: Timestamp untuk menghindari cache

### 2. Pattern Vibration (array pattern)
```
GET http://esp32cam.local/vibrate?pattern=200,100,200,100&t=1234567890
```
- Parameter `pattern`: Array pattern dipisahkan koma, format `[on, off, on, off, ...]` dalam milidetik
- Parameter `t`: Timestamp untuk menghindari cache

## Kode Arduino Lengkap

**File:** `ESP32_CAM_VIBRATION.ino`

File ini sudah lengkap dengan:
- Konfigurasi ESP32-CAM
- WiFi dan mDNS setup
- HTTP server dengan endpoint `/vibrate`
- Kontrol 2 vibration motor secara bersamaan
- Handler untuk Serial Monitor (testing manual)

**Cara menggunakan:**
1. Buka file `ESP32_CAM_VIBRATION.ino` di Arduino IDE
2. Sesuaikan SSID dan password WiFi (baris 7-8)
3. Pastikan pin motor sudah benar (MOTOR_R = GPIO 14, MOTOR_L = GPIO 15)
4. Upload ke ESP32-CAM
5. Test dengan browser: `http://esp32cam.local/vibrate?duration=500`

---

## Contoh Kode Arduino (untuk referensi)

Berikut adalah contoh kode sederhana jika Anda ingin menambahkan endpoint sendiri:

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

// Pin untuk vibration motor (sesuaikan dengan pin Anda)
#define VIBRATION_PIN 4  // Contoh: GPIO 4

WebServer server(80);

// Fungsi untuk mengontrol vibration motor
void vibrateMotor(int duration) {
  digitalWrite(VIBRATION_PIN, HIGH);  // Aktifkan motor
  delay(duration);                    // Tunggu sesuai durasi
  digitalWrite(VIBRATION_PIN, LOW);   // Matikan motor
}

// Handler untuk endpoint /vibrate
void handleVibrate() {
  // Ambil parameter duration atau pattern
  if (server.hasArg("duration")) {
    // Simple vibration dengan durasi tunggal
    int duration = server.arg("duration").toInt();
    duration = constrain(duration, 0, 5000); // Limit 0-5000ms
    
    Serial.printf("Vibration request: duration=%dms\n", duration);
    
    vibrateMotor(duration);
    
    server.send(200, "text/plain", "OK");
    
  } else if (server.hasArg("pattern")) {
    // Pattern vibration dengan array [on, off, on, off, ...]
    String patternStr = server.arg("pattern");
    
    // Parse pattern string (format: "200,100,200,100")
    int values[20]; // Max 20 values
    int count = 0;
    int startPos = 0;
    
    for (int i = 0; i <= patternStr.length(); i++) {
      if (i == patternStr.length() || patternStr.charAt(i) == ',') {
        if (count < 20) {
          values[count] = patternStr.substring(startPos, i).toInt();
          count++;
        }
        startPos = i + 1;
      }
    }
    
    Serial.printf("Vibration pattern request: %d values\n", count);
    
    // Execute pattern: [on, off, on, off, ...]
    for (int i = 0; i < count; i++) {
      if (i % 2 == 0) {
        // Even index = ON duration
        vibrateMotor(values[i]);
      } else {
        // Odd index = OFF duration (delay)
        delay(values[i]);
      }
    }
    
    server.send(200, "text/plain", "OK");
    
  } else {
    // Parameter tidak valid
    server.send(400, "text/plain", "Bad Request: Missing 'duration' or 'pattern' parameter");
  }
}

void setup() {
  Serial.begin(115200);
  
  // Setup vibration motor pin
  pinMode(VIBRATION_PIN, OUTPUT);
  digitalWrite(VIBRATION_PIN, LOW);
  
  // Setup WiFi (sesuaikan dengan kode WiFi Anda)
  // WiFi.begin(ssid, password);
  // ... kode WiFi setup ...
  
  // Setup mDNS (untuk esp32cam.local)
  if (!MDNS.begin("esp32cam")) {
    Serial.println("Error starting mDNS");
  }
  
  // Register endpoint /vibrate
  server.on("/vibrate", handleVibrate);
  
  // Start server
  server.begin();
  Serial.println("HTTP server started");
  Serial.println("Vibration endpoint: http://esp32cam.local/vibrate");
}

void loop() {
  server.handleClient();
}
```

## Wiring Vibration Motor ke ESP32-CAM

1. **Vibration Motor** terhubung ke **GPIO pin** (contoh: GPIO 4)
2. **Motor GND** terhubung ke **GND ESP32-CAM**
3. **Motor VCC** terhubung ke **GPIO pin** melalui **transistor/MOSFET** (jika motor membutuhkan arus besar)
   - Atau langsung ke GPIO jika motor kecil (< 40mA)

### Contoh Wiring dengan Transistor (Recommended)
```
Vibration Motor Positive → Collector Transistor
Vibration Motor Negative → GND
ESP32 GPIO Pin → Base Transistor (dengan resistor 1kΩ)
Transistor Emitter → GND
VCC (5V atau 3.3V) → Collector Transistor
```

## Testing

Setelah menambahkan endpoint, test dengan:

1. **Test dari browser:**
   ```
   http://esp32cam.local/vibrate?duration=500
   ```

2. **Test dari aplikasi web:**
   - Klik tombol "Test Getar" di aplikasi
   - Console akan menampilkan status response
   - Jika berhasil, vibration motor akan bergetar

## Troubleshooting

### Error 404 (Not Found)
- **Penyebab:** Endpoint `/vibrate` belum ada di firmware
- **Solusi:** Tambahkan endpoint `/vibrate` di kode Arduino seperti contoh di atas

### Vibration Motor Tidak Bergetar
- Periksa koneksi wiring motor ke ESP32-CAM
- Pastikan pin GPIO benar
- Cek apakah motor membutuhkan arus besar (perlu transistor)
- Test langsung dengan: `digitalWrite(VIBRATION_PIN, HIGH); delay(500); digitalWrite(VIBRATION_PIN, LOW);`

### CORS Error
- ESP32-CAM perlu menambahkan CORS headers (opsional):
  ```cpp
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "OK");
  ```

## Catatan Penting

1. **Sesuaikan pin GPIO** dengan pin yang Anda gunakan
2. **Limit durasi** untuk melindungi motor (max 5000ms di contoh)
3. **Gunakan transistor/MOSFET** jika motor membutuhkan arus > 40mA
4. **Pastikan mDNS aktif** untuk menggunakan `esp32cam.local`


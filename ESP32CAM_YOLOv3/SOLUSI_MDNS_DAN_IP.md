# Solusi Masalah mDNS Lambat dan IP Berubah

## Masalah:
1. **mDNS lambat** - Loading terlalu lama saat menggunakan `senavision.local`
2. **IP berubah** - Setiap kali router restart, IP ESP32-CAM berubah

## Solusi yang Tersedia:

### ✅ Solusi 1: Auto-Fallback (Sudah Diterapkan)
**File: `detect.py`**

Script sekarang akan:
- Mencoba mDNS dulu dengan timeout **2 detik** (tidak terlalu lama)
- Jika mDNS gagal/lambat, otomatis fallback ke IP address
- Tidak perlu edit code setiap kali

**Cara pakai:**
1. Set IP address di `detect.py`:
   ```python
   CAMERA_URL_IP = "http://192.168.1.100/cam.jpg"  # Ganti dengan IP ESP32-CAM Anda
   ```
2. Jalankan `python detect.py`
3. Script akan otomatis pilih yang tercepat (mDNS jika cepat, IP jika mDNS lambat)

---

### ✅ Solusi 2: Static IP (DISARANKAN - Solusi Terbaik)
**File: `ESP32CAM_Capture.ino`**

Dengan static IP:
- ✅ IP tidak akan berubah meskipun router restart
- ✅ Tidak perlu edit `detect.py` lagi
- ✅ Lebih cepat dan stabil

**Cara setup:**

1. **Upload code dulu tanpa static IP** (seperti biasa)
2. **Buka Serial Monitor** (115200 baud)
3. **Catat informasi ini:**
   - IP address: `192.168.1.XXX` (contoh: 192.168.1.100)
   - Gateway: Biasanya `192.168.1.1`
   - Subnet: Biasanya `255.255.255.0`

4. **Edit `ESP32CAM_Capture.ino`:**
   - Cari bagian Static IP Configuration (sekitar line 12-20)
   - Uncomment (hapus `//`) baris-baris ini:
   ```cpp
   IPAddress local_IP(192, 168, 1, 100);        // Ganti dengan IP yang diinginkan
   IPAddress gateway(192, 168, 1, 1);           // Ganti dengan gateway router Anda
   IPAddress subnet(255, 255, 255, 0);          // Biasanya 255.255.255.0
   IPAddress primaryDNS(8, 8, 8, 8);
   IPAddress secondaryDNS(8, 8, 4, 4);
   ```
   
   - Sesuaikan nilai `local_IP` dengan IP yang Anda inginkan (pastikan tidak conflict dengan device lain)
   - Sesuaikan `gateway` dengan IP router Anda

5. **Uncomment bagian WiFi.config** (sekitar line 60):
   ```cpp
   if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS)) {
     Serial.println("STA Failed to configure static IP!");
   }
   ```

6. **Upload ulang code ke ESP32-CAM**

7. **Update `detect.py`:**
   ```python
   CAMERA_URL_IP = "http://192.168.1.100/cam.jpg"  # IP static yang Anda set
   ```

**Keuntungan:**
- IP tidak akan berubah lagi
- Set sekali, pakai selamanya
- Lebih cepat karena langsung ke IP (tidak perlu resolve mDNS)

---

## Perbandingan Solusi:

| Solusi | Kecepatan | IP Berubah? | Setup |
|--------|-----------|-------------|-------|
| mDNS saja | Lambat (timeout lama) | Tidak | Mudah |
| IP Dynamic | Cepat | Ya (setiap router restart) | Mudah |
| **Static IP** | **Cepat** | **Tidak** | **Sedang** |
| **Auto-Fallback** | **Cepat** | **Ya (tapi auto-detect)** | **Mudah** |

## Rekomendasi:

**Gunakan Static IP** jika:
- ESP32-CAM akan dipakai jangka panjang
- Tidak ingin repot edit code lagi
- Ingin performa terbaik

**Gunakan Auto-Fallback** jika:
- Hanya testing/development
- Tidak ingin setup static IP
- IP berubah tidak masalah (script auto-detect)

---

## Troubleshooting:

**Q: Static IP tidak connect?**
- Pastikan IP tidak conflict dengan device lain di network
- Pastikan Gateway dan Subnet benar
- Cek router Anda - beberapa router tidak support static IP di client

**Q: mDNS masih lambat?**
- Set `MDNS_TIMEOUT = 1` di `detect.py` untuk timeout lebih pendek
- Atau langsung set `CAMERA_URL_IP` dan biarkan script skip mDNS

**Q: IP masih berubah meskipun sudah set static?**
- Beberapa router memaksa DHCP. Coba set IP di router (DHCP reservation)
- Atau gunakan IP range yang jarang dipakai (misalnya .200-.254)


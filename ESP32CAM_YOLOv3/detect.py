import cv2
import numpy as np
import urllib.request
import urllib.error
import socket
import sys
import time
import threading

# Camera URL configuration
# Option 1: mDNS hostname (senavision.local) - akan dicoba dulu dengan timeout pendek
# Option 2: Direct IP address (backup) - akan digunakan jika mDNS gagal atau lambat
# Option 3: Static IP (disarankan) - set IP statis di ESP32-CAM agar tidak berubah
CAMERA_URL_MDNS = "http://senavision.local/cam.jpg"
CAMERA_URL_IP = "http://192.168.1.97/cam.jpg"  # IP address ESP32-CAM Anda

# Timeout untuk mDNS (dalam detik) - jika lebih dari ini, akan fallback ke IP
MDNS_TIMEOUT = 2  # 2 detik cukup untuk mDNS yang cepat, tidak terlalu lama menunggu

# Konfigurasi vibrator
VIBRATE_DISTANCE_THRESHOLD = 1.5  # Jarak dalam meter untuk trigger vibrate
VIBRATE_DEBOUNCE_TIME = 0.5  # Waktu debounce dalam detik (mencegah spam request)

# YOLO model files
weights_path = r"./YOLO/yolov3.weights"
config_path = r"./YOLO/yolov3.cfg"
names_id_path = r"./YOLO/coco.names.id"

# Load the YOLO model and COCO class names (bahasa Indonesia)
net = cv2.dnn.readNet(weights_path, config_path)
with open(names_id_path, "r", encoding="utf-8") as f:
    classes = [line.strip() for line in f.readlines()]

# Mapping class_id ke nama Inggris untuk OBJECT_SIZES (sesuai urutan COCO dataset)
CLASS_NAMES_EN = [
    "person", "bicycle", "car", "motorbike", "aeroplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "sofa",
    "pottedplant", "bed", "diningtable", "toilet", "tvmonitor", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
    "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
]

layer_names = net.getLayerNames()

# Handling the return value of getUnconnectedOutLayers()
out_layers = net.getUnconnectedOutLayers()
if isinstance(out_layers[0], list):
    output_layers = [layer_names[i[0] - 1] for i in out_layers]
else:
    output_layers = [layer_names[i - 1] for i in out_layers]

# Generate random colors for each class
colors = np.random.uniform(0, 255, size=(len(classes), 3))

# Variabel global untuk debouncing vibrate (terpisah untuk kiri dan kanan)
last_vibrate_time_left = 0
last_vibrate_time_right = 0
vibrate_lock = threading.Lock()

# Focal length (dalam pixel) - dikalibrasi untuk ESP32-CAM dengan resolusi 800x600
# Nilai ini dapat disesuaikan untuk meningkatkan akurasi
FOCAL_LENGTH = 450  # Disesuaikan untuk akurasi lebih baik

# Faktor koreksi untuk meningkatkan akurasi (disesuaikan berdasarkan testing)
# Jika jarak terlalu jauh, kurangi faktor ini (misalnya 0.4-0.6)
# Jika jarak terlalu dekat, tingkatkan faktor ini (misalnya 0.7-0.9)
# Dikalibrasi: jarak asli 0.6m, menampilkan 1m -> faktor disesuaikan ke 0.45
DISTANCE_CORRECTION_FACTOR = 0.45  # Faktor koreksi untuk person dan objek lainnya

# Ukuran rata-rata objek dalam cm (tinggi untuk objek vertikal, lebar untuk objek horizontal)
# Digunakan untuk perhitungan jarak
OBJECT_SIZES = {
    "person": 160,  # Tinggi rata-rata orang dewasa Indonesia (cm) - disesuaikan
    "bicycle": 100,  # Tinggi sepeda (cm)
    "car": 150,  # Tinggi mobil (cm)
    "motorbike": 110,  # Tinggi motor (cm)
    "bus": 300,  # Tinggi bis (cm)
    "truck": 350,  # Tinggi truk (cm)
    "bird": 30,  # Tinggi burung (cm)
    "cat": 25,  # Tinggi kucing (cm)
    "dog": 50,  # Tinggi anjing (cm)
    "horse": 160,  # Tinggi kuda (cm)
    "sheep": 80,  # Tinggi domba (cm)
    "cow": 140,  # Tinggi sapi (cm)
    "elephant": 300,  # Tinggi gajah (cm)
    "bear": 150,  # Tinggi beruang (cm)
    "zebra": 140,  # Tinggi zebra (cm)
    "giraffe": 500,  # Tinggi jerapah (cm)
    "chair": 100,  # Tinggi kursi (cm)
    "sofa": 90,  # Tinggi sofa (cm)
    "bed": 50,  # Tinggi tempat tidur (cm)
    "diningtable": 75,  # Tinggi meja makan (cm)
    "tvmonitor": 60,  # Tinggi monitor TV (cm)
    "laptop": 3,  # Ketebalan laptop (cm) - gunakan lebar jika lebih akurat
    "bottle": 25,  # Tinggi botol (cm)
    "cup": 10,  # Tinggi cangkir (cm)
    "bowl": 8,  # Tinggi mangkuk (cm)
    # Tambahkan ukuran objek lain sesuai kebutuhan
}


def send_vibrate_signal(camera_base_url, side="left"):
    """
    Mengirim sinyal vibrate ke ESP32-CAM endpoint
    ESP32-CAM akan meneruskan sinyal ke ESP32-C3 vibrator menggunakan /left atau /right
    
    Args:
        camera_base_url: Base URL kamera (misalnya "http://senavision.local" atau "http://192.168.1.97")
        side: "left" atau "right" untuk menentukan vibrator mana yang diaktifkan
    """
    global last_vibrate_time_left, last_vibrate_time_right
    
    current_time = time.time()
    
    # Debouncing: hanya kirim jika sudah melewati waktu debounce (terpisah untuk kiri dan kanan)
    with vibrate_lock:
        if side == "left":
            if current_time - last_vibrate_time_left < VIBRATE_DEBOUNCE_TIME:
                return
            last_vibrate_time_left = current_time
        else:  # right
            if current_time - last_vibrate_time_right < VIBRATE_DEBOUNCE_TIME:
                return
            last_vibrate_time_right = current_time
    
    try:
        # Extract base URL (tanpa /cam.jpg)
        if "/cam.jpg" in camera_base_url:
            base_url = camera_base_url.replace("/cam.jpg", "")
        else:
            base_url = camera_base_url
        
        # Jika menggunakan mDNS, coba resolve ke IP dulu untuk menghindari masalah di thread
        # Tapi jika sudah IP, langsung pakai
        if "senavision.local" in base_url or ".local" in base_url:
            # Resolve mDNS ke IP untuk thread
            try:
                hostname = base_url.replace("http://", "").split("/")[0]
                ip = socket.gethostbyname(hostname)
                base_url = base_url.replace(hostname, ip)
            except:
                pass  # Jika gagal resolve, tetap pakai mDNS
        
        # Gunakan endpoint /left atau /right sesuai posisi objek
        endpoint = "/left" if side == "left" else "/right"
        vibrate_url = f"{base_url}{endpoint}"
        
        # Kirim request dalam thread terpisah agar tidak blocking
        def send_request():
            try:
                # Set socket timeout untuk thread ini
                socket.setdefaulttimeout(3)  # 3 detik timeout
                
                req = urllib.request.Request(vibrate_url)
                response = urllib.request.urlopen(req, timeout=3)
                response_code = response.getcode()
                response_data = response.read().decode('utf-8', errors='ignore')
                
                if response_code == 200:
                    print(f"✓ Vibrate signal sent to {vibrate_url} ({side.upper()} vibrator) - Response: {response_data.strip()}")
                else:
                    print(f"⚠ Vibrate signal sent but got response code {response_code}")
                    
            except socket.timeout:
                print(f"✗ Failed to send vibrate signal to {side}: socket timeout (3s)")
            except urllib.error.URLError as e:
                error_msg = str(e)
                if "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
                    print(f"✗ Failed to send vibrate signal to {side}: timeout (ESP32-CAM tidak merespons dalam 3 detik)")
                elif "Name or service not known" in error_msg or "nodename nor servname" in error_msg.lower():
                    print(f"✗ Failed to send vibrate signal to {side}: cannot resolve hostname")
                else:
                    print(f"✗ Failed to send vibrate signal to {side}: {error_msg}")
            except Exception as e:
                print(f"✗ Failed to send vibrate signal to {side}: {type(e).__name__}: {e}")
            finally:
                # Reset socket timeout
                socket.setdefaulttimeout(None)
        
        # Jalankan di thread terpisah
        thread = threading.Thread(target=send_request, daemon=True)
        thread.start()
        
    except Exception as e:
        print(f"✗ Error preparing vibrate signal: {e}")


def calculate_distance(pixel_height, class_id, pixel_width=None):
    """
    Menghitung jarak objek dari kamera dalam meter
    Menggunakan rumus: distance = (real_height * focal_length) / pixel_height
    Dengan faktor koreksi untuk meningkatkan akurasi
    
    Args:
        pixel_height: Tinggi objek dalam pixel
        class_id: ID class objek (0-79)
        pixel_width: Lebar objek dalam pixel (opsional, untuk koreksi tambahan)
    
    Returns:
        Jarak dalam meter, atau None jika ukuran objek tidak diketahui
    """
    if class_id >= len(CLASS_NAMES_EN):
        return None
    
    class_name_en = CLASS_NAMES_EN[class_id]
    if class_name_en not in OBJECT_SIZES:
        return None
    
    real_height_cm = OBJECT_SIZES[class_name_en]
    if pixel_height == 0:
        return None
    
    # Perhitungan dasar jarak
    distance_m = (real_height_cm * FOCAL_LENGTH) / (pixel_height * 100)
    
    # Untuk person, gunakan koreksi yang lebih spesifik
    if class_name_en == "person":
        # Faktor koreksi khusus untuk person (biasanya lebih akurat dengan tinggi)
        correction = DISTANCE_CORRECTION_FACTOR
    else:
        # Faktor koreksi untuk objek lain
        correction = DISTANCE_CORRECTION_FACTOR * 0.95
    
    # Terapkan faktor koreksi
    distance_m = distance_m * correction
    
    # Untuk person, jika ada lebar, bisa digunakan untuk validasi tambahan
    if class_name_en == "person" and pixel_width is not None and pixel_width > 0:
        # Lebar bahu rata-rata sekitar 40-45cm, bisa digunakan untuk cross-check
        # Tapi untuk sekarang kita fokus ke tinggi saja
        pass
    
    return round(distance_m, 1)


def detect_objects(frame, camera_url=None):
    height, width, _ = frame.shape
    blob = cv2.dnn.blobFromImage(frame, 1 / 255.0, (416, 416), swapRB=True, crop=False)
    net.setInput(blob)

    layer_outputs = net.forward(output_layers)

    boxes = []
    confidences = []
    class_ids = []

    for output in layer_outputs:
        for detection in output:
            scores = detection[5:]
            class_id = np.argmax(scores)
            confidence = scores[class_id]
            if confidence > 0.3:
                center_x = int(detection[0] * width)
                center_y = int(detection[1] * height)
                w = int(detection[2] * width)
                h = int(detection[3] * height)

                x = int(center_x - w / 2)
                y = int(center_y - h / 2)

                boxes.append([x, y, w, h])
                confidences.append(float(confidence))
                class_ids.append(class_id)

    indexes = cv2.dnn.NMSBoxes(boxes, confidences, 0.3, 0.4)

    # Flag untuk menandai apakah ada objek yang terlalu dekat
    object_too_close = False
    closest_distance = None
    objects_left = []  # List objek yang terlalu dekat di sisi kiri
    objects_right = []  # List objek yang terlalu dekat di sisi kanan

    # Draw detections on the frame
    if len(indexes) > 0 and isinstance(indexes, np.ndarray):
        indexes = indexes.flatten()
        for i in indexes:
            x, y, w, h = boxes[i]
            class_id = class_ids[i]
            label = classes[class_id] if class_id < len(classes) else f"class_{class_id}"
            confidence = confidences[i]
            color = colors[class_id]
            
            # Hitung jarak
            pixel_height = h
            pixel_width = w
            distance = calculate_distance(pixel_height, class_id, pixel_width)
            
            # Hitung posisi center objek untuk menentukan sisi
            center_x = x + w / 2
            
            # Cek jika jarak di bawah threshold
            if distance is not None and distance < VIBRATE_DISTANCE_THRESHOLD:
                object_too_close = True
                if closest_distance is None or distance < closest_distance:
                    closest_distance = distance
                
                # Tentukan apakah objek di kiri atau kanan frame
                if center_x < width / 2:
                    objects_left.append(distance)
                else:
                    objects_right.append(distance)
            
            # Format output sesuai permintaan
            if distance is not None:
                output_text = f"{label}\n{distance} meters"
                if distance < VIBRATE_DISTANCE_THRESHOLD:
                    output_text += " [TOO CLOSE!]"
                print(output_text)
            else:
                output_text = label
                print(output_text)

            # Tampilkan di frame dengan warna berbeda jika terlalu dekat
            display_text = f"{label}"
            if distance is not None:
                display_text += f" {distance}m"
                if distance < VIBRATE_DISTANCE_THRESHOLD:
                    # Gunakan warna merah untuk objek yang terlalu dekat
                    color = (0, 0, 255)  # BGR format untuk OpenCV
                    display_text += " [CLOSE!]"
            
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(
                frame,
                display_text,
                (x, y - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                color,
                2,
            )
    
    # Kirim sinyal vibrate jika ada objek yang terlalu dekat
    if object_too_close and camera_url:
        # Kirim sinyal ke vibrator kiri jika ada objek di sisi kiri
        if objects_left:
            send_vibrate_signal(camera_url, side="left")
        
        # Kirim sinyal ke vibrator kanan jika ada objek di sisi kanan
        if objects_right:
            send_vibrate_signal(camera_url, side="right")
        
        if closest_distance is not None:
            side_info = []
            if objects_left:
                side_info.append(f"LEFT ({len(objects_left)} objek)")
            if objects_right:
                side_info.append(f"RIGHT ({len(objects_right)} objek)")
            side_str = " & ".join(side_info) if side_info else ""
            print(f"⚠ WARNING: Object detected at {closest_distance}m (threshold: {VIBRATE_DISTANCE_THRESHOLD}m) [{side_str}]")

    return frame


def test_connection_fast(url_to_test, timeout=2):
    """
    Test koneksi dengan timeout pendek
    Returns (success, ip_address) jika berhasil, (False, None) jika gagal
    """
    try:
        # Extract hostname from URL
        if url_to_test.startswith("http://"):
            hostname = url_to_test.replace("http://", "").split("/")[0]
        else:
            hostname = url_to_test.split("/")[0]
        
        # Set socket timeout untuk mencegah loading terlalu lama
        socket.setdefaulttimeout(timeout)
        
        # Try to resolve hostname
        try:
            ip = socket.gethostbyname(hostname)
            print(f"✓ Resolved {hostname} to IP: {ip}")
            return True, ip
        except socket.gaierror:
            print(f"✗ Could not resolve hostname: {hostname}")
            return False, None
        except socket.timeout:
            print(f"✗ Timeout resolving {hostname} (lebih dari {timeout} detik)")
            return False, None
    except Exception as e:
        print(f"✗ Error testing connection: {e}")
        return False, None
    finally:
        # Reset timeout ke default
        socket.setdefaulttimeout(None)


def find_camera_url():
    """
    Mencari URL kamera yang bekerja:
    1. Coba mDNS dulu dengan timeout pendek
    2. Jika gagal/lambat, gunakan IP address (jika tersedia)
    3. Return URL yang bisa digunakan
    """
    print("Mencari kamera ESP32-CAM...")
    print(f"1. Mencoba mDNS ({CAMERA_URL_MDNS}) dengan timeout {MDNS_TIMEOUT}s...")
    
    # Coba mDNS dulu dengan timeout pendek
    success, ip = test_connection_fast(CAMERA_URL_MDNS, timeout=MDNS_TIMEOUT)
    
    if success:
        print("✓ mDNS berhasil! Menggunakan mDNS (lebih cepat).")
        return CAMERA_URL_MDNS
    
    # Jika mDNS gagal, coba IP address
    if CAMERA_URL_IP:
        print(f"\n2. mDNS gagal/lambat, mencoba IP address ({CAMERA_URL_IP})...")
        success, _ = test_connection_fast(CAMERA_URL_IP, timeout=2)
        if success:
            print("✓ IP address berhasil! Menggunakan IP address.")
            return CAMERA_URL_IP
        else:
            print("✗ IP address juga gagal.")
    else:
        print("\n2. IP address tidak dikonfigurasi (CAMERA_URL_IP = None)")
        print("   Edit detect.py dan set CAMERA_URL_IP dengan IP ESP32-CAM Anda")
    
    return None


def main():
    print("=" * 60)
    print("ESP32-CAM Object Detection with YOLOv3")
    print("=" * 60)
    print()
    
    # Cari URL kamera yang bekerja (mDNS dengan timeout, atau IP)
    url = find_camera_url()
    
    if not url:
        print("\n" + "=" * 60)
        print("ERROR - Tidak dapat terhubung ke ESP32-CAM")
        print("=" * 60)
        print("Solusi:")
        print("1. Pastikan ESP32-CAM menyala dan terhubung ke WiFi")
        print("2. Pastikan ESP32-CAM di jaringan yang sama dengan komputer ini")
        print("3. Set IP address di detect.py:")
        print("   CAMERA_URL_IP = 'http://192.168.1.XXX/cam.jpg'")
        print("   (Ganti XXX dengan IP ESP32-CAM dari Serial Monitor)")
        print()
        print("4. SOLUSI TERBAIK: Set Static IP di ESP32-CAM")
        print("   - IP tidak akan berubah")
        print("   - Tidak perlu edit detect.py lagi")
        print("   - Lihat ESP32CAM_Capture.ino untuk contoh")
        print("=" * 60)
        sys.exit(1)
    
    print(f"\n✓ Menggunakan: {url}")
    print("=" * 60)
    
    print("Connection test passed! Starting detection...")
    print("Press 'q' to quit")
    print()
    
    cv2.namedWindow("Object Detection", cv2.WINDOW_AUTOSIZE)
    
    # Connection timeout (5 seconds)
    timeout = 5
    
    while True:
        try:
            # Create request with timeout
            req = urllib.request.Request(url)
            img_resp = urllib.request.urlopen(req, timeout=timeout)
            imgnp = np.array(bytearray(img_resp.read()), dtype=np.uint8)
            frame = cv2.imdecode(imgnp, -1)
            
            if frame is None:
                print("Warning: Failed to decode image frame")
                continue
            
            frame = detect_objects(frame, camera_url=url)
            cv2.imshow("Object Detection", frame)

            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
                
        except urllib.error.URLError as e:
            print(f"Connection error: {e}")
            print("Make sure ESP32-CAM is connected and accessible")
            print("Press 'q' to quit or wait to retry...")
            # Wait a bit before retrying
            if cv2.waitKey(2000) & 0xFF == ord("q"):
                break
        except Exception as e:
            print(f"Error occurred: {e}")
            print("Press 'q' to quit or wait to retry...")
            if cv2.waitKey(2000) & 0xFF == ord("q"):
                break

    cv2.destroyAllWindows()
    print("Detection stopped.")


if __name__ == "__main__":
    main()
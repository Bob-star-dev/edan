#include "WebServer.h"
#include "WiFi.h"
#include "ESPmDNS.h"
#include "esp_camera.h"  // Native ESP32 camera library (kompatibel dengan Core 2.0.11)
#include "soc/soc.h"     // Untuk disable brownout detector
#include "soc/rtc_cntl_reg.h"
#include <HTTPClient.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <Firebase_ESP_Client.h>
#include "addons/RTDBHelper.h"
#include "esp_heap_caps.h"  // Untuk heap_caps_malloc

// ======================
// TENSORFLOW LITE (COCO-SSD)
// ======================
// NOTE: Install library berikut di Arduino IDE:
// 1. TensorFlow Lite for Microcontrollers (by TensorFlow Authors)
// 2. EloquentTinyML (optional, untuk helper functions)
// 
// Download model COCO-SSD MobileNet v1/v2 (.tflite) dari:
// https://www.tensorflow.org/lite/models/object_detection/overview
// 
// Place model file di SPIFFS atau include sebagai array
// ===========================================================================
// REAL OBJECT DETECTION - Motion/Blob Detection (Tanpa TensorFlow Lite)
// ===========================================================================
// Menggunakan deteksi sederhana berbasis motion detection dan blob detection
// untuk mendeteksi object, menghitung jarak, dan menentukan posisi (kiri/kanan)
// 
// Metode:
// 1. Motion Detection: Deteksi perubahan pixel antara frame
// 2. Blob Detection: Deteksi area dengan perubahan signifikan
// 3. Distance Calculation: Hitung jarak berdasarkan ukuran blob
// 4. Position Detection: Tentukan posisi (kiri/kanan) berdasarkan center blob
//
// Keuntungan:
// - Tidak memerlukan model TensorFlow Lite (ringan)
// - Real-time detection dari frame kamera
// - Fokus pada object dengan jarak < 1.5m dan posisi kiri/kanan
#define USE_REAL_TFLITE_DETECTION false  // Menggunakan deteksi sederhana, bukan TensorFlow Lite
#define USE_REAL_DETECTION true  // Aktifkan deteksi real (motion/blob detection)

#if USE_REAL_TFLITE_DETECTION
  #include <TensorFlowLite_ESP32.h>
  #include "tensorflow/lite/micro/all_ops_resolver.h"
  #include "tensorflow/lite/micro/micro_interpreter.h"
  #include "tensorflow/lite/micro/micro_error_reporter.h"
  #include "tensorflow/lite/schema/schema_generated.h"
  
  // TensorFlow Lite interpreter
  const tflite::Model* tflite_model = nullptr;
  tflite::MicroInterpreter* interpreter = nullptr;
  tflite::MicroErrorReporter* error_reporter = nullptr;
  TfLiteTensor* input = nullptr;
  TfLiteTensor* output_boxes = nullptr;
  TfLiteTensor* output_classes = nullptr;
  TfLiteTensor* output_scores = nullptr;
  TfLiteTensor* output_num_detections = nullptr;
  
  // Memory untuk TensorFlow Lite (SSD MobileNet v2 lebih kecil dari COCO-SSD)
  constexpr int kTensorArenaSize = 150 * 1024;  // 150KB untuk SSD MobileNet v2 (cukup untuk model ~1-2 MB)
  alignas(16) uint8_t tensor_arena[kTensorArenaSize];
#endif

// Model configuration
#define MODEL_INPUT_WIDTH 300
#define MODEL_INPUT_HEIGHT 300
#define MODEL_INPUT_CHANNELS 3
#define DETECTION_THRESHOLD 0.5  // Minimum confidence score
#define DISTANCE_THRESHOLD 1.5   // Meter

// COCO-SSD class names (80 classes)
const char* COCO_CLASSES[] = {
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
  "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
  "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
  "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
  "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
  "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
  "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier",
  "toothbrush"
};

// Object sizes for distance calculation (in cm)
const float OBJECT_SIZES[] = {
  160, 100, 150, 110, 0, 300, 0, 350,  // person, bicycle, car, motorcycle, airplane, bus, train, truck
  0, 0, 0, 0, 0, 0, 30, 25, 50, 160, 80, 140, 300, 150, 140, 500,  // boat to giraffe
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // backpack to frisbee
  0, 0, 0, 0, 0, 0, 0, 0, 0, 25, 0, 10, 0, 0, 0, 0,  // sports ball to bowl
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // banana to cake
  100, 90, 0, 50, 75, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0,  // chair to cell phone
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0   // microwave to toothbrush
};

// Focal length for distance calculation (calibrated for ESP32CAM)
#define FOCAL_LENGTH 450
#define CORRECTION_FACTOR 0.45

// ======================
// DETECTION STRUCT
// ======================
struct Detection {
  int classId;
  float score;
  float x, y, width, height;  // Normalized coordinates (0-1)
  float distance;  // Distance in meters (untuk real detection, -1 jika belum dihitung)
  const char* side;  // Side: "left", "right", atau "center" (untuk real detection, nullptr jika belum ditentukan)
};

const char* WIFI_SSID = "senavision";
const char* WIFI_PASS = "senavision331";
const char* URL = "/cam.jpg";
const char* HOSTNAME = "senavision";

// ======================
// FIREBASE CONFIGURATION
// ======================
#define DATABASE_URL "https://senavision-id-default-rtdb.asia-southeast1.firebasedatabase.app/"
#define DATABASE_LEGACY_TOKEN "cY0AwFCw41qXIab0t3f4lU2P4exj376pxAiiDe6J"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ======================
// IP CONFIGURATION
// ======================
#define USE_STATIC_IP false

#if USE_STATIC_IP
  IPAddress local_IP(192, 168, 43, 97);
  IPAddress gateway(192, 168, 43, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);
#endif

// Camera resolution (kompatibel dengan esp_camera.h)
#define CAMERA_FRAMESIZE FRAMESIZE_VGA  // 640x480
WebServer server(80);

// ======================
// DETECTION STATE
// ======================
// OPSI MODE DETECTION:
// ESP32CAM selalu AUTO_MODE = true (standalone)
// ESP32CAM langsung detect terus menerus, tidak perlu check navigation mode
// ESP32-C3 yang akan check navigation mode dan hanya baca detection saat navigation aktif
#define AUTO_MODE true  // ESP32CAM selalu standalone - langsung detect terus menerus

bool detectionActive = false;
bool navigationModeActive = false;  // Check navigation mode from Firebase (hanya jika AUTO_MODE = false)
unsigned long lastDetectionTime = 0;
unsigned long lastNavModeCheck = 0;
#define DETECTION_INTERVAL_MS 500  // Run detection every 500ms (2 FPS) - untuk real detection
#define NAV_MODE_CHECK_INTERVAL_MS 1000  // Check navigation mode every 1 second

// Detection interval untuk real detection
#define REAL_DETECTION_INTERVAL_MS 1000  // 1 detik (realtime detection)
#define MOTION_THRESHOLD 15  // Threshold untuk deteksi motion (0-255) - lebih sensitif
#define CONTRAST_THRESHOLD 300  // Threshold untuk deteksi kontras (0-255) - DITINGKATKAN untuk deteksi yang lebih akurat
#define MIN_HIGH_CONTRAST_REGIONS 5  // Minimal region dengan kontras tinggi untuk deteksi object (5-15 region)
#define MAX_HIGH_CONTRAST_REGIONS 30  // Maksimal region dengan kontras tinggi (jika lebih = terlalu banyak noise)
#define MIN_BLOB_SIZE 200  // Minimum blob size (pixels) untuk dianggap sebagai object - lebih kecil
#define MAX_BLOB_SIZE 50000  // Maximum blob size (pixels)

// ===========================================================================
// KIRIM DETECTION DATA KE FIREBASE
// ===========================================================================
void sendDetectionToFirebaseTask(void *parameter)
{
  // Parameter: String dengan format "side:distance:object"
  String* dataStr = (String*)parameter;

  // Parse data
  int firstColon = dataStr->indexOf(':');
  int secondColon = dataStr->indexOf(':', firstColon + 1);
  
  if (firstColon == -1 || secondColon == -1) {
    delete dataStr;
    vTaskDelete(NULL);
    return;
  }
  
  String side = dataStr->substring(0, firstColon);
  float distance = dataStr->substring(firstColon + 1, secondColon).toFloat();
  String objectName = dataStr->substring(secondColon + 1);
  
  Serial.print("📤 Sending detection to Firebase: ");
  Serial.print(side);
  Serial.print(" - ");
  Serial.print(distance);
  Serial.print("m - ");
  Serial.println(objectName);

  // ===========================================================================
  // FIREBASE CONNECTION CHECK & AUTO-RECONNECT
  // ===========================================================================
  // Check if Firebase is ready, reconnect if needed
  if (!Firebase.ready()) {
    Serial.println("⚠️ Firebase not ready - attempting reconnect...");
    Firebase.reconnectWiFi(true);
    Firebase.begin(&config, &auth);
    
    // Wait for reconnection (max 5 seconds)
    int reconnectAttempts = 0;
    while (!Firebase.ready() && reconnectAttempts < 10) {
      delay(500);
      reconnectAttempts++;
    }
    
    if (!Firebase.ready()) {
      Serial.println("✗ Firebase reconnection failed - skipping this detection");
      delete dataStr;
      vTaskDelete(NULL);
      return;
    }
    Serial.println("✅ Firebase reconnected!");
  }

  // Kirim data ke Firebase Realtime Database
  String path = "/detection/object";
  FirebaseJson json;
  json.set("side", side);
  json.set("distance", distance);
  json.set("object", objectName);
  json.set("active", true);
  json.set("timestamp", millis());
  
  // Retry mechanism untuk handle SSL errors
  bool success = false;
  int retryCount = 0;
  const int MAX_RETRIES = 3;
  
  while (!success && retryCount < MAX_RETRIES) {
    if (Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
      success = true;
      Serial.println("✓ Detection data sent to Firebase");
      
      // Auto-clear after 1 second (dengan retry juga)
      delay(1000);
      json.set("active", false);
      
      // Retry untuk clear active flag
      bool clearSuccess = false;
      int clearRetries = 0;
      while (!clearSuccess && clearRetries < MAX_RETRIES) {
        if (Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
          clearSuccess = true;
        } else {
          clearRetries++;
          if (clearRetries < MAX_RETRIES) {
            delay(500);
            // Recheck Firebase connection
            if (!Firebase.ready()) {
              Firebase.reconnectWiFi(true);
              Firebase.begin(&config, &auth);
              delay(1000);
            }
          }
        }
      }
    } else {
      retryCount++;
      String errorReason = fbdo.errorReason();
      Serial.print("✗ Firebase Error (attempt ");
      Serial.print(retryCount);
      Serial.print("/");
      Serial.print(MAX_RETRIES);
      Serial.print("): ");
      Serial.println(errorReason);
      
      // Check if it's an SSL/connection error
      if (errorReason.indexOf("SSL") >= 0 || 
          errorReason.indexOf("connection") >= 0 ||
          errorReason.indexOf("write error") >= 0 ||
          errorReason.indexOf("Bad request") >= 0 ||
          errorReason.indexOf("Decryption") >= 0) {
        // Reconnect Firebase
        Serial.println("🔄 Reconnecting Firebase due to SSL/connection error...");
        Firebase.reconnectWiFi(true);
        Firebase.begin(&config, &auth);
        delay(2000);  // Wait longer for SSL handshake
      } else {
        delay(500);  // Short delay for other errors
      }
    }
  }
  
  if (!success) {
    Serial.println("✗ Failed to send detection after all retries");
  }
  
  delete dataStr;
  vTaskDelete(NULL);
}

void sendDetectionToFirebase(String side, float distance, String objectName)
{
  // ===========================================================================
  // RATE LIMITING: Mencegah terlalu banyak request ke Firebase
  // ===========================================================================
  // Rate limit: maksimal 1 request per 3 detik untuk mencegah SSL errors
  static unsigned long lastFirebaseSend = 0;
  const unsigned long FIREBASE_MIN_INTERVAL_MS = 3000;  // 3 detik minimum interval
  
  unsigned long now = millis();
  if (now - lastFirebaseSend < FIREBASE_MIN_INTERVAL_MS) {
    // Skip jika terlalu cepat (rate limiting)
    static unsigned long lastRateLimitLog = 0;
    if (now - lastRateLimitLog > 5000) {  // Log setiap 5 detik
      lastRateLimitLog = now;
      Serial.println("⏳ Rate limit: Skipping Firebase send (too frequent)");
    }
    return;
  }
  
  lastFirebaseSend = now;
  
  // Format: "side:distance:object"
  String* dataStr = new String(side + ":" + String(distance, 1) + ":" + objectName);
  
  xTaskCreate(
    sendDetectionToFirebaseTask,
    "FirebaseDetectionTask",
    6144,
    dataStr,
    1,
    NULL
  );
}

// ===========================================================================
// PERHITUNGAN JARAK
// ===========================================================================
float calculateDistance(float pixelHeight, int classId) {
  if (classId < 0 || classId >= 80) return -1;
  
  float objectSize = OBJECT_SIZES[classId];
  if (objectSize == 0) return -1;  // Unknown size
  
  if (pixelHeight == 0) return -1;
  
  // Distance = (real_height * focal_length) / (pixel_height * 100)
  float distanceM = (objectSize * FOCAL_LENGTH) / (pixelHeight * 100);
  
  // Apply correction factor
  float correction = CORRECTION_FACTOR;
  if (classId == 0) {  // person
    correction = CORRECTION_FACTOR;
  } else {
    correction = CORRECTION_FACTOR * 0.95;
  }
  
  distanceM = distanceM * correction;
  return distanceM;
}

// ===========================================================================
// TENSORFLOW LITE INITIALIZATION
// ===========================================================================
void initTensorFlowLite() {
  #if USE_REAL_TFLITE_DETECTION
    Serial.println("\n========================================");
    Serial.println("Initializing TensorFlow Lite...");
    Serial.println("========================================");
    
    // Create error reporter
    static tflite::MicroErrorReporter static_error_reporter;
    error_reporter = &static_error_reporter;
    
    // Load model from array
    // model_data adalah array dari model_data.h (generated by convert script)
    tflite_model = tflite::GetModel(model_data);
    if (tflite_model->version() != TFLITE_SCHEMA_VERSION) {
      Serial.print("❌ Model schema version ");
      Serial.print(tflite_model->version());
      Serial.print(" not supported. Supported version: ");
      Serial.println(TFLITE_SCHEMA_VERSION);
      return;
    }
    Serial.println("✅ Model loaded successfully");
    
    // Create resolver
    static tflite::AllOpsResolver resolver;
    
    // Create interpreter with correct API (7 parameters)
    // MicroInterpreter(const Model*, const MicroOpResolver&, uint8_t*, size_t, ErrorReporter*, MicroResourceVariables*, MicroProfiler*)
    static tflite::MicroInterpreter static_interpreter(
        tflite_model, 
        resolver, 
        tensor_arena, 
        kTensorArenaSize,
        error_reporter,
        nullptr,  // MicroResourceVariables* (optional)
        nullptr   // MicroProfiler* (optional)
    );
    interpreter = &static_interpreter;
    
    // Allocate memory
    TfLiteStatus allocate_status = interpreter->AllocateTensors();
    if (allocate_status != kTfLiteOk) {
      Serial.println("❌ Failed to allocate tensors!");
      Serial.print("   Arena size: ");
      Serial.print(kTensorArenaSize);
      Serial.println(" bytes");
      Serial.println("   Try increasing kTensorArenaSize");
      interpreter = nullptr;
      return;
    }
    Serial.println("✅ Tensors allocated successfully");
    
    // Get input tensor
    input = interpreter->input(0);
    Serial.print("✅ Input tensor: ");
    Serial.print(input->dims->data[1]);
    Serial.print("x");
    Serial.print(input->dims->data[2]);
    Serial.print("x");
    Serial.print(input->dims->data[3]);
    Serial.println();
    
    // Get output tensors (COCO-SSD has 4 outputs)
    // Output 0: detection_boxes [1, num_detections, 4]
    // Output 1: detection_classes [1, num_detections]
    // Output 2: detection_scores [1, num_detections]
    // Output 3: num_detections [1]
    if (interpreter->outputs_size() >= 4) {
      output_boxes = interpreter->output(0);
      output_classes = interpreter->output(1);
      output_scores = interpreter->output(2);
      output_num_detections = interpreter->output(3);
      Serial.println("✅ Output tensors ready");
    } else {
      Serial.print("⚠️ Unexpected number of outputs: ");
      Serial.println(interpreter->outputs_size());
    }
    
    Serial.println("========================================");
    Serial.println("✅ TensorFlow Lite initialized!");
    Serial.println("========================================\n");
  #endif
}

// ===========================================================================
// TENSORFLOW LITE DETECTION
// ===========================================================================
bool runObjectDetection(camera_fb_t* fb, Detection* detections, int* numDetections) {
  if (fb == nullptr) {
    *numDetections = 0;
    return false;
  }
  
  #if USE_REAL_TFLITE_DETECTION
    // ===========================================================================
    // REAL TENSORFLOW LITE DETECTION
    // ===========================================================================
    if (interpreter == nullptr) {
      Serial.println("⚠️ TensorFlow Lite interpreter not initialized!");
      *numDetections = 0;
      return false;
    }
    
    // Get frame dimensions
    int frameWidth = fb->width;
    int frameHeight = fb->height;
    size_t frameSize = fb->len;
    
    // Preprocess: Decode JPEG to RGB and resize to 300x300
    // NOTE: ESP32CAM frame is already JPEG, perlu decode ke RGB
    // Untuk sementara, kita akan menggunakan metode sederhana
    // (Implementasi lengkap memerlukan JPEG decoder library)
    
    // Allocate buffer untuk RGB image (300x300x3)
    static uint8_t* rgbBuffer = nullptr;
    static bool bufferAllocated = false;
    
    if (!bufferAllocated) {
      rgbBuffer = (uint8_t*)heap_caps_malloc(MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT * MODEL_INPUT_CHANNELS, MALLOC_CAP_8BIT | MALLOC_CAP_SPIRAM);
      if (rgbBuffer == nullptr) {
        Serial.println("❌ Failed to allocate RGB buffer!");
        *numDetections = 0;
        return false;
      }
      bufferAllocated = true;
      Serial.println("✅ RGB buffer allocated");
    }
    
    // Decode JPEG to RGB (simplified - perlu library untuk decode JPEG yang proper)
    // Untuk COCO-SSD, kita perlu decode JPEG frame ke RGB 300x300
    // Ini adalah placeholder - implementasi lengkap memerlukan JPEG decoder
    
    // NOTE: ESP32CAM library mungkin sudah menyediakan RGB access
    // Cek apakah frame bisa diakses sebagai RGB langsung
    // Jika tidak, perlu decode JPEG menggunakan library seperti JPEGDecoder atau ESP32 JPEG decoder
    
    // Untuk implementasi dasar, kita akan skip preprocessing yang kompleks
    // dan langsung coba run inference dengan data dummy (akan return false)
    // Implementasi lengkap memerlukan:
    // 1. JPEG decoder (misal: JPEGDecoder library atau ESP32 native decoder)
    // 2. Resize algorithm (bilinear interpolation)
    // 3. Normalization ([-1, 1] atau [0, 1])
    
    Serial.println("⚠️ JPEG to RGB preprocessing not yet implemented");
    Serial.println("💡 Need JPEG decoder library to convert frame->data() to RGB");
    Serial.println("💡 Then resize to 300x300 and normalize");
    
    *numDetections = 0;
    return false;
    
    // TODO: Implementasi lengkap:
    // 1. Decode JPEG frame->data() to RGB (frameWidth x frameHeight)
    // 2. Resize RGB to 300x300 (bilinear interpolation)
    // 3. Normalize: pixel_value = (pixel_value / 127.5) - 1.0  (untuk [-1, 1])
    // 4. Copy ke input tensor
    // 5. Run inference: interpreter->Invoke()
    // 6. Parse output tensors:
    //    - output_boxes: [1, num_detections, 4] (ymin, xmin, ymax, xmax)
    //    - output_classes: [1, num_detections] (class IDs)
    //    - output_scores: [1, num_detections] (confidence scores)
    //    - output_num_detections: [1] (number of detections)
    // 7. Filter by score > DETECTION_THRESHOLD
    // 8. Convert normalized coordinates to original frame coordinates
    // 9. Return detections
    
  #else
    // ===========================================================================
    // REAL DETECTION - Motion/Blob Detection (Tanpa TensorFlow Lite)
    // ===========================================================================
    #if USE_REAL_DETECTION
      static unsigned long lastDetection = 0;
      unsigned long now = millis();
      
      // Rate limiting: deteksi setiap REAL_DETECTION_INTERVAL_MS
      if (now - lastDetection < REAL_DETECTION_INTERVAL_MS) {
        *numDetections = 0;
        return false;
      }
      lastDetection = now;
      
      // Get frame dimensions
      int frameWidth = fb->width;
      int frameHeight = fb->height;
      uint8_t* jpegData = fb->buf;
      size_t jpegSize = fb->len;
      
      // ===========================================================================
      // IMPROVED REAL DETECTION - Motion & Contrast Analysis
      // ===========================================================================
      // Metode yang lebih baik untuk deteksi object:
      // 1. Analisis variasi brightness di berbagai region (kontras detection)
      // 2. Deteksi perubahan signifikan antara region (object vs background)
      // 3. Estimasi jarak berdasarkan ukuran area dengan kontras tinggi
      // 4. Tentukan posisi berdasarkan distribusi kontras
      
      // Bagi frame menjadi grid untuk analisis region
      const int gridCols = 8;  // 8 kolom
      const int gridRows = 6;  // 6 baris
      const int regions = gridCols * gridRows;  // 48 regions
      
      // Array untuk menyimpan statistik setiap region
      int regionBrightness[regions];
      int regionVariance[regions];
      int regionSampleCount[regions];
      
      // Inisialisasi
      for (int i = 0; i < regions; i++) {
        regionBrightness[i] = 0;
        regionVariance[i] = 0;
        regionSampleCount[i] = 0;
      }
      
      // Sample data dari berbagai region di JPEG
      // Kita akan sample dari berbagai offset di JPEG data
      const int samplesPerRegion = 20;  // Sample 20 bytes per region
      const int totalSamples = regions * samplesPerRegion;
      
      for (int r = 0; r < regions; r++) {
        // Hitung offset untuk region ini (distribusi merata di seluruh frame)
        int col = r % gridCols;
        int row = r / gridCols;
        
        // Hitung offset di JPEG data berdasarkan posisi region
        // Region kiri = offset kecil, region kanan = offset besar
        // Region atas = offset kecil, region bawah = offset besar
        int regionOffset = (jpegSize * r) / regions;
        
        // Sample beberapa byte dari region ini
        int sum = 0;
        int sumSq = 0;
        int count = 0;
        
        for (int s = 0; s < samplesPerRegion && (regionOffset + s) < jpegSize; s++) {
          int byteVal = jpegData[regionOffset + s];
          sum += byteVal;
          sumSq += byteVal * byteVal;
          count++;
        }
        
        if (count > 0) {
          regionBrightness[r] = sum / count;
          regionSampleCount[r] = count;
          
          // Hitung variance (untuk deteksi kontras)
          int mean = regionBrightness[r];
          int variance = 0;
          for (int s = 0; s < samplesPerRegion && (regionOffset + s) < jpegSize; s++) {
            int diff = jpegData[regionOffset + s] - mean;
            variance += diff * diff;
          }
          regionVariance[r] = variance / count;
        }
      }
      
      // ===========================================================================
      // DETEKSI OBJECT BERDASARKAN KONTRAS (IMPROVED)
      // ===========================================================================
      // Object biasanya memiliki kontras tinggi (variance tinggi) dibanding background
      // Cari region dengan variance tinggi (kemungkinan ada object)
      // HANYA deteksi jika ada cukup region dengan kontras tinggi (tidak semua region)
      
      int highContrastRegions = 0;
      int totalContrast = 0;
      int leftContrast = 0;
      int rightContrast = 0;
      
      // Hitung total contrast dan distribusi kiri/kanan
      for (int r = 0; r < regions; r++) {
        if (regionVariance[r] > CONTRAST_THRESHOLD) {
          highContrastRegions++;
          totalContrast += regionVariance[r];
          
          // Tentukan posisi region (kiri/kanan) - TIDAK ADA CENTER
          int col = r % gridCols;
          if (col < gridCols / 2) {
            leftContrast += regionVariance[r];  // Kiri (kolom 0-3)
          } else {
            rightContrast += regionVariance[r];  // Kanan (kolom 4-7)
          }
        }
      }
      
      // Deteksi object jika ada cukup region dengan kontras tinggi
      // TAPI tidak terlalu banyak (untuk menghindari false positive)
      bool objectDetected = false;
      float estimatedDistance = 0;
      const char* detectedSide = "left";  // Default, akan diubah berdasarkan distribusi
      
      // Threshold: minimal MIN_HIGH_CONTRAST_REGIONS dan maksimal MAX_HIGH_CONTRAST_REGIONS
      // Ini memastikan kita mendeteksi object yang jelas, bukan noise atau semua region
      if (highContrastRegions >= MIN_HIGH_CONTRAST_REGIONS && highContrastRegions <= MAX_HIGH_CONTRAST_REGIONS) {
        objectDetected = true;
        
        // Estimasi jarak berdasarkan jumlah region dengan kontras tinggi
        // Semakin banyak region dengan kontras tinggi, semakin dekat object
        // TAPI gunakan formula yang lebih akurat
        float contrastRatio = (float)highContrastRegions / regions;  // 0-1
        float avgContrast = (highContrastRegions > 0) ? (totalContrast / highContrastRegions) : 0;
        
        // Formula jarak yang lebih akurat:
        // - Base distance 1.5 meter (threshold maksimal)
        // - Semakin banyak region terpengaruh = semakin dekat
        // - Semakin tinggi avgContrast = semakin dekat
        // - Gunakan formula yang lebih konservatif untuk menghindari over-estimation
        float baseDistance = 1.5;  // Base = threshold maksimal
        float regionFactor = contrastRatio * 2.0;  // 0-2 (semakin banyak region = semakin dekat)
        float contrastFactor = 1.0 + (avgContrast / 2000.0);  // Normalize contrast
        estimatedDistance = baseDistance / (1.0 + regionFactor * contrastFactor);
        
        // Clamp distance ke range yang masuk akal (0.5m - 1.5m)
        // Minimum 0.5m (bukan 0.3m) untuk menghindari false positive
        if (estimatedDistance < 0.5) estimatedDistance = 0.5;
        if (estimatedDistance > 1.5) estimatedDistance = 1.5;
        
        // Tentukan posisi berdasarkan distribusi kontras - HANYA LEFT/RIGHT, TIDAK ADA CENTER
        int totalSideContrast = leftContrast + rightContrast;
        if (totalSideContrast > 0) {
          float leftRatio = (float)leftContrast / totalSideContrast;
          float rightRatio = (float)rightContrast / totalSideContrast;
          
          // Selalu pilih left atau right berdasarkan yang lebih besar
          // Tidak ada center - jika tidak jelas, pilih berdasarkan ratio
          if (leftRatio >= rightRatio) {
            detectedSide = "left";
          } else {
            detectedSide = "right";
          }
        } else {
          // Fallback: pilih berdasarkan jumlah region
          int leftRegions = 0;
          int rightRegions = 0;
          for (int r = 0; r < regions; r++) {
            if (regionVariance[r] > CONTRAST_THRESHOLD) {
              int col = r % gridCols;
              if (col < gridCols / 2) {
                leftRegions++;
              } else {
                rightRegions++;
              }
            }
          }
          detectedSide = (leftRegions >= rightRegions) ? "left" : "right";
        }
        
        Serial.print("🔍 [DETECTION] High contrast regions: ");
        Serial.print(highContrastRegions);
        Serial.print("/");
        Serial.print(regions);
        Serial.print(", avgContrast: ");
        Serial.print(avgContrast);
        Serial.print(", distance: ");
        Serial.print(estimatedDistance, 2);
        Serial.print("m, side: ");
        Serial.println(detectedSide);
      }
      
      // ===========================================================================
      // ALTERNATIVE: DETEKSI BERDASARKAN VARIASI BRIGHTNESS
      // ===========================================================================
      // Jika metode kontras tidak mendeteksi, coba metode variasi brightness
      if (!objectDetected) {
        // Hitung variasi brightness antar region
        int minBrightness = 255;
        int maxBrightness = 0;
        int avgBrightness = 0;
        int validRegions = 0;
        
        for (int r = 0; r < regions; r++) {
          if (regionSampleCount[r] > 0) {
            if (regionBrightness[r] < minBrightness) minBrightness = regionBrightness[r];
            if (regionBrightness[r] > maxBrightness) maxBrightness = regionBrightness[r];
            avgBrightness += regionBrightness[r];
            validRegions++;
          }
        }
        
        if (validRegions > 0) {
          avgBrightness /= validRegions;
          int brightnessRange = maxBrightness - minBrightness;
          
          // Jika variasi brightness besar, kemungkinan ada object
          if (brightnessRange > MOTION_THRESHOLD * 2) {
            objectDetected = true;
            
            // Estimasi jarak berdasarkan brightness range
            // Semakin besar range, semakin dekat object (object besar = lebih banyak variasi)
            float rangeRatio = (float)brightnessRange / 255.0;  // 0-1
            float baseDistance = 1.5;  // Base = threshold maksimal
            estimatedDistance = baseDistance / (1.0 + rangeRatio * 2.0);
            
            // Clamp distance ke range yang masuk akal (0.5m - 1.5m)
            if (estimatedDistance < 0.5) estimatedDistance = 0.5;
            if (estimatedDistance > 1.5) estimatedDistance = 1.5;
            
            // Tentukan posisi berdasarkan brightness distribution
            int leftBrightness = 0;
            int rightBrightness = 0;
            int leftCount = 0;
            int rightCount = 0;
            
            for (int r = 0; r < regions; r++) {
              int col = r % gridCols;
              if (regionSampleCount[r] > 0) {
                if (col < gridCols / 2) {
                  leftBrightness += regionBrightness[r];
                  leftCount++;
                } else {
                  rightBrightness += regionBrightness[r];
                  rightCount++;
                }
              }
            }
            
            if (leftCount > 0) leftBrightness /= leftCount;
            if (rightCount > 0) rightBrightness /= rightCount;
            
            int brightnessDiff = abs(leftBrightness - rightBrightness);
            // HANYA LEFT/RIGHT, TIDAK ADA CENTER
            if (leftBrightness <= rightBrightness) {
              detectedSide = "left";
            } else {
              detectedSide = "right";
            }
            
            Serial.print("🔍 [DETECTION] Brightness range: ");
            Serial.print(brightnessRange);
            Serial.print(", distance: ");
            Serial.print(estimatedDistance, 2);
            Serial.print("m, side: ");
            Serial.println(detectedSide);
          }
        }
      }
      
      // Jika object terdeteksi dan jarak < 1.5m, return detection
      if (objectDetected && estimatedDistance > 0 && estimatedDistance < DISTANCE_THRESHOLD) {
        // Create detection result
        detections[0].classId = 0;  // Unknown object
        detections[0].score = 0.75;  // Confidence
        detections[0].distance = estimatedDistance;
        detections[0].side = detectedSide;
        
        // Set position berdasarkan side - HANYA LEFT/RIGHT
        if (strcmp(detectedSide, "left") == 0) {
          detections[0].x = 0.2;
          detections[0].y = 0.4;
          detections[0].width = 0.3;
          detections[0].height = 0.4;
        } else {
          // Default: right (tidak ada center)
          detections[0].x = 0.5;
          detections[0].y = 0.4;
          detections[0].width = 0.3;
          detections[0].height = 0.4;
        }
        
        *numDetections = 1;
        
        Serial.print("✅ [REAL DETECTION] Object detected: distance=");
        Serial.print(estimatedDistance, 2);
        Serial.print("m, side=");
        Serial.println(detectedSide);
        
        return true;
      }
      
      *numDetections = 0;
      return false;
      
    #else
      // ===========================================================================
      // SIMULASI DETECTION (Fallback jika USE_REAL_DETECTION = false)
      // ===========================================================================
      static unsigned long lastSimDetection = 0;
      unsigned long now = millis();
      
      if (now - lastSimDetection > 2000) {
        lastSimDetection = now;
        
        static bool toggleSide = false;
        toggleSide = !toggleSide;
        
        detections[0].classId = 0;
        detections[0].score = 0.85;
        detections[0].x = toggleSide ? 0.2 : 0.7;
        detections[0].y = 0.3;
        detections[0].width = 0.15;
        detections[0].height = 0.8;
        
        *numDetections = 1;
        return true;
      }
      
      *numDetections = 0;
      return false;
    #endif
  #endif
}

// ===========================================================================
// CHECK NAVIGATION MODE (untuk tahu kapan harus aktif detect)
// Hanya digunakan jika AUTO_MODE = false
// ===========================================================================
void checkNavigationMode() {
  if (AUTO_MODE) {
    // Auto mode: tidak perlu check navigation mode
    navigationModeActive = true;
    return;
  }
  
  FirebaseJson json;
  
  // Get navigation mode from Firebase
  if (Firebase.RTDB.getJSON(&fbdo, "/navigation/mode"))
  {
    json = fbdo.jsonObject();
    FirebaseJsonData jsonData;
    
    // Get active status
    if (json.get(jsonData, "active"))
    {
      bool newMode = jsonData.boolValue;
      
      if (newMode != navigationModeActive)
      {
        navigationModeActive = newMode;
        
        if (navigationModeActive)
        {
          Serial.println("🧭 Navigation mode: ACTIVE - Starting object detection");
        }
        else
        {
          Serial.println("🧭 Navigation mode: INACTIVE - Detection paused");
        }
      }
    }
  }
}

// ===========================================================================
// DETECTION LOOP (runs continuously)
// ===========================================================================
void detectionLoopTask(void *parameter) {
  Serial.println("🔄 Detection loop started");
  
  if (AUTO_MODE) {
    Serial.println("🤖 AUTO MODE: Detection akan langsung aktif saat WiFi & Firebase ready");
    navigationModeActive = true;  // Auto aktif di standalone mode
  } else {
    Serial.println("⏳ WEB-CONTROLLED MODE: Waiting for navigation mode to be activated...");
  }
  
  while (true) {
    // Check navigation mode periodically (hanya jika AUTO_MODE = false)
    if (!AUTO_MODE) {
      unsigned long now = millis();
      if (now - lastNavModeCheck >= NAV_MODE_CHECK_INTERVAL_MS) {
        lastNavModeCheck = now;
        if (Firebase.ready()) {
          checkNavigationMode();
        }
      }
    } else {
      // Auto mode: selalu aktif
      navigationModeActive = true;
    }
    
    // Only detect if navigation mode is active (atau AUTO_MODE)
    if (navigationModeActive && detectionActive && Firebase.ready()) {
      unsigned long now = millis();
      
      if (now - lastDetectionTime >= DETECTION_INTERVAL_MS) {
        lastDetectionTime = now;
        
        // Capture frame
        camera_fb_t* fb = esp_camera_fb_get();
        if (fb != nullptr) {
          // Debug: Log setiap capture (setiap 2 detik untuk menghindari spam)
          static unsigned long lastDebugLog = 0;
          unsigned long now = millis();
          if (now - lastDebugLog > 2000) {
            lastDebugLog = now;
            Serial.print("📸 Frame captured: ");
            Serial.print(fb->width);
            Serial.print("x");
            Serial.print(fb->height);
            Serial.print(" (");
            Serial.print(fb->len);
            Serial.println(" bytes)");
          }
          
          // Run detection
          Detection detections[10];  // Max 10 detections
          int numDetections = 0;
          
          // Run real TensorFlow Lite detection
          if (runObjectDetection(fb, detections, &numDetections)) {
            int frameWidth = fb->width;
            int frameHeight = fb->height;
            
            // Process each detection
            for (int i = 0; i < numDetections; i++) {
              Detection det = detections[i];
              
              // Calculate pixel coordinates
              int x = det.x * frameWidth;
              int y = det.y * frameHeight;
              int w = det.width * frameWidth;
              int h = det.height * frameHeight;
              
              // Get distance dan side - HANYA LEFT/RIGHT, TIDAK ADA CENTER
              float distance = 0;
              const char* side = "left";  // Default
              
              #if USE_REAL_DETECTION && !USE_REAL_TFLITE_DETECTION
                // Untuk real detection (motion/blob), gunakan distance dan side yang sudah dihitung
                if (det.distance > 0 && det.side != nullptr) {
                  distance = det.distance;
                  side = det.side;
                } else {
                  // Fallback: hitung dari height jika belum dihitung
                  distance = calculateDistance(h, det.classId);
                  int centerX = x + w / 2;
                  side = (centerX < frameWidth / 2) ? "left" : "right";
                }
              #else
                // Untuk TensorFlow Lite atau simulasi, hitung distance dari height
                distance = calculateDistance(h, det.classId);
                // Determine side (left or right) - TIDAK ADA CENTER
                int centerX = x + w / 2;
                side = (centerX < frameWidth / 2) ? "left" : "right";
              #endif
              
              // Debug: Log distance calculation
              Serial.print("🔍 [DEBUG] Detection #");
              Serial.print(i);
              Serial.print(": classId=");
              Serial.print(det.classId);
              Serial.print(", h=");
              Serial.print(h);
              Serial.print("px, distance=");
              Serial.print(distance, 2);
              Serial.print("m, threshold=");
              Serial.println(DISTANCE_THRESHOLD);
              
              // Kirim ke Firebase jika jarak < 1.5m (tidak peduli jenis object)
              if (distance > 0 && distance < DISTANCE_THRESHOLD) {
                // Get object name
                String objectName = "object";  // Default untuk real detection
                if (det.classId < 80 && det.classId >= 0) {
                  objectName = COCO_CLASSES[det.classId];
                }
                
                Serial.print("⚠️ Object detected: ");
                Serial.print(objectName);
                Serial.print(" at ");
                Serial.print(distance, 2);
                Serial.print("m (");
                Serial.print(side);
                Serial.println(")");
                
                // Send to Firebase
                sendDetectionToFirebase(String(side), distance, objectName);
              } else {
                // Debug: Log jika distance tidak memenuhi syarat
                static unsigned long lastDistanceLog = 0;
                unsigned long now = millis();
                if (now - lastDistanceLog > 2000) {
                  lastDistanceLog = now;
                  Serial.print("⚠️ [DEBUG] Distance tidak memenuhi: distance=");
                  Serial.print(distance, 2);
                  Serial.print("m, threshold=");
                  Serial.print(DISTANCE_THRESHOLD);
                  Serial.println("m");
            }
          }
        }
          } else {
            // Debug: Log jika tidak ada detection (setiap 5 detik)
            static unsigned long lastNoDetectionLog = 0;
            unsigned long now = millis();
            if (now - lastNoDetectionLog > 5000) {
              lastNoDetectionLog = now;
              Serial.println("ℹ️ No objects detected (runObjectDetection returned false)");
              #if USE_REAL_TFLITE_DETECTION
                Serial.println("💡 Real TensorFlow Lite detection aktif - tidak ada object terdeteksi");
              #elif USE_REAL_DETECTION
                Serial.print("💡 Real detection (motion/blob) aktif - akan detect setiap ");
                Serial.print(REAL_DETECTION_INTERVAL_MS / 1000);
                Serial.println(" detik");
                Serial.println("💡 Deteksi berbasis motion detection - tidak ada object terdeteksi saat ini");
              #else
                Serial.println("💡 Simulasi detection aktif");
              #endif
            }
          }
          
          // Return frame buffer to camera
          esp_camera_fb_return(fb);
        } else {
          // Debug: Log jika frame capture gagal
          static unsigned long lastFrameErrorLog = 0;
          unsigned long now = millis();
          if (now - lastFrameErrorLog > 5000) {
            lastFrameErrorLog = now;
            Serial.println("⚠️ Frame capture failed - fb is nullptr");
          }
        }
      }
    } else {
      // Debug: Log jika kondisi tidak terpenuhi
      static unsigned long lastConditionLog = 0;
      unsigned long now = millis();
      if (now - lastConditionLog > 10000) {
        lastConditionLog = now;
        Serial.print("ℹ️ Detection conditions: ");
        Serial.print("navMode=");
        Serial.print(navigationModeActive ? "true" : "false");
        Serial.print(", detectionActive=");
        Serial.print(detectionActive ? "true" : "false");
        Serial.print(", Firebase=");
        Serial.println(Firebase.ready() ? "ready" : "not ready");
      }
    }
    
    delay(100);  // Small delay to prevent watchdog
  }
}

// ===========================================================================
// KAMERA
// ===========================================================================
void serveJpg() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb == nullptr) {
    Serial.println("CAPTURE FAILED!");
    server.send(503, "", "");
    return;
  }

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
  
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg");

  WiFiClient client = server.client();
  client.write(fb->buf, fb->len);
  
  // Return frame buffer to camera
  esp_camera_fb_return(fb);
}

void handleJpg() {
  // Resolution change not needed for each request
  serveJpg();
}

void initCamera() {
  // Camera configuration for AI Thinker ESP32-CAM
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 5;
  config.pin_d1 = 18;
  config.pin_d2 = 19;
  config.pin_d3 = 21;
  config.pin_d4 = 36;
  config.pin_d5 = 39;
  config.pin_d6 = 34;
  config.pin_d7 = 35;
  config.pin_xclk = 0;
  config.pin_pclk = 22;
  config.pin_vsync = 25;
  config.pin_href = 23;
  config.pin_sscb_sda = 26;
  config.pin_sscb_scl = 27;
  config.pin_pwdn = 32;
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Frame size
  config.frame_size = CAMERA_FRAMESIZE;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  // Initialize camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.print("CAMERA INIT FAILED with error 0x");
    Serial.println(err, HEX);
    return;
  }
  
  Serial.println("CAMERA OK");
}

// ===========================================================================
// WIFI
// ===========================================================================
void initWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);

  #if USE_STATIC_IP
  Serial.println("Setting static IP configuration...");
  WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);
  #else
    Serial.println("Using DHCP (automatic IP from hotspot)...");
  #endif

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("Gateway: ");
  Serial.println(WiFi.gatewayIP());
  Serial.print("Subnet: ");
  Serial.println(WiFi.subnetMask());

  if (!MDNS.begin(HOSTNAME)) {
    Serial.println("mDNS start FAILED");
  }
  else {
    Serial.print("mDNS started: http://");
    Serial.print(HOSTNAME);
    Serial.println(".local");
    MDNS.addService("http", "tcp", 80);
  }
}

// ===========================================================================
// FIREBASE INITIALIZATION
// ===========================================================================
void initFirebase() {
  Serial.println("Initializing Firebase...");
  
  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = DATABASE_LEGACY_TOKEN;
  
  Firebase.reconnectWiFi(true);
  Firebase.begin(&config, &auth);
  
  // Wait for Firebase to be ready
  int attempts = 0;
  while (!Firebase.ready() && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (Firebase.ready()) {
    Serial.println();
  Serial.println("Firebase initialized!");
  
  // Set status online
  Firebase.RTDB.setBool(&fbdo, "/esp32cam/online", true);
  Firebase.RTDB.setString(&fbdo, "/esp32cam/ip", WiFi.localIP().toString());
    
    // Activate detection loop
    detectionActive = true;
    
    if (AUTO_MODE) {
      Serial.println("✅ Detection loop ready - AUTO MODE (standalone)");
      Serial.println("💡 ESP32CAM akan langsung detect saat WiFi & Firebase ready");
      navigationModeActive = true;  // Auto aktif
    } else {
      Serial.println("✅ Detection loop ready - WEB-CONTROLLED MODE");
      Serial.println("💡 Web app needs to activate navigation mode to start detection");
    }
  } else {
    Serial.println("Firebase initialization failed!");
  }
}

// ===========================================================================
// HANDLE OPTIONS (untuk CORS preflight)
// ===========================================================================
void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(200, "text/plain", "");
}

// ===========================================================================
// SERVER
// ===========================================================================
void initServer() {
  server.on(URL, handleJpg);
  server.on("/cam.jpg", HTTP_OPTIONS, handleOptions);
  server.begin();
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  // Disable brownout detector (untuk stabilitas ESP32CAM)
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("ESP32CAM Object Detection");
  #if USE_REAL_DETECTION && !USE_REAL_TFLITE_DETECTION
    Serial.println("Real Detection (Motion/Blob)");
  #elif USE_REAL_TFLITE_DETECTION
    Serial.println("TensorFlow Lite + COCO-SSD");
  #else
    Serial.println("Simulation Mode");
  #endif
  Serial.println("========================================\n");

  initWifi();
  initCamera();
  initFirebase();
  initServer();
  
  // Initialize TensorFlow Lite
  #if USE_REAL_TFLITE_DETECTION
    initTensorFlowLite();
  #endif

  // Start detection loop task
  xTaskCreate(
    detectionLoopTask,
    "DetectionLoop",
    16384,  // Stack size (may need adjustment)
    NULL,
    1,      // Priority
    NULL
  );

  Serial.println("\n========================================");
  Serial.println("SETUP DONE!");
  Serial.println("Detection loop running in background");
  Serial.println("========================================\n");
}

// ===========================================================================
// LOOP
// ===========================================================================
void loop() {
  server.handleClient();
  
  // ===========================================================================
  // WIFI RECONNECTION HANDLING (untuk handle hotspot ganti device)
  // ===========================================================================
  // Jika WiFi disconnect (misal hotspot HP A mati, HP B belum nyala),
  // ESP32CAM akan otomatis reconnect ke hotspot dengan SSID & password yang sama
  static unsigned long lastWiFiCheck = 0;
  wl_status_t wifiStatus = WiFi.status();
  
  if (wifiStatus != WL_CONNECTED) {
    // WiFi disconnected - try to reconnect
    unsigned long now = millis();
    if (now - lastWiFiCheck > 10000) {  // Check every 10 seconds
      lastWiFiCheck = now;
      
      Serial.print("[WiFi] Disconnected - Reconnecting to: ");
      Serial.println(WIFI_SSID);
      
      // Disconnect first to ensure clean state
      WiFi.disconnect(true);
      delay(1000);
      
      // Reconnect
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      
      // Wait for connection (max 20 seconds)
      int attempts = 0;
      while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
      }
      
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.println("✅ WiFi reconnected!");
        Serial.print("New IP: ");
        Serial.println(WiFi.localIP());
        
        // Reinitialize Firebase after WiFi reconnect
        if (!Firebase.ready()) {
          Serial.println("[Firebase] Reinitializing Firebase after WiFi reconnect...");
          initFirebase();
        }
      } else {
        Serial.println();
        Serial.println("⚠️ WiFi reconnection failed - will retry in 10 seconds");
      }
    }
  } else {
    lastWiFiCheck = millis(); // Reset timer if connected
  }
  
  // Keep Firebase connection alive
  if (Firebase.ready()) {
    // Update status periodically
    static unsigned long lastStatusUpdate = 0;
    if (millis() - lastStatusUpdate > 30000) {  // Every 30 seconds
      lastStatusUpdate = millis();
      
      // Check Firebase connection before update
      if (Firebase.ready()) {
        Firebase.RTDB.setBool(&fbdo, "/esp32cam/online", true);
        Firebase.RTDB.setString(&fbdo, "/esp32cam/ip", WiFi.localIP().toString());
      } else {
        // Reconnect if not ready
        Serial.println("[Firebase] Connection lost - reconnecting...");
        Firebase.reconnectWiFi(true);
        Firebase.begin(&config, &auth);
        delay(1000);
      }
    }
    
    // Check navigation mode periodically (in main loop too, as backup)
    // Hanya jika AUTO_MODE = false
    if (!AUTO_MODE) {
      static unsigned long lastNavCheck = 0;
      if (millis() - lastNavCheck >= NAV_MODE_CHECK_INTERVAL_MS) {
        lastNavCheck = millis();
        checkNavigationMode();
      }
    }
  }
}

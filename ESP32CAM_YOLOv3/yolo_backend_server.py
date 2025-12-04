#!/usr/bin/env python3
"""
Backend Server untuk YOLO Object Detection
Menjalankan detect.py di background dan menyediakan API untuk kontrol dari aplikasi web
"""

import sys
import os
import threading
import time
from flask import Flask, jsonify
from flask_cors import CORS
import atexit
import cv2
import numpy as np
import urllib.request
import urllib.error

# Path untuk import detect module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__)
CORS(app)  # Enable CORS untuk akses dari aplikasi web

# Global state
detection_process = None
detection_thread = None
is_running = False
camera_url = None
last_detection_result = {
    "objects": [],
    "timestamp": None,
    "status": "stopped"
}

def run_detection_loop():
    """Loop utama untuk deteksi objek - berjalan di background thread"""
    global is_running, camera_url, last_detection_result
    
    # Import detect module di dalam fungsi untuk lazy loading
    import detect as detect_module
    
    print("[YOLO Backend] Starting detection loop...")
    
    # Cari URL kamera
    if not camera_url:
        camera_url = detect_module.find_camera_url()
        if not camera_url:
            last_detection_result = {
                "objects": [],
                "timestamp": time.time(),
                "status": "error",
                "error": "Cannot connect to ESP32-CAM"
            }
            is_running = False
            return
    
    print(f"[YOLO Backend] Using camera URL: {camera_url}")
    timeout = 5
    
    while is_running:
        try:
            # Ambil frame dari ESP32-CAM
            req = urllib.request.Request(camera_url)
            img_resp = urllib.request.urlopen(req, timeout=timeout)
            imgnp = np.array(bytearray(img_resp.read()), dtype=np.uint8)
            frame = cv2.imdecode(imgnp, -1)
            
            if frame is None:
                print("[YOLO Backend] Warning: Failed to decode image frame")
                time.sleep(0.5)
                continue
            
            # Deteksi objek
            height, width, _ = frame.shape
            
            blob = cv2.dnn.blobFromImage(frame, 1 / 255.0, (416, 416), swapRB=True, crop=False)
            detect_module.net.setInput(blob)
            layer_outputs = detect_module.net.forward(detect_module.output_layers)
            
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
            
            detected_objects = []
            objects_left = []
            objects_right = []
            closest_distance = None
            
            if len(indexes) > 0 and isinstance(indexes, np.ndarray):
                indexes = indexes.flatten()
                for i in indexes:
                    x, y, w, h = boxes[i]
                    class_id = class_ids[i]
                    label = detect_module.classes[class_id] if class_id < len(detect_module.classes) else f"class_{class_id}"
                    confidence = confidences[i]
                    
                    # Hitung jarak
                    pixel_height = h
                    pixel_width = w
                    distance = detect_module.calculate_distance(pixel_height, class_id, pixel_width)
                    
                    # Tentukan posisi (kiri/kanan)
                    center_x = x + w / 2
                    side = "left" if center_x < width / 2 else "right"
                    
                    obj_data = {
                        "label": label,
                        "confidence": round(float(confidence), 2),
                        "distance": distance,
                        "side": side,
                        "bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)}
                    }
                    
                    detected_objects.append(obj_data)
                    
                    # Cek jika terlalu dekat
                    if distance is not None and distance < detect_module.VIBRATE_DISTANCE_THRESHOLD:
                        if side == "left":
                            objects_left.append(distance)
                        else:
                            objects_right.append(distance)
                        
                        if closest_distance is None or distance < closest_distance:
                            closest_distance = distance
            
            # Update hasil deteksi
            last_detection_result = {
                "objects": detected_objects,
                "timestamp": time.time(),
                "status": "running",
                "closest_distance": closest_distance,
                "objects_too_close": {
                    "left": len(objects_left) > 0,
                    "right": len(objects_right) > 0,
                    "count_left": len(objects_left),
                    "count_right": len(objects_right)
                }
            }
            
            # Kirim sinyal vibrate jika ada objek terlalu dekat
            if closest_distance is not None and closest_distance < detect_module.VIBRATE_DISTANCE_THRESHOLD:
                import urllib.request
                base_url = camera_url.replace("/cam.jpg", "")
                
                if objects_left:
                    try:
                        vibrate_url = f"{base_url}/left"
                        urllib.request.urlopen(vibrate_url, timeout=1)
                        print(f"[YOLO Backend] ⚠️ Vibrate LEFT - Object at {closest_distance}m")
                    except:
                        pass
                
                if objects_right:
                    try:
                        vibrate_url = f"{base_url}/right"
                        urllib.request.urlopen(vibrate_url, timeout=1)
                        print(f"[YOLO Backend] ⚠️ Vibrate RIGHT - Object at {closest_distance}m")
                    except:
                        pass
            
            # Sleep untuk mengurangi beban CPU
            time.sleep(0.3)  # ~3 FPS
            
        except urllib.error.URLError as e:
            print(f"[YOLO Backend] Connection error: {e}")
            last_detection_result = {
                "objects": [],
                "timestamp": time.time(),
                "status": "error",
                "error": str(e)
            }
            time.sleep(2)
        except Exception as e:
            print(f"[YOLO Backend] Error: {e}")
            last_detection_result = {
                "objects": [],
                "timestamp": time.time(),
                "status": "error",
                "error": str(e)
            }
            time.sleep(1)
    
    print("[YOLO Backend] Detection loop stopped")
    last_detection_result["status"] = "stopped"


@app.route('/api/status', methods=['GET'])
def get_status():
    """Get status deteksi saat ini"""
    return jsonify({
        "running": is_running,
        "camera_url": camera_url,
        "last_result": last_detection_result
    })


@app.route('/api/start', methods=['POST'])
def start_detection():
    """Start deteksi objek di background"""
    global is_running, detection_thread, camera_url
    
    if is_running:
        return jsonify({"success": True, "message": "Already running"})
    
    # Cari URL kamera
    camera_url = find_camera_url()
    if not camera_url:
        return jsonify({
            "success": False,
            "error": "Cannot connect to ESP32-CAM. Check network connection."
        }), 400
    
    is_running = True
    detection_thread = threading.Thread(target=run_detection_loop, daemon=True)
    detection_thread.start()
    
    return jsonify({
        "success": True,
        "message": "Detection started",
        "camera_url": camera_url
    })


@app.route('/api/stop', methods=['POST'])
def stop_detection():
    """Stop deteksi objek"""
    global is_running
    
    is_running = False
    
    return jsonify({
        "success": True,
        "message": "Detection stopped"
    })


@app.route('/api/check-camera', methods=['GET'])
def check_camera():
    """Check koneksi ke ESP32-CAM"""
    global camera_url
    
    # Lazy import
    import detect as detect_module
    test_url = detect_module.find_camera_url()
    return jsonify({
        "connected": test_url is not None,
        "url": test_url
    })


@app.route('/api/detections', methods=['GET'])
def get_detections():
    """Get hasil deteksi terbaru"""
    return jsonify(last_detection_result)


# Cleanup saat aplikasi ditutup
def cleanup():
    global is_running
    is_running = False
    print("[YOLO Backend] Cleaning up...")

atexit.register(cleanup)

if __name__ == '__main__':
    print("=" * 60)
    print("YOLO Object Detection Backend Server")
    print("=" * 60)
    print("API Endpoints:")
    print("  GET  /api/status - Get status")
    print("  POST /api/start - Start detection")
    print("  POST /api/stop - Stop detection")
    print("  GET  /api/check-camera - Check ESP32-CAM connection")
    print("  GET  /api/detections - Get latest detections")
    print("=" * 60)
    print()
    
    # Jalankan server
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)


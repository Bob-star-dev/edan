import type { NextApiRequest, NextApiResponse } from 'next';

// Proxy untuk ESP32 MJPEG stream - mengambil frame individual untuk menghindari masalah browser dengan MJPEG
// Stream URL biasanya di port 81: http://ESP32_IP:81/stream
const ESP32_IP = process.env.NEXT_PUBLIC_ESP32_IP || '192.168.1.19';
const ESP32_STREAM_URL = `http://${ESP32_IP}:81/stream`;

// Cache untuk frame terakhir
let lastFrame: Buffer | null = null;
let lastFrameTime = 0;
const FRAME_CACHE_MS = 100; // Cache frame selama 100ms

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const cacheBust = req.query.t ? `?t=${req.query.t}` : '';
    const now = Date.now();
    
    // Jika frame masih dalam cache, gunakan cache tersebut
    if (lastFrame && (now - lastFrameTime) < FRAME_CACHE_MS) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.status(200).send(lastFrame);
      return;
    }

    // Timeout untuk menghindari koneksi yang menggantung
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 5000); // 5 detik timeout
    
    // Fetch dari stream endpoint - ini akan mengembalikan frame JPEG pertama dari stream
    // Catatan: MJPEG stream adalah multipart, jadi kita ambil frame pertama saja
    const upstream = await fetch(`${ESP32_STREAM_URL}${cacheBust}`, {
      cache: 'no-store',
      signal: ac.signal,
      headers: {
        'Connection': 'keep-alive',
      },
    });
    
    clearTimeout(timeout);

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: 'ESP32 stream error',
        message: `ESP32-CAM stream returned status ${upstream.status}. Please check ESP32-CAM status.`
      });
      return;
    }

    // Baca body sebagai buffer dan ambil frame JPEG pertama
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Untuk MJPEG stream, kita perlu extract frame JPEG pertama
    // Format MJPEG: --boundary\r\nContent-Type: image/jpeg\r\nContent-Length: xxx\r\n\r\n[JPEG data]\r\n--boundary
    let jpegStart = -1;
    let jpegEnd = -1;
    
    // Cari start JPEG (0xFF 0xD8)
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
        jpegStart = i;
        break;
      }
    }
    
    // Cari end JPEG (0xFF 0xD9)
    if (jpegStart >= 0) {
      for (let i = jpegStart + 2; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD9) {
          jpegEnd = i + 2;
          break;
        }
      }
    }
    
    // Extract frame JPEG
    let frameData: Buffer;
    if (jpegStart >= 0 && jpegEnd > jpegStart) {
      frameData = buffer.subarray(jpegStart, jpegEnd);
    } else {
      // Jika tidak bisa parse MJPEG, gunakan seluruh buffer (mungkin sudah JPEG langsung)
      frameData = buffer;
    }
    
    // Simpan ke cache
    lastFrame = frameData;
    lastFrameTime = now;

    // Set headers dan kirim frame
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.status(200).send(frameData);
    
  } catch (err: any) {
    console.error('ESP32-CAM stream proxy error:', err?.message || err);
    
    if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT') {
      res.status(504).json({
        error: 'ESP32 stream timeout',
        message: `Cannot connect to ESP32-CAM stream at ${ESP32_STREAM_URL}. Please check if ESP32 is powered and on the same network.`
      });
    } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'ESP32 stream unreachable',
        message: `Cannot reach ESP32-CAM stream at ${ESP32_STREAM_URL}. Please verify the IP address is correct.`
      });
    } else {
      res.status(500).json({
        error: 'Stream proxy error',
        message: err?.message || 'Unknown error occurred while fetching ESP32-CAM stream'
      });
    }
  }
}

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
  },
};

import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'stream';

// Simple same-origin proxy for ESP32 /capture to avoid CORS-tainted canvas
// NOTE: IP harus sama dengan yang ada di ObjectDetectionCamera.tsx
// Bisa dikonfigurasi via environment variable NEXT_PUBLIC_ESP32_IP jika perlu
const ESP32_IP = process.env.NEXT_PUBLIC_ESP32_IP || '192.168.1.19';
const ESP32_CAPTURE_URL = `http://${ESP32_IP}/capture`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const cacheBust = req.query.t ? `?t=${req.query.t}` : '';
    const upstreamUrl = `${ESP32_CAPTURE_URL}${cacheBust}`;

    // Timeout fetch to avoid hanging connections
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 5000);
    const upstream = await fetch(upstreamUrl, { cache: 'no-store', signal: ac.signal });
    clearTimeout(timeout);
    if (!upstream.ok) {
      res.status(upstream.status).json({ 
        error: 'ESP32 upstream error', 
        message: `ESP32-CAM returned status ${upstream.status}. Please check ESP32-CAM status.` 
      });
      return;
    }

    // Prevent caching and set proper content type
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Stream body directly to response for lower latency
    const body = upstream.body as unknown as Readable | null;
    if (body) {
      if ((body as any).readable === undefined && typeof (Readable as any).fromWeb === 'function') {
        const nodeStream = (Readable as any).fromWeb(upstream.body as any);
        nodeStream.pipe(res);
      } else {
        body.pipe(res);
      }
    } else {
      // Fallback: read into buffer if no stream (unlikely)
      const arrayBuffer = await upstream.arrayBuffer();
      res.status(200).send(Buffer.from(arrayBuffer));
    }
  } catch (err: any) {
    // Error handling yang lebih informatif
    console.error('ESP32-CAM proxy error:', err?.message || err);
    
    // Jika error karena timeout atau network, beri pesan yang jelas
    if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT') {
      res.status(504).json({ 
        error: 'ESP32 timeout', 
        message: `Cannot connect to ESP32-CAM at ${ESP32_IP}. Please check if ESP32 is powered and on the same network.` 
      });
    } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED') {
      res.status(503).json({ 
        error: 'ESP32 unreachable', 
        message: `Cannot reach ESP32-CAM at ${ESP32_IP}. Please verify the IP address is correct.` 
      });
    } else {
      res.status(500).json({ 
        error: 'Proxy error', 
        message: err?.message || 'Unknown error occurred while fetching from ESP32-CAM' 
      });
    }
  }
}

export const config = {
  api: {
    responseLimit: false,
  },
};



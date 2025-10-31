import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

// Dynamic import dengan SSR disabled untuk menghindari hydration error
// Komponen ini menggunakan browser APIs yang tidak tersedia di server
const Yolo = dynamic(() => import('../components/models/Yolo'), {
  ssr: false,
  loading: () => (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      backgroundColor: '#000',
      color: '#fff'
    }}>
      <div style={{ textAlign: 'center' }}>
        <p>Loading Object Detection...</p>
      </div>
    </div>
  )
});

// Halaman utama untuk deteksi objek dengan ESP32-CAM
// Ketika npm run dev, halaman ini akan muncul
export default function Home() {
  const [isMounted, setIsMounted] = useState(false);

  // Pastikan komponen hanya di-render di client
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Menggunakan ukuran standar untuk video detection
  // ObjectDetectionCamera akan menyesuaikan ukuran video
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {isMounted && <Yolo width={640} height={480} />}
    </div>
  );
}


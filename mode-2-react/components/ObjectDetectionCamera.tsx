import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { runModelUtils } from '../utils';
import { InferenceSession, Tensor } from 'onnxruntime-web';

const ObjectDetectionCamera = (props: {
  width: number;
  height: number;
  modelName: string;
  session: InferenceSession | null; // Allow null session while loading
  preprocess: (ctx: CanvasRenderingContext2D) => Tensor;
  postprocess: (
    outputTensor: Tensor,
    inferenceTime: number,
    ctx: CanvasRenderingContext2D,
    modelName: string
  ) => void;
  currentModelResolution: number[];
  changeCurrentModelResolution: (width?: number, height?: number) => void;
}) => {
  const [inferenceTime, setInferenceTime] = useState<number>(0);
  const [totalTime, setTotalTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  // espVideoRef tidak digunakan lagi - stream mode sekarang menggunakan img tag dengan polling cepat
  const imgRef = useRef<HTMLImageElement>(null); // For ESP32-CAM
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveDetection = useRef<boolean>(false);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false);
  const [cameraSource, setCameraSource] = useState<'webcam' | 'esp32' | 'esp32-s3'>('webcam');
  const [isMounted, setIsMounted] = useState<boolean>(false); // Untuk menghindari hydration error
  
  // ESP32-CAM Configuration
  const ESP32_IP = '192.168.1.19';
  const ESP32_STREAM_URL = `http://${ESP32_IP}:81/stream`;
  const ESP32_CAPTURE_URL = `http://${ESP32_IP}/capture`;
  const ESP32_PROXY_CAPTURE_URL = `/api/esp32-capture`;
  const espFrameReady = useRef<boolean>(false);
  // Offscreen buffer for last good ESP32 frame to avoid "image not ready" gaps
  const espBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const espBufferHasFrameRef = useRef<boolean>(false);
  // Default ke stream mode untuk performa lebih baik
  const [espEndpointMode, setEspEndpointMode] = useState<'stream' | 'capture'>('stream');
  const ESP32_PROXY_STREAM_URL = `/api/esp32-stream`;
  const espErrorCount = useRef<number>(0);
  
  const originalSize = useRef<number[]>([0, 0]);

  const [modelResolution, setModelResolution] = useState<number[]>(
    props.currentModelResolution
  );

  useEffect(() => {
    setModelResolution(props.currentModelResolution);
  }, [props.currentModelResolution]);

  const capture = () => {
    const canvas = videoCanvasRef.current!;
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    })!;

    if (cameraSource !== 'webcam') {
      // ESP32 mode: baik stream maupun capture menggunakan buffer dari img tag
      // Buffer diupdate setiap kali frame baru dimuat
      const buffer = espBufferCanvasRef.current;
      if (!buffer || !espBufferHasFrameRef.current) {
        return null;
      }
      context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
    } else {
      // Capture dari webcam video
      if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
        console.warn('Webcam video not ready');
        return null;
      }
      context.drawImage(
        videoRef.current,
        0,
        0,
        canvas.width,
        canvas.height
      );
    }

    return context;
  };

  const runModel = async (ctx: CanvasRenderingContext2D) => {
    try {
      // Check if session is available
      if (!props.session) {
        console.warn('Model session not loaded yet. Please wait for model to load.');
        return;
      }
      
      console.log('Running model inference...');
      const data = props.preprocess(ctx);
      let outputTensor: Tensor;
      let inferenceTime: number;
      
      console.log('Calling runModel with session:', props.session);
      [outputTensor, inferenceTime] = await runModelUtils.runModel(
        props.session,
        data
      );

      props.postprocess(outputTensor, inferenceTime, ctx, props.modelName);
      setInferenceTime(inferenceTime);
      console.log('Model inference completed successfully');
    } catch (error) {
      console.error('Error in runModel:', error);
      console.error('Error details:', {
        hasSession: !!props.session,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      throw error;
    }
  };

  const runLiveDetection = async () => {
    if (liveDetection.current) {
      liveDetection.current = false;
      return;
    }
    liveDetection.current = true;
    while (liveDetection.current) {
      const startTime = Date.now();
      const ctx = capture();
      if (!ctx) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50)); // Wait a bit if frame not ready
        continue;
      }
      await runModel(ctx);
      setTotalTime(Date.now() - startTime);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    }
  };

  const processImage = async () => {
    // Hanya jalankan di browser environment
    if (typeof document === 'undefined') return;
    
    reset();
    const ctx = capture();
    if (!ctx) return;

    // create a copy of the canvas
    const boxCtx = document
      .createElement('canvas')
      .getContext('2d') as CanvasRenderingContext2D;
    boxCtx.canvas.width = ctx.canvas.width;
    boxCtx.canvas.height = ctx.canvas.height;
    boxCtx.drawImage(ctx.canvas, 0, 0);

    await runModel(boxCtx);
    ctx.drawImage(boxCtx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  };

  const reset = async () => {
    var context = videoCanvasRef.current!.getContext('2d')!;
    context.clearRect(0, 0, originalSize.current[0], originalSize.current[1]);
    liveDetection.current = false;
  };

  const setWebcamCanvasOverlaySize = () => {
    let element: HTMLVideoElement | HTMLImageElement | null = null;
    
    if (cameraSource !== 'webcam') {
      // ESP32 mode: selalu gunakan img tag (baik stream maupun capture)
      element = imgRef.current;
      if (!element || !('naturalWidth' in element) || !(element as HTMLImageElement).naturalWidth) return;
    } else {
      element = videoRef.current;
      if (!element || !element.videoWidth) return;
    }
    
    var w = element.offsetWidth;
    var h = element.offsetHeight;
    var cv = videoCanvasRef.current;
    if (!cv) return;
    cv.width = w;
    cv.height = h;
    
    if (originalSize.current[0] === 0) {
      if (cameraSource !== 'webcam') {
        // ESP32 mode: selalu gunakan img tag (baik stream maupun capture)
        if (element instanceof HTMLImageElement) {
          originalSize.current = [element.naturalWidth, element.naturalHeight];
        }
      } else if (element instanceof HTMLVideoElement) {
        // Webcam mode: gunakan video tag
        originalSize.current = [element.videoWidth, element.videoHeight];
      }
    }
  };

  // Initialize ESP32(-S3) - handle MJPEG stream or JPEG capture with auto-fallback
  useEffect(() => {
    if (cameraSource === 'webcam') return;
    
    let updateInterval: NodeJS.Timeout | null = null; // legacy; not used after sequential polling
    let retryTimer: NodeJS.Timeout | null = null;
    let img: HTMLImageElement | null = null;
    let video: HTMLVideoElement | null = null;
    // Note: stream mode menggunakan video tag, capture mode menggunakan img tag polling
    const isMjpegStream = espEndpointMode === 'stream';
    // Optimistically show the ESP image/video area
    setIsStreamReady(true);
    
    const setNextSrc = () => {
      if (isMjpegStream) {
        // Untuk stream mode, gunakan img tag dengan polling cepat (50-80ms) untuk efek stream yang halus
        if (!img) return;
        const url = `${ESP32_PROXY_STREAM_URL}?t=${Date.now()}`;
        img.src = url;
      } else {
        // Untuk capture mode, gunakan polling dengan interval lebih lama (180ms)
        if (!img) return;
        const url = `${ESP32_PROXY_CAPTURE_URL}?t=${Date.now()}`;
        img.src = url;
      }
    };

    const handleLoad = () => {
      // Handler untuk img tag (baik stream maupun capture mode)
      if (img) {
        if (isMjpegStream) {
          console.log('✅ ESP32 stream frame loaded!');
        } else {
          console.log('✅ ESP32 image frame loaded!');
        }
        setIsStreamReady(true);
        espFrameReady.current = true;
        espErrorCount.current = 0;
        setWebcamCanvasOverlaySize();
        
        if (img.naturalWidth && originalSize.current[0] === 0) {
          originalSize.current = [img.naturalWidth, img.naturalHeight];
        }
        
        // Update offscreen buffer dengan frame terakhir yang berhasil
        if (img.naturalWidth && img.naturalHeight) {
          // Hanya buat canvas jika belum ada dan di browser environment
          if (!espBufferCanvasRef.current && typeof document !== 'undefined') {
            espBufferCanvasRef.current = document.createElement('canvas');
          }
          const buf = espBufferCanvasRef.current;
          if (buf) {
            if (buf.width !== img.naturalWidth || buf.height !== img.naturalHeight) {
              buf.width = img.naturalWidth;
              buf.height = img.naturalHeight;
            }
            const bctx = buf.getContext('2d');
            if (bctx) {
              bctx.drawImage(img, 0, 0);
              espBufferHasFrameRef.current = true;
            }
          }
        }

        if (videoCanvasRef.current) {
          const w = img.offsetWidth || img.naturalWidth || 640;
          const h = img.offsetHeight || img.naturalHeight || 480;
          videoCanvasRef.current.width = w;
          videoCanvasRef.current.height = h;
        }
        // Schedule next frame: stream mode lebih cepat (50-80ms), capture mode lebih lambat (180ms)
        const delay = isMjpegStream ? 70 : 180;
        retryTimer = setTimeout(() => setNextSrc(), delay);
      }
    };


    const handleError = (e: Event) => {
      console.error('ESP32-CAM error:', e);
      setIsStreamReady(false);
      espErrorCount.current += 1;
      // Auto fallback ke /capture setelah beberapa kegagalan saat di mode stream
      if (isMjpegStream && espErrorCount.current >= 3) {
        console.warn('Switching ESP32 endpoint to /capture fallback.');
        setEspEndpointMode('capture');
      }
      // Schedule retry on error dengan delay sedikit lebih lama
      if (!isMjpegStream) {
        retryTimer = setTimeout(() => setNextSrc(), 350);
      }
    };

    const startWhenReady = () => {
      // Baik stream maupun capture mode menggunakan img tag
      img = imgRef.current;
      if (!img) {
        retryTimer = setTimeout(startWhenReady, 50);
        return;
      }
      img.addEventListener('load', handleLoad);
      img.addEventListener('error', handleError);
      setNextSrc();
    };

    startWhenReady();

    return () => {
      // Cleanup event listeners
      if (img) {
        img.removeEventListener('load', handleLoad);
        img.removeEventListener('error', handleError);
        img.src = '';
      }
      if (updateInterval) clearInterval(updateInterval);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [cameraSource, ESP32_STREAM_URL, ESP32_CAPTURE_URL, ESP32_PROXY_CAPTURE_URL, ESP32_PROXY_STREAM_URL, espEndpointMode]);

  // Initialize webcam - menggunakan MediaDevices API untuk akses webcam laptop
  useEffect(() => {
    if (cameraSource !== 'webcam' || !videoRef.current) return;
    
    const video = videoRef.current;
    let stream: MediaStream | null = null;

    const startWebcam = async () => {
      try {
        console.log('📹 Starting webcam...');
        setIsStreamReady(false);

        // Hentikan stream yang sedang aktif jika ada
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }

        // Request webcam access
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (video) {
          video.srcObject = stream;
          video.play();
          
          video.onloadedmetadata = () => {
            console.log('✅ Webcam ready!');
            console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
            setIsStreamReady(true);
            setWebcamCanvasOverlaySize();
            
            if (originalSize.current[0] === 0 && video.videoWidth) {
              originalSize.current = [video.videoWidth, video.videoHeight];
            }
            
            if (videoCanvasRef.current) {
              videoCanvasRef.current.width = video.offsetWidth || video.videoWidth || 640;
              videoCanvasRef.current.height = video.offsetHeight || video.videoHeight || 480;
            }
          };
        }
      } catch (error: any) {
        console.error('Error accessing webcam:', error);
        setIsStreamReady(false);
        
        if (error.name === 'NotAllowedError') {
          console.error('Webcam permission denied. Please allow camera access.');
        } else if (error.name === 'NotFoundError') {
          console.error('No webcam found.');
        } else {
          console.error('Error:', error.message);
        }
      }
    };

    startWebcam();

    return () => {
      // Cleanup: stop all tracks when component unmounts
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraSource, facingMode]);

  // Set mounted flag untuk menghindari hydration error
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Close camera when browser tab is minimized
  useEffect(() => {
    // Hanya jalankan di client (browser)
    if (typeof document === 'undefined') return;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        liveDetection.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row w-full justify-center items-start gap-6 px-4">
      <div
        id="webcam-container"
        className="flex items-center justify-center webcam-container mx-auto w-full lg:w-auto"
      >
        <div style={{ position: 'relative', width: '100%', maxWidth: '640px', minHeight: '240px', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!isStreamReady && (
            <div style={{ position: 'absolute', zIndex: 5, textAlign: 'center', color: '#a0a0a0' }}>
              <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm">
                {cameraSource === 'webcam' ? 'Initializing webcam...' : 'Connecting to ESP32-CAM...'}
              </p>
              <p className="text-xs mt-2 text-gray-500">
                {cameraSource === 'webcam' ? 'Please allow camera access' : `IP: ${ESP32_IP}`}
              </p>
            </div>
          )}
          
          {/* Webcam Video - Only show when webcam is selected */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: 'auto',
              borderRadius: '20px',
              objectFit: 'contain',
              display: (cameraSource === 'webcam' && isStreamReady) ? 'block' : 'none',
              maxHeight: '480px',
              transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)'
            }}
            onLoadedMetadata={() => {
              setWebcamCanvasOverlaySize();
            }}
          />
          
          {/* ESP32 Stream/Capture Image - stream uses fast polling, capture uses slower polling */}
          {/* Hanya render img tag setelah komponen di-mount di client untuk menghindari hydration error */}
          {isMounted && (
            <img
              ref={imgRef}
              alt="ESP32-CAM Capture"
              crossOrigin="anonymous"
              style={{
                width: '100%',
                height: 'auto',
                borderRadius: '20px',
                objectFit: 'contain',
                display: (cameraSource !== 'webcam' && (espEndpointMode === 'capture' || espEndpointMode === 'stream')) ? 'block' : 'none',
                maxHeight: '480px'
              }}
              onLoad={() => {
                setWebcamCanvasOverlaySize();
              }}
            />
          )}
          
          <canvas
            ref={displayCanvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              borderRadius: '20px',
              display: 'none'
            }}
          />
        </div>
        <canvas
          id="cv1"
          ref={videoCanvasRef}
          style={{
            position: 'absolute',
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0)',
          }}
        ></canvas>
      </div>
      
      {/* Control Panel */}
      <div className="flex flex-col items-center justify-center gap-4 w-full lg:max-w-md">
        {/* Button Groups */}
        <div className="glass-card card-gradient-1 p-7 rounded-3xl w-full shadow-xl border-t border-black/5">
          <h3 className="text-lg font-semibold mb-6 text-yellow-400 tracking-wide uppercase text-xs">
            Controls
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <button
              onClick={async () => {
                const startTime = Date.now();
                await processImage();
                setTotalTime(Date.now() - startTime);
              }}
              className="modern-button button-gradient-capture w-full"
            >
              <span className="text-sm sm:text-base font-medium tracking-wide">
                Capture
              </span>
            </button>
            
            <button
              onClick={async () => {
                if (liveDetection.current) {
                  liveDetection.current = false;
                } else {
                  runLiveDetection();
                }
              }}
              className={`modern-button w-full ${liveDetection.current ? 'button-active' : ''}`}
            >
              <span className="text-sm sm:text-base font-medium tracking-wide">
                {liveDetection.current ? 'Stop Detection' : 'Live Detection'}
              </span>
            </button>
          </div>
          
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <button
              onClick={() => {
                // Switch between front and back camera (facingMode) - only for webcam
                if (cameraSource === 'webcam') {
                  setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
                }
              }}
              disabled={cameraSource !== 'webcam'}
              className={`modern-button button-gradient-switch text-xs sm:text-sm py-3 font-medium ${cameraSource !== 'webcam' ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Switch
            </button>
            
            <button
              onClick={() => {
                reset();
                props.changeCurrentModelResolution();
              }}
              className="modern-button button-gradient-model text-xs sm:text-sm py-3 font-medium"
            >
              Model
            </button>
            
            <button
              onClick={reset}
              className="modern-button button-gradient-reset text-xs sm:text-sm py-3 font-medium"
            >
              Reset
            </button>
          </div>
          
          {/* Camera Source Toggle */}
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Camera Source</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsStreamReady(false);
                  setCameraSource('webcam');
                  reset();
                }}
                className={`flex-1 modern-button text-xs py-2.5 font-medium ${cameraSource === 'webcam' ? 'button-active' : 'button-gradient-switch'}`}
              >
                Webcam
              </button>
              <button
                onClick={() => {
                  setIsStreamReady(false);
                  setCameraSource('esp32-s3');
                  // Default ke stream mode untuk performa lebih baik
                  setEspEndpointMode('stream');
                  reset();
                }}
                className={`flex-1 modern-button text-xs py-2.5 font-medium ${cameraSource !== 'webcam' ? 'button-active' : 'button-gradient-switch'}`}
              >
                ESP32-CAM
              </button>
            </div>
            {cameraSource !== 'webcam' && (
              <>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  IP: {ESP32_IP}
                </p>
                {/* Toggle Stream/Capture Mode */}
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700/50">
                  <button
                    onClick={() => {
                      setIsStreamReady(false);
                      setEspEndpointMode('stream');
                      reset();
                    }}
                    className={`flex-1 modern-button text-xs py-2.5 font-medium ${espEndpointMode === 'stream' ? 'button-active' : 'button-gradient-switch'}`}
                  >
                    Stream
                  </button>
                  <button
                    onClick={() => {
                      setIsStreamReady(false);
                      setEspEndpointMode('capture');
                      reset();
                    }}
                    className={`flex-1 modern-button text-xs py-2.5 font-medium ${espEndpointMode === 'capture' ? 'button-active' : 'button-gradient-switch'}`}
                  >
                    Capture
                  </button>
                </div>
                <p className="text-xs text-gray-600 mt-2 text-center">
                  Mode: <span className="font-semibold text-yellow-400">{espEndpointMode === 'stream' ? 'MJPEG Stream' : 'JPEG Polling'}</span>
                </p>
              </>
            )}
          </div>
        </div>
        {/* Model Info */}
        <div className="glass-card card-gradient-2 p-4 rounded-2xl w-full border-t border-black/3">
          <p className="text-center text-gray-300 text-sm font-light tracking-wide">
            Model: <span className="font-semibold text-yellow-400">{props.modelName.replace('.onnx', '')}</span>
          </p>
        </div>
        
        {/* Performance Stats */}
        <div className="glass-card card-gradient-3 p-7 rounded-3xl w-full shadow-xl border-t border-black/5">
          <h3 className="text-lg font-semibold mb-6 text-yellow-400 tracking-wide uppercase text-xs">
            Performance
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column - Timing */}
            <div className="flex flex-col gap-3">
              <div className="stats-card stats-card-sky">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Inference</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  {inferenceTime.toFixed()}ms
                </p>
              </div>
              
              <div className="stats-card stats-card-purple">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Total</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  {totalTime.toFixed()}ms
                </p>
              </div>
              
              <div className="stats-card stats-card-emerald">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Overhead</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  +{(totalTime - inferenceTime).toFixed(1)}
                </p>
              </div>
            </div>
            
            {/* Right Column - FPS */}
            <div className="flex flex-col gap-3">
              <div className="stats-card stats-card-sky">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Model FPS</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  {(1000 / inferenceTime).toFixed(1)}
                </p>
              </div>
              
              <div className="stats-card stats-card-purple">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Total FPS</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  {(1000 / totalTime).toFixed(1)}
                </p>
              </div>
              
              <div className="stats-card stats-card-emerald">
                <p className="text-xs text-gray-400 mb-2 tracking-wide uppercase font-medium">Efficiency</p>
                <p className="text-2xl font-bold text-yellow-400 tracking-tight">
                  {((inferenceTime / totalTime) * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ObjectDetectionCamera;


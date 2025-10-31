import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { subscribeDetections, DetectedObject } from '../lib/detectionsBus';

// React port of map/map.html + a subset of map/index.js logic
// - Uses Leaflet + Leaflet Routing Machine via CDN
// - Tracks user location, lets you set destination (lat,lng), draws a route
// - Provides status panel, debug panel, and a permission flow

type LatLng = { lat: number; lng: number };
type RouteLocation = { lat: number; lng: number; name: string };
type Route = { id: number; name: string; start: RouteLocation | null; end: RouteLocation | null };

// Known cities and districts list - expanded for better coverage (from map/index.js)
const knownCities: Record<string, { lat: number; lng: number; name: string }> = {
    // Major Cities
    'jakarta': { lat: -6.2088, lng: 106.8456, name: 'Jakarta, Indonesia' },
    'surabaya': { lat: -7.2575, lng: 112.7521, name: 'Surabaya, Indonesia' },
    'bandung': { lat: -6.9175, lng: 107.6191, name: 'Bandung, Indonesia' },
    'medan': { lat: 3.5952, lng: 98.6722, name: 'Medan, Indonesia' },
    'makassar': { lat: -5.1477, lng: 119.4327, name: 'Makassar, Indonesia' },
    'semarang': { lat: -6.9932, lng: 110.4203, name: 'Semarang, Indonesia' },
    'palembang': { lat: -2.9761, lng: 104.7754, name: 'Palembang, Indonesia' },
    'denpasar': { lat: -8.6705, lng: 115.2126, name: 'Denpasar, Indonesia' },
    'yogyakarta': { lat: -7.7956, lng: 110.3695, name: 'Yogyakarta, Indonesia' },
    'surakarta': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    'solo': { lat: -7.5565, lng: 110.8315, name: 'Surakarta, Indonesia' },
    // Districts in Surakarta
    'gilingan': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'gilingan surakarta': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'gilingan solo': { lat: -7.5565, lng: 110.8315, name: 'Gilingan, Surakarta' },
    'pajang': { lat: -7.5700, lng: 110.8100, name: 'Pajang, Surakarta' },
    'pasarkliwon': { lat: -7.5760, lng: 110.8310, name: 'Pasarkliwon, Surakarta' },
    'jebres': { lat: -7.5600, lng: 110.8500, name: 'Jebres, Surakarta' },
    'banjarsari': { lat: -7.5560, lng: 110.8170, name: 'Banjarsari, Surakarta' },
    'laweyan': { lat: -7.5640, lng: 110.7950, name: 'Laweyan, Surakarta' },
    'serengan': { lat: -7.5680, lng: 110.8250, name: 'Serengan, Surakarta' },
    // Places of Worship - Surakarta
    'masjid sheikh zayed': { lat: -7.5575, lng: 110.8400, name: 'Masjid Sheikh Zayed, Surakarta' },
    'masjid sheikh zayed solo': { lat: -7.5575, lng: 110.8400, name: 'Masjid Sheikh Zayed, Surakarta' },
    'masjid agung surakarta': { lat: -7.5740, lng: 110.8365, name: 'Masjid Agung Surakarta' },
    // Universities - Surakarta
    'uns': { lat: -7.5600, lng: 110.8569, name: 'Universitas Sebelas Maret, Surakarta' },
    'universitas sebelas maret': { lat: -7.5600, lng: 110.8569, name: 'Universitas Sebelas Maret, Surakarta' },
    'gedung 1 fakultas teknik uns': { lat: -7.5617, lng: 110.8572, name: 'Gedung 1 Fakultas Teknik UNS' },
    'fakultas teknik uns': { lat: -7.5617, lng: 110.8572, name: 'Fakultas Teknik UNS' },
    'ft uns': { lat: -7.5617, lng: 110.8572, name: 'Fakultas Teknik UNS' },
    'kentingan': { lat: -7.5617, lng: 110.8572, name: 'Kentingan, Jebres, Surakarta' },
    'kampus uns': { lat: -7.5600, lng: 110.8569, name: 'Kampus UNS' },
    // Tourist Attractions - Surakarta
    'keraton surakarta': { lat: -7.5748, lng: 110.8253, name: 'Keraton Surakarta Hadiningrat' },
    'keraton solo': { lat: -7.5748, lng: 110.8253, name: 'Keraton Surakarta Hadiningrat' },
    'triwindu': { lat: -7.5622, lng: 110.8244, name: 'Pasar Triwindu Surakarta' },
    'pasar klewer': { lat: -7.5667, lng: 110.8269, name: 'Pasar Klewer Surakarta' },
    'batik laweyan': { lat: -7.5640, lng: 110.7950, name: 'Kampung Batik Laweyan' },
    'kampung batik': { lat: -7.5640, lng: 110.7950, name: 'Kampung Batik Laweyan' },
    'balai kota solo': { lat: -7.5644, lng: 110.8150, name: 'Balai Kota Surakarta' },
    'balai kota surakarta': { lat: -7.5644, lng: 110.8150, name: 'Balai Kota Surakarta' },
    // Universities - Jakarta & Bandung
    'ui': { lat: -6.3619, lng: 106.8250, name: 'Universitas Indonesia' },
    'itb': { lat: -6.8891, lng: 107.6105, name: 'Institut Teknologi Bandung' },
    'ugm': { lat: -7.7731, lng: 110.3773, name: 'Universitas Gadjah Mada' },
    'ipb': { lat: -6.5616, lng: 106.7226, name: 'Institut Pertanian Bogor' },
    // Popular Tourist Spots - Jakarta
    'monas': { lat: -6.1751, lng: 106.8650, name: 'Monumen Nasional Jakarta' },
    'ancol': { lat: -6.1277, lng: 106.8418, name: 'Taman Impian Jaya Ancol' },
    'dufan': { lat: -6.1256, lng: 106.8415, name: 'Dufan Ancol Jakarta' },
    'kota tua': { lat: -6.1352, lng: 106.8136, name: 'Kota Tua Jakarta' },
    'salatiga': { lat: -7.3307, lng: 110.5084, name: 'Salatiga, Indonesia' },
    'magelang': { lat: -7.4706, lng: 110.2178, name: 'Magelang, Indonesia' },
    'pekalongan': { lat: -6.8887, lng: 109.6753, name: 'Pekalongan, Indonesia' },
    'tegal': { lat: -6.8667, lng: 109.1333, name: 'Tegal, Indonesia' },
    // West Java
    'bogor': { lat: -6.5971, lng: 106.8060, name: 'Bogor, Indonesia' },
    'depok': { lat: -6.4025, lng: 106.7942, name: 'Depok, Indonesia' },
    'bekasi': { lat: -6.2383, lng: 106.9756, name: 'Bekasi, Indonesia' },
    'tangerang': { lat: -6.1783, lng: 106.6319, name: 'Tangerang, Indonesia' },
    'cimahi': { lat: -6.8856, lng: 107.5421, name: 'Cimahi, Indonesia' },
    'tasikmalaya': { lat: -7.3276, lng: 108.2208, name: 'Tasikmalaya, Indonesia' },
    'cirebon': { lat: -6.7320, lng: 108.5523, name: 'Cirebon, Indonesia' },
    // East Java
    'malang': { lat: -7.9666, lng: 112.6326, name: 'Malang, Indonesia' },
    'kediri': { lat: -7.8164, lng: 112.0122, name: 'Kediri, Indonesia' },
    'jember': { lat: -8.1845, lng: 113.6681, name: 'Jember, Indonesia' },
    'blitar': { lat: -8.0955, lng: 112.1609, name: 'Blitar, Indonesia' },
    'batu': { lat: -7.8714, lng: 112.5234, name: 'Batu, Indonesia' },
    // North Sumatra
    'binjai': { lat: 3.6001, lng: 98.4854, name: 'Binjai, Indonesia' },
    'pematangsiantar': { lat: 2.9694, lng: 99.0684, name: 'Pematangsiantar, Indonesia' },
    // South Sulawesi
    'parepare': { lat: -4.0143, lng: 119.6375, name: 'Parepare, Indonesia' },
    'palopo': { lat: -2.9935, lng: 120.1969, name: 'Palopo, Indonesia' },
    // Bali
    'batubulan': { lat: -8.5333, lng: 115.2833, name: 'Batubulan, Bali, Indonesia' },
    'ubud': { lat: -8.5069, lng: 115.2625, name: 'Ubud, Bali, Indonesia' },
    'kuta': { lat: -8.7074, lng: 115.1749, name: 'Kuta, Bali, Indonesia' }
};

export default function MapReactPage() {
    const mapElRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const userMarkerRef = useRef<any>(null);
    const destMarkerRef = useRef<any>(null);
    const routeRef = useRef<any>(null);
    const watchIdRef = useRef<number | null>(null);

    const [statusText, setStatusText] = useState('Waiting for location...');
    const [coordinatesText, setCoordinatesText] = useState('Lat: -, Lng: -');
    const [accuracyText, setAccuracyText] = useState('Accuracy: -');
    const [permissionOpen, setPermissionOpen] = useState(true);
    const [debugOpen, setDebugOpen] = useState(false);
    const [routePanelOpen, setRoutePanelOpen] = useState(false);
    const [statusPanelOpen, setStatusPanelOpen] = useState(true);
    const [destination, setDestination] = useState<LatLng | null>(null);
    const [alerts, setAlerts] = useState<string[]>([]);
    const [voiceStatus, setVoiceStatus] = useState<string>('Senavision siap. Ucapkan tujuan Anda.');
    const recognitionRef = useRef<any>(null);
    const isListeningRef = useRef<boolean>(false);
    
    // Navigation tracking variables
    const currentRouteDataRef = useRef<any>(null);
    const isNavigatingRef = useRef<boolean>(false);
    const lastAnnouncedInstructionRef = useRef<string | null>(null);
    const announcedInstructionsRef = useRef<string[]>([]);
    
    // Routes management
    const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
    const [editingRoute, setEditingRoute] = useState<Route | null>(null);
    const [formStart, setFormStart] = useState('');
    const [formEnd, setFormEnd] = useState('');
    const [formStatus, setFormStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);

    const getL = () => (typeof window !== 'undefined' ? (window as any).L : null);

    // Initialize Leaflet map (wait for CDN scripts)
    useEffect(() => {
        if (!mapElRef.current || mapRef.current) return;

        const tryInit = () => {
            const L = getL();
            if (!L || !mapElRef.current || mapRef.current) return false;

            mapRef.current = L.map(mapElRef.current, {
                center: [3.59, 98.67],
                zoom: 15,
            });

            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            }).addTo(mapRef.current);
            return true;
        };

        if (!tryInit()) {
            const id = window.setInterval(() => {
                if (tryInit()) window.clearInterval(id);
            }, 100);
        }

        return () => {
            try {
                if (watchIdRef.current && navigator.geolocation) {
                    navigator.geolocation.clearWatch(watchIdRef.current);
                }
                if (routeRef.current) {
                    mapRef.current.removeControl(routeRef.current);
                    routeRef.current = null;
                }
                if (mapRef.current) {
                    mapRef.current.remove();
                    mapRef.current = null;
                }
            } catch {}
        };
    }, []);

    // Start geolocation watcher after user permits
    useEffect(() => {
        const L = getL();
        if (!L || !mapRef.current || permissionOpen) return;

        if (!('geolocation' in navigator)) {
            setStatusText('Geolocation not supported');
            return;
        }

        setStatusText('Requesting location permission...');

        watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude, accuracy } = pos.coords;
                setStatusText('Location acquired');
                setCoordinatesText(`Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}`);
                setAccuracyText(`Accuracy: ${Math.round(accuracy)} m`);

                const latlng = L.latLng(latitude, longitude);

                if (userMarkerRef.current) userMarkerRef.current.setLatLng(latlng);
                else userMarkerRef.current = L.marker(latlng).addTo(mapRef.current);

                if (mapRef.current && !mapRef.current._hasCenteredOnce) {
                    mapRef.current.setView(latlng, 16);
                    mapRef.current._hasCenteredOnce = true;
                }

                if (destination) {
                    drawRoute(latlng, L.latLng(destination.lat, destination.lng));
                }
            },
            (err) => setStatusText(`Location error: ${err.message}`),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    }, [permissionOpen, destination]);

    // Welcome guide announcement on first load
    useEffect(() => {
        const welcomeText = 'SENAVISION siap. Berikut panduan cara menggunakan aplikasi. ' +
            'Aplikasi memiliki sistem rute yang bisa Anda kelola sendiri. Ada enam slot rute yang tersedia, yaitu Rute Satu sampai Rute Enam. ' +
            'Semua rute bisa Anda isi melalui tombol "Kelola Rute" di kanan atas, atau melalui suara dengan mengatakan "Buat Rute [nomor] dari [lokasi awal] ke [lokasi tujuan]". ' +
            'Untuk menggunakan rute yang sudah Anda buat, ucapkan nama rutenya. Misalnya ucapkan "Rute Satu". ' +
            'Setelah rute dipilih, ucapkan kata "Navigasi" untuk memulai perjalanan. ' +
            'Aplikasi akan memberikan panduan suara yang akan membimbing Anda menuju tujuan. ' +
            'Aplikasi siap digunakan. Silakan buat rute terlebih dahulu melalui tombol "Kelola Rute" atau sebutkan tujuan Anda secara langsung.';
        
        // Delay announcement to ensure page is loaded
        const timeout = setTimeout(() => {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                setVoiceStatus('📢 Memutar panduan penggunaan...');
                speak(welcomeText, () => {
                    // After welcome guide finishes, activate microphone
                    console.log('✅ Welcome guide finished - activating microphone');
                    toggleVoiceListening();
                });
            }
        }, 2000);
        
        return () => clearTimeout(timeout);
    }, []);

    // Initialize saved routes from localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        
        const savedRoutesData = localStorage.getItem('senavision_saved_routes');
        if (savedRoutesData) {
            try {
                const routes = JSON.parse(savedRoutesData);
                setSavedRoutes(routes);
            } catch (error) {
                console.error('Error loading routes:', error);
                // Initialize with empty routes
                const emptyRoutes: Route[] = [
                    { id: 1, name: 'Rute 1', start: null, end: null },
                    { id: 2, name: 'Rute 2', start: null, end: null },
                    { id: 3, name: 'Rute 3', start: null, end: null },
                    { id: 4, name: 'Rute 4', start: null, end: null },
                    { id: 5, name: 'Rute 5', start: null, end: null },
                    { id: 6, name: 'Rute 6', start: null, end: null }
                ];
                setSavedRoutes(emptyRoutes);
                localStorage.setItem('senavision_saved_routes', JSON.stringify(emptyRoutes));
            }
        } else {
            // Initialize with empty routes
            const emptyRoutes: Route[] = [
                { id: 1, name: 'Rute 1', start: null, end: null },
                { id: 2, name: 'Rute 2', start: null, end: null },
                { id: 3, name: 'Rute 3', start: null, end: null },
                { id: 4, name: 'Rute 4', start: null, end: null },
                { id: 5, name: 'Rute 5', start: null, end: null },
                { id: 6, name: 'Rute 6', start: null, end: null }
            ];
            setSavedRoutes(emptyRoutes);
            localStorage.setItem('senavision_saved_routes', JSON.stringify(emptyRoutes));
        }
    }, []);

    // Auto-save routes to localStorage whenever savedRoutes changes
    useEffect(() => {
        if (savedRoutes.length > 0) {
            saveRoutesToLocalStorage();
        }
    }, [savedRoutes]);

    function requestLocationPermission() {
        // Simply close the popup and let watchPosition prompt
        setPermissionOpen(false);
    }

    function drawRoute(start: any, end: any) {
        const L = getL();
        if (!L || !mapRef.current) return;
        try {
            if (routeRef.current) {
                mapRef.current.removeControl(routeRef.current);
                routeRef.current = null;
            }
            // @ts-ignore - L.Routing exists from CDN
            routeRef.current = (L as any).Routing.control({
                waypoints: [start, end],
                addWaypoints: false,
                draggableWaypoints: false,
                routeWhileDragging: false,
                fitSelectedRoutes: true,
                show: false,
            }).addTo(mapRef.current);
            try {
                routeRef.current.on('routesfound', (e: any) => {
                    const route = e?.routes?.[0];
                    const meters = route?.summary?.totalDistance;
                    const seconds = route?.summary?.totalTime;
                    if (typeof meters === 'number' && typeof seconds === 'number') {
                        const km = (meters / 1000).toFixed(1);
                        const mins = Math.round(seconds / 60);
                        speak(`Rute siap. Jarak ${km} kilometer, waktu sekitar ${mins} menit.`);
                    }
                });
            } catch {}
        } catch (e) {
            addDebug('error', 'Routing init failed', e);
        }
    }

    function toggleStatusPanel() {
        setStatusPanelOpen((v) => !v);
    }

    function toggleDebugPanel() {
        setDebugOpen((v) => !v);
    }

    function toggleRouteManagementPanel() {
        setRoutePanelOpen((v) => !v);
    }

    function addDebug(type: 'log' | 'info' | 'warn' | 'error', ...args: any[]) {
        if (!debugOpen) return;
        const box = document.getElementById('debugLogsBox');
        if (!box) return;
        const el = document.createElement('div');
        el.textContent = `[${type}] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
        (el.style as any).fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        (el.style as any).fontSize = '12px';
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
    }

    // Subscribe to object detections and raise alerts for <2m
    useEffect(() => {
        const unsubscribe = subscribeDetections(({ items }) => {
            const closeObjects = items.filter((it: DetectedObject) =>
                typeof it.distanceMeters === 'number' && it.distanceMeters! < 2
            );
            if (closeObjects.length === 0) return;

            const labels = closeObjects
                .map((o) => `${o.label}${typeof o.distanceMeters === 'number' ? ` ${o.distanceMeters!.toFixed(1)}m` : ''}`)
                .join(', ');

            const message = `Hati-hati! Di depan ada: ${labels}`;
            setAlerts((prev) => [message, ...prev].slice(0, 5));
            speak(message);
        });
        return unsubscribe;
    }, []);

    function speak(text: string, onComplete?: () => void) {
        try {
            if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'id-ID';
            utterance.rate = 1.05;
            utterance.pitch = 1;
            window.speechSynthesis.cancel();
            
            // Add onComplete callback support
            if (onComplete) {
                utterance.onend = function() {
                    setTimeout(onComplete, 100);
                };
            }
            
            window.speechSynthesis.speak(utterance);
        } catch {}
    }

    // Extract location from voice command
    function extractLocation(command: string): string | null {
        const prefixes = [
            'pergi ke', 'navigasi ke', 'tujuan ke', 'ke',
            'go to', 'navigate to', 'set destination', 'go', 'navigate', 'destination'
        ];
        for (const prefix of prefixes) {
            if (command.toLowerCase().startsWith(prefix)) {
                return command.substring(prefix.length).trim();
            }
        }
        return command.trim() || null;
    }

    // Voice control: start/stop recognition
    function toggleVoiceListening() {
        if (isListeningRef.current) {
            try { recognitionRef.current?.stop?.(); } catch {}
            isListeningRef.current = false;
            setVoiceStatus('Mikrofon dimatikan.');
            return;
        }
        const SpeechRecognition: any = (typeof window !== 'undefined') && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
        if (!SpeechRecognition) {
            setVoiceStatus('Speech recognition tidak didukung browser ini.');
            return;
        }
        const recog = new SpeechRecognition();
        recog.lang = 'id-ID';
        recog.continuous = true;
        recog.interimResults = true;
        recog.onstart = () => setVoiceStatus('Mikrofon aktif. Ucapkan tujuan Anda.');
        recog.onerror = () => setVoiceStatus('Error mikrofon. Coba lagi.');
        recog.onend = () => { 
            isListeningRef.current = false; 
            setVoiceStatus('Mikrofon berhenti.');
            
            // Auto-restart microphone if it was listening (for continuous operation)
            // But only if: 1. It wasn't stopped intentionally, 2. Navigation is not active
            if (recognitionRef.current && !isListeningRef.current) {
                // @ts-ignore - dynamic property
                const wasStopped = recognitionRef.current._stopped;
                const isNavigating = isNavigatingRef.current;
                
                if (!wasStopped && !isNavigating) {
                    setTimeout(() => {
                        if (recognitionRef.current && !isListeningRef.current) {
                            // @ts-ignore - dynamic property
                            if (!recognitionRef.current._stopped && !isNavigatingRef.current) {
                                try {
                                    recognitionRef.current.start();
                                    isListeningRef.current = true;
                                    console.log('🔄 Microphone auto-restarted');
                                } catch (error) {
                                    console.log('⚠️ Could not restart microphone:', error);
                                    // @ts-ignore - dynamic property
                                    recognitionRef.current._stopped = true;
                                }
                            } else if (isNavigatingRef.current) {
                                console.log('ℹ️ Navigation active - microphone auto-restart disabled (say "Halo" to reactivate)');
                            }
                        }
                    }, 1000);
                } else if (isNavigating) {
                    console.log('ℹ️ Navigation active - microphone will not auto-restart (say "Halo" to reactivate)');
                }
            }
        };
        recog.onresult = (event: any) => {
            let finalText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                if (res.isFinal) finalText += res[0].transcript;
            }
            if (finalText) {
                const cmd = finalText.toLowerCase().trim();
                setVoiceStatus(`Saya dengar: "${cmd}"`);
                handleVoiceCommand(cmd);
            }
        };
        recognitionRef.current = recog;
        try { recog.start(); isListeningRef.current = true; } catch {}
    }

    // Handle voice commands (including "Halo", "Rute X", etc)
    async function handleVoiceCommand(text: string) {
        const cleanCommand = text.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        
        // Check for "Halo" activation
        if (cleanCommand === 'halo' || cleanCommand === 'hello' || cleanCommand === 'aktivasi' || cleanCommand === 'activate' || cleanCommand === 'buka mikrofon' || cleanCommand === 'aktifkan') {
            console.log('✅ "Halo" command detected');
            
            // CRITICAL: Always clear stopped flag when user says "Halo"
            if (recognitionRef.current) {
                // @ts-ignore - dynamic property
                if (recognitionRef.current._stopped) {
                    // @ts-ignore - dynamic property
                    recognitionRef.current._stopped = false;
                    console.log('🎤 Clearing stopped flag via "Halo" command');
                }
            }
            
            if (!isListeningRef.current) {
                // Need to re-initialize recognition if not exists
                if (!recognitionRef.current) {
                    const SpeechRecognition: any = (typeof window !== 'undefined') && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
                    if (!SpeechRecognition) {
                        setVoiceStatus('Speech recognition tidak didukung browser ini.');
                        return;
                    }
                    // Initialize recognition with same logic as toggleVoiceListening
                    const recog = new SpeechRecognition();
                    recog.lang = 'id-ID';
                    recog.continuous = true;
                    recog.interimResults = true;
                    recog.onstart = () => setVoiceStatus('Mikrofon aktif. Ucapkan tujuan Anda.');
                    recog.onerror = () => setVoiceStatus('Error mikrofon. Coba lagi.');
                    recog.onend = () => { 
                        isListeningRef.current = false; 
                        setVoiceStatus('Mikrofon berhenti.');
                        
                        // Auto-restart logic (same as toggleVoiceListening)
                        if (recognitionRef.current && !isListeningRef.current) {
                            // @ts-ignore - dynamic property
                            const wasStopped = recognitionRef.current._stopped;
                            const isNavigating = isNavigatingRef.current;
                            
                            if (!wasStopped && !isNavigating) {
                                setTimeout(() => {
                                    if (recognitionRef.current && !isListeningRef.current) {
                                        // @ts-ignore - dynamic property
                                        if (!recognitionRef.current._stopped && !isNavigatingRef.current) {
                                            try {
                                                recognitionRef.current.start();
                                                isListeningRef.current = true;
                                                console.log('🔄 Microphone auto-restarted');
                                            } catch (error) {
                                                console.log('⚠️ Could not restart microphone:', error);
                                                // @ts-ignore - dynamic property
                                                recognitionRef.current._stopped = true;
                                            }
                                        } else if (isNavigatingRef.current) {
                                            console.log('ℹ️ Navigation active - microphone auto-restart disabled (say "Halo" to reactivate)');
                                        }
                                    }
                                }, 1000);
                            } else if (isNavigating) {
                                console.log('ℹ️ Navigation active - microphone will not auto-restart (say "Halo" to reactivate)');
                            }
                        }
                    };
                    recog.onresult = (event: any) => {
                        let finalText = '';
                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            const res = event.results[i];
                            if (res.isFinal) finalText += res[0].transcript;
                        }
                        if (finalText) {
                            const cmd = finalText.toLowerCase().trim();
                            setVoiceStatus(`Saya dengar: "${cmd}"`);
                            handleVoiceCommand(cmd);
                        }
                    };
                    recognitionRef.current = recog;
                }
                
                // Small delay to ensure recognition is ready
                setTimeout(() => {
                    if (recognitionRef.current && !isListeningRef.current) {
                        try {
                            recognitionRef.current.start();
                            isListeningRef.current = true;
                            console.log('✅ Microphone started successfully via "Halo"');
                            
                            // Give different messages based on navigation state
                            if (isNavigatingRef.current) {
                                setVoiceStatus('🎤 Mikrofon aktif kembali. Sebutkan tujuan baru atau ucapkan nama rute.');
                                speak('Mikrofon aktif kembali. Sebutkan tujuan baru atau ucapkan nama rute untuk mengubah rute');
                            } else {
                                setVoiceStatus('🎤 Mikrofon aktif. Ucapkan nama rute atau sebutkan tujuan Anda.');
                                speak('Mikrofon aktif. Ucapkan nama rute seperti "Rute Satu" atau sebutkan nama kota atau lokasi tujuan Anda');
                            }
                        } catch (error: any) {
                            console.error('❌ Failed to start microphone:', error);
                            if (error.message && error.message.includes('not-allowed')) {
                                setVoiceStatus('⚠️ Klik layar sekali untuk mengaktifkan mikrofon');
                                speak('Klik layar terlebih dahulu sekali untuk mengaktifkan mikrofon');
                            } else {
                                setVoiceStatus('⚠️ Error: ' + error.message);
                            }
                        }
                    }
                }, 100);
            } else {
                speak('Mikrofon sudah aktif');
                setVoiceStatus('🎤 Mikrofon sudah aktif');
            }
            return;
        }
        
        // Check for navigation commands
        if (cleanCommand === 'navigasi' || cleanCommand === 'mulai' || cleanCommand.includes('mulai rute') || cleanCommand.includes('mulai navigasi')) {
            console.log('✅ Navigation command detected:', cleanCommand);
            
            // CRITICAL: Setelah "Navigasi" dikatakan, mikrofon HARUS MATI
            // Mikrofon hanya bisa diaktifkan lagi dengan "Halo" atau klik layar
            if (recognitionRef.current) {
                // Set stopped flag - mikrofon mati setelah "Navigasi"
                // @ts-ignore - dynamic property
                recognitionRef.current._stopped = true;
                console.log('🔇 Microphone stopped after "Navigasi" command - user must say "Halo" or click to reactivate');
                
                // @ts-ignore - dynamic property
                if (recognitionRef.current._waitingForNavigasi) {
                    // @ts-ignore - dynamic property
                    recognitionRef.current._waitingForNavigasi = false; // Clear waiting flag - we got Navigasi command
                    console.log('✅ "Navigasi" command received - canceling auto-stop timer');
                }
            }
            
            // Stop microphone - mikrofon MATI setelah "Navigasi"
            if (isListeningRef.current && recognitionRef.current) {
                recognitionRef.current.stop();
                isListeningRef.current = false;
                console.log('🔇 Microphone stopped - navigation started, say "Halo" or click to reactivate');
            }
            
            // For now, just announce navigation started (full implementation needs turn-by-turn functions)
            speak('Navigasi dimulai. Ikuti petunjuk arah.');
            setVoiceStatus('📍 Navigasi dimulai');
            
            // Set navigating flag
            isNavigatingRef.current = true;
            return;
        }
        
        // Try to extract location from command
        const location = extractLocation(text);
        if (location) {
            await handleVoiceDestination(location);
        } else {
            // Try known cities directly
            await handleVoiceDestination(text);
        }
    }

    // Parse spoken destination: "lat,lng" or place name → geocode (improved with knownCities fallback)
    async function handleVoiceDestination(text: string) {
        // Try lat,lng first
        const parts = text.split(',').map((s) => s.trim());
        if (parts.length === 2) {
            const lat = Number(parts[0]);
            const lng = Number(parts[1]);
            if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
                const L = getL();
                if (!L || !mapRef.current) return;
                setDestination({ lat, lng });
                const latlng = L.latLng(lat, lng);
                if (destMarkerRef.current) destMarkerRef.current.setLatLng(latlng);
                else destMarkerRef.current = L.marker(latlng).addTo(mapRef.current);
                if (userMarkerRef.current) drawRoute(userMarkerRef.current.getLatLng(), latlng);
                speak('Tujuan disetel. Menghitung rute.');
                return;
            }
        }
        
        // Try known cities first (instant response, no API call needed)
        const cityKey = text.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        if (knownCities[cityKey]) {
            const city = knownCities[cityKey];
            const L = getL();
            if (!L || !mapRef.current) return;
            setDestination({ lat: city.lat, lng: city.lng });
            const latlng = L.latLng(city.lat, city.lng);
            if (destMarkerRef.current) destMarkerRef.current.setLatLng(latlng);
            else destMarkerRef.current = L.marker(latlng).addTo(mapRef.current);
            if (userMarkerRef.current) drawRoute(userMarkerRef.current.getLatLng(), latlng);
            
            // Stop microphone briefly to announce destination, then restart for "Navigasi" command
            if (isListeningRef.current && recognitionRef.current) {
                recognitionRef.current.stop();
                isListeningRef.current = false;
            }
            
            // Announce destination with callback to give instruction
            speak(`Tujuan Anda adalah ${city.name}`, () => {
                speak('Jika ingin mengganti tujuan sebutkan lokasi dan jika tidak katakan navigasi untuk memulai perjalanan', () => {
                    // Restart microphone to listen for "Navigasi" command (window of 10 seconds)
                    setTimeout(() => {
                        if (recognitionRef.current && !isListeningRef.current) {
                            try {
                                recognitionRef.current.start();
                                isListeningRef.current = true;
                                // @ts-ignore - dynamic property
                                recognitionRef.current._waitingForNavigasi = true;
                                console.log('🎤 Microphone restarted - listening for "Navigasi" command (10 second window)');
                                
                                // Auto-stop after 10 seconds if "Navigasi" not said
                                setTimeout(() => {
                                    // @ts-ignore - dynamic property
                                    if (recognitionRef.current && recognitionRef.current._waitingForNavigasi && isListeningRef.current) {
                                        recognitionRef.current.stop();
                                        // @ts-ignore - dynamic property
                                        recognitionRef.current._stopped = true;
                                        // @ts-ignore - dynamic property
                                        recognitionRef.current._waitingForNavigasi = false;
                                        isListeningRef.current = false;
                                        console.log('🔇 Microphone stopped - "Navigasi" window expired, say "Halo" to restart');
                                        setVoiceStatus(`✅ Tujuan: ${city.name} - Ucapkan "Halo" lalu "Navigasi" untuk memulai`);
                                    }
                                }, 10000); // 10 second window
                            } catch (error) {
                                console.error('Failed to restart microphone:', error);
                                // @ts-ignore - dynamic property
                                recognitionRef.current._stopped = true;
                            }
                        }
                    }, 500);
                });
            });
            
            setVoiceStatus(`✅ Tujuan: ${city.name} - Ucapkan "Navigasi" untuk memulai`);
            return;
        }
        
        // Fallback to Nominatim geocoding
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1&countrycodes=id&accept-language=id`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
                    const L = getL();
                    if (!L || !mapRef.current) return;
                    const fullName = data[0].display_name || data[0].name;
                    setDestination({ lat, lng });
                    const latlng = L.latLng(lat, lng);
                    if (destMarkerRef.current) destMarkerRef.current.setLatLng(latlng);
                    else destMarkerRef.current = L.marker(latlng).addTo(mapRef.current);
                    if (userMarkerRef.current) drawRoute(userMarkerRef.current.getLatLng(), latlng);
                    
                    // Shorten address to remove country and province
                    const shortName = fullName.split(',').slice(0, 3).join(', ').trim();
                    
                    // Stop microphone briefly to announce destination, then restart for "Navigasi" command
                    if (isListeningRef.current && recognitionRef.current) {
                        recognitionRef.current.stop();
                        isListeningRef.current = false;
                    }
                    
                    // Announce shortened destination name
                    speak(`Tujuan Anda adalah ${shortName}`, () => {
                        speak('Jika ingin mengganti tujuan sebutkan lokasi dan jika tidak katakan navigasi untuk memulai perjalanan', () => {
                            // Restart microphone to listen for "Navigasi" command (window of 10 seconds)
                            setTimeout(() => {
                                if (recognitionRef.current && !isListeningRef.current) {
                                    try {
                                        recognitionRef.current.start();
                                        isListeningRef.current = true;
                                        // @ts-ignore - dynamic property
                                        recognitionRef.current._waitingForNavigasi = true;
                                        console.log('🎤 Microphone restarted - listening for "Navigasi" command (10 second window)');
                                        
                                        // Auto-stop after 10 seconds if "Navigasi" not said
                                        setTimeout(() => {
                                            // @ts-ignore - dynamic property
                                            if (recognitionRef.current && recognitionRef.current._waitingForNavigasi && isListeningRef.current) {
                                                recognitionRef.current.stop();
                                                // @ts-ignore - dynamic property
                                                recognitionRef.current._stopped = true;
                                                // @ts-ignore - dynamic property
                                                recognitionRef.current._waitingForNavigasi = false;
                                                isListeningRef.current = false;
                                                console.log('🔇 Microphone stopped - "Navigasi" window expired, say "Halo" to restart');
                                                setVoiceStatus(`✅ Tujuan: ${shortName} - Ucapkan "Halo" lalu "Navigasi" untuk memulai`);
                                            }
                                        }, 10000); // 10 second window
                                    } catch (error) {
                                        console.error('Failed to restart microphone:', error);
                                        // @ts-ignore - dynamic property
                                        recognitionRef.current._stopped = true;
                                    }
                                }
                            }, 500);
                        });
                    });
                    
                    setVoiceStatus(`✅ Tujuan: ${shortName} - Ucapkan "Navigasi" untuk memulai`);
                    return;
                }
            }
            speak('Tujuan tidak ditemukan. Coba sebutkan nama lokasi lain.');
        } catch {
            speak('Terjadi kesalahan saat mencari lokasi.');
        }
    }

    // ========== ROUTES MANAGEMENT FUNCTIONS ==========
    
    // Save routes to localStorage
    function saveRoutesToLocalStorage() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem('senavision_saved_routes', JSON.stringify(savedRoutes));
        } catch (error) {
            console.error('Error saving routes:', error);
        }
    }

    // Helper: Geocode location from name
    async function geocodeLocation(locationName: string): Promise<RouteLocation | null> {
        // Check known cities first
        const cityKey = locationName.toLowerCase().trim().replace(/[.,;:!?]/g, '');
        if (knownCities[cityKey]) {
            return knownCities[cityKey];
        }
        
        // Try Nominatim geocoding
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1&countrycodes=id&accept-language=id`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    name: data[0].display_name
                };
            }
        } catch (error) {
            console.error('Geocoding error:', error);
        }
        return null;
    }

    // Edit route
    function editRoute(route: Route) {
        setEditingRoute(route);
        setFormStart(route.start?.name || '');
        setFormEnd(route.end?.name || '');
        setFormStatus(null);
    }

    // Cancel editing
    function cancelRouteForm() {
        setEditingRoute(null);
        setFormStart('');
        setFormEnd('');
        setFormStatus(null);
    }

    // Save route from form
    async function saveRouteForm(event: React.FormEvent) {
        event.preventDefault();
        
        if (!editingRoute) return;
        if (!formStart.trim() || !formEnd.trim()) {
            setFormStatus({ type: 'error', message: 'Lokasi awal dan tujuan harus diisi!' });
            return;
        }

        setFormStatus({ type: 'loading', message: '⏳ Mencari lokasi...' });

        try {
            const startLocation = await geocodeLocation(formStart);
            if (!startLocation) {
                throw new Error('Lokasi awal tidak ditemukan: ' + formStart);
            }

            const endLocation = await geocodeLocation(formEnd);
            if (!endLocation) {
                throw new Error('Lokasi tujuan tidak ditemukan: ' + formEnd);
            }

            // Update route
            const updatedRoutes = savedRoutes.map(r => 
                r.id === editingRoute.id 
                    ? { ...r, start: startLocation, end: endLocation }
                    : r
            );
            setSavedRoutes(updatedRoutes);
            
            setFormStatus({ type: 'success', message: '✅ Rute berhasil disimpan!' });
            speak(`Rute ${editingRoute.id} berhasil disimpan. Dari ${startLocation.name} ke ${endLocation.name}`);
            
            setTimeout(() => {
                cancelRouteForm();
            }, 1500);
        } catch (error: any) {
            setFormStatus({ type: 'error', message: '❌ ' + (error.message || 'Gagal menyimpan rute') });
        }
    }

    // Delete route
    function deleteRoute(route: Route) {
        if (!route.start || !route.end) return;
        
        const confirmed = confirm(`Apakah Anda yakin ingin menghapus ${route.name}?\n\nDari: ${route.start.name}\nKe: ${route.end.name}`);
        if (!confirmed) return;

        const updatedRoutes = savedRoutes.map(r => 
            r.id === route.id ? { ...r, start: null, end: null } : r
        );
        setSavedRoutes(updatedRoutes);
        speak(`${route.name} telah dihapus`);
    }

    // Helper function to parse distance from text (e.g., "150 m" -> 150)
    function parseDistance(distanceText: string): number {
        if (!distanceText) return 0;
        const text = distanceText.trim().toLowerCase();
        if (text.includes('km')) {
            const km = parseFloat(text.replace('km', '').trim());
            return km * 1000;
        }
        if (text.includes('m')) {
            const m = parseFloat(text.replace('m', '').trim());
            return m;
        }
        return 0;
    }

    // Format distance for display (meter to "150 m" or "1.5 km")
    function formatDistance(meters: number): string {
        if (meters >= 1000) {
            const km = (meters / 1000).toFixed(1);
            return km + ' km';
        } else {
            return Math.round(meters) + ' m';
        }
    }

    return (
        <>
            <Head>
                <title>Live Location Tracker with Route (React)</title>
            </Head>

            {/* JS libs via next/script */}
            <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" />
            <Script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js" strategy="afterInteractive" />

            {/* Map container */}
            <div id="map" ref={mapElRef} style={{ height: '100vh', width: '100%' }} />

            {/* Permission popup */}
            {permissionOpen && (
                <div id="permissionPopup" className="permission-popup">
                    <div className="permission-content">
                        <div className="permission-icon">📍</div>
                        <h2>Akses Lokasi Diperlukan</h2>
                        <p>Aplikasi ini memerlukan akses ke lokasi Anda untuk menampilkan data realtime.</p>
                        <button id="requestPermissionBtn" onClick={requestLocationPermission} className="permission-btn">Berikan Akses Lokasi</button>
                        <p className="permission-hint">Setelah mengklik, browser akan meminta izin akses lokasi</p>
                    </div>
                </div>
            )}

            {/* Buttons */}
            <button id="debugToggleBtn" className="debug-toggle-btn" onClick={toggleDebugPanel} title="Toggle Debug Console">{debugOpen ? '✖️ Tutup' : '🐛 Debug'}</button>
            <button id="routeManagementToggleBtn" className="route-management-toggle-btn" onClick={toggleRouteManagementPanel} title="Kelola Rute">🗺️ Kelola Rute</button>
            <button id="mobileToggleBtn" className="mobile-toggle-btn" onClick={toggleStatusPanel}>📍 Info Lokasi</button>

            {/* Status Panel */}
            <div id="statusPanel" className={`status-panel ${statusPanelOpen ? 'active' : ''}`} style={{ display: statusPanelOpen ? 'block' : undefined }}>
                <button id="closePanelBtn" className="close-panel-btn" onClick={toggleStatusPanel} style={{ display: 'none' }} aria-label="Tutup panel">✖️</button>
                <h3><span className="icon">📍</span> Track Your Location</h3>
                <p id="status">{statusText}</p>
                <p id="coordinates">{coordinatesText}</p>
                <p id="accuracy">{accuracyText}</p>
                <p className="voice-status-text">{voiceStatus}</p>

                <div className="route-info">
                    <h4>Live Route Tracking</h4>
                    <p>Shows route from your current location to destination</p>
                    <p className="route-update-info">Route updates automatically</p>
                </div>
            </div>

            {/* Debug Panel */}
            {debugOpen && (
                <div id="debugPanel" className="debug-panel active" style={{ display: 'flex' }}>
                    <button id="closeDebugBtn" className="close-panel-btn" onClick={toggleDebugPanel} aria-label="Tutup debug panel">✖️</button>
                    <div className="debug-header">
                        <h3><span className="icon">🐛</span> Debug Console</h3>
                        <div className="debug-controls">
                            <button className="clear-debug-btn" onClick={() => { const b = document.getElementById('debugLogsBox'); if (b) b.innerHTML = ''; }}>🗑️ Clear</button>
                            <button className="auto-scroll-btn active" disabled>📜 Auto</button>
                        </div>
                    </div>
                    <div id="debugLogsBox" className="debug-logs"><p className="debug-placeholder">Console logs will appear here...</p></div>
                </div>
            )}

            {/* Route Management Panel */}
            {routePanelOpen && (
                <div id="routeManagementPanel" className="route-management-panel active" style={{ display: 'flex' }}>
                    <button id="closeRoutePanelBtn" className="close-panel-btn" onClick={toggleRouteManagementPanel} aria-label="Tutup panel rute">✖️</button>
                    <div className="route-panel-header">
                        <h3><span className="icon">🗺️</span> Kelola Rute</h3>
                        <button id="routePanelToggleBtn" className="route-toggle-btn" onClick={toggleRouteManagementPanel} title="Tutup/Buka panel">✖️</button>
                    </div>
                    <div className="route-panel-content">
                        <p className="route-panel-description">Atur slot rute untuk navigasi.</p>
                        
                        {/* Route List */}
                        <div className="route-list-container">
                            {savedRoutes.map(route => (
                                <div key={route.id} className={`route-item ${route.start && route.end ? '' : 'empty'}`}>
                                    <div className="route-item-header">
                                        <span className="route-item-name">{route.name}</span>
                                        <div className="route-item-actions">
                                            <button className="route-item-btn" onClick={() => editRoute(route)} title="Edit rute">✏️ Edit</button>
                                            {route.start && route.end && (
                                                <button className="route-item-btn delete" onClick={() => deleteRoute(route)} title="Hapus rute">🗑️ Hapus</button>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`route-item-content ${!route.start || !route.end ? 'empty-content' : ''}`}>
                                        {!route.start || !route.end ? (
                                            <em>Rute kosong - Klik Edit untuk mengisi</em>
                                        ) : (
                                            <div className="route-item-path">
                                                <strong>Dari:</strong> {route.start.name}<br />
                                                <strong>Ke:</strong> {route.end.name}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Route Form */}
                        {editingRoute && (
                            <div className="route-form-container" style={{ display: 'block' }}>
                                <h4 className="route-form-title">Edit {editingRoute.name}</h4>
                                <form onSubmit={saveRouteForm}>
                                    <div className="form-group">
                                        <label htmlFor="routeStart">📍 Lokasi Awal:</label>
                                        <input 
                                            type="text" 
                                            id="routeStart" 
                                            className="route-input" 
                                            placeholder="Contoh: Jakarta" 
                                            value={formStart}
                                            onChange={(e) => setFormStart(e.target.value)}
                                            required 
                                        />
                                        <small className="form-hint">Masukkan nama lokasi awal</small>
                                    </div>
                                    
                                    <div className="form-group">
                                        <label htmlFor="routeEnd">🎯 Lokasi Tujuan:</label>
                                        <input 
                                            type="text" 
                                            id="routeEnd" 
                                            className="route-input" 
                                            placeholder="Contoh: Surakarta" 
                                            value={formEnd}
                                            onChange={(e) => setFormEnd(e.target.value)}
                                            required 
                                        />
                                        <small className="form-hint">Masukkan nama lokasi tujuan</small>
                                    </div>
                                    
                                    <div className="form-actions">
                                        <button type="submit" className="btn-save-route">💾 Simpan Rute</button>
                                        <button type="button" className="btn-cancel-route" onClick={cancelRouteForm}>❌ Batal</button>
                                    </div>
                                </form>
                                
                                {formStatus && (
                                    <div className={`route-form-status ${formStatus.type}`}>
                                        {formStatus.message}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Proximity Alerts (latest 5) */}
            {alerts.length > 0 && (
                <div style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 1000, maxWidth: 360 }}>
                    {alerts.map((a, i) => (
                        <div key={i} style={{ marginTop: 8, padding: 12, borderRadius: 10, background: 'rgba(220,53,69,0.95)', color: '#fff', boxShadow: '0 6px 16px rgba(220,53,69,0.35)', fontWeight: 600 }}>
                            {a}
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}



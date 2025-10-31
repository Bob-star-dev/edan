// Lightweight global event bus to share object detections across components/pages
// Use publishDetections from your postprocess to broadcast results.

export type DetectedObject = {
    label: string;            // e.g. 'person', 'car'
    confidence?: number;      // 0..1
    distanceMeters?: number;  // estimated distance in meters
    bbox?: [number, number, number, number]; // [x, y, w, h] in pixels or normalized
};

type DetectedEventDetail = {
    timestamp: number;
    items: DetectedObject[];
};

const EVENT_NAME = 'object-detections';

// Singleton EventTarget
const target: EventTarget = typeof window !== 'undefined' ? (window as any) : new EventTarget();

export function publishDetections(items: DetectedObject[]) {
    const detail: DetectedEventDetail = { timestamp: Date.now(), items };
    const evt = new CustomEvent(EVENT_NAME, { detail });
    target.dispatchEvent(evt);
}

export function subscribeDetections(handler: (detail: DetectedEventDetail) => void) {
    const listener = (e: Event) => {
        const ce = e as CustomEvent<DetectedEventDetail>;
        if (ce.detail) handler(ce.detail);
    };
    target.addEventListener(EVENT_NAME, listener as EventListener);
    return () => target.removeEventListener(EVENT_NAME, listener as EventListener);
}



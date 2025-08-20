import { useEffect, useRef, useState } from 'react';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';

export default function useHandsDetector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [detector, setDetector] = useState(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stopped = false;
    async function init() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera API not available');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new Error('Network unavailable for hand detector');
        }

        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        const d = await handPoseDetection.createDetector(model, {
          runtime: 'mediapipe',
          modelType: 'lite',
          solutionPath: import.meta.env.DEV
            ? '/node_modules/@mediapipe/hands'
            : '/hands',
        });
        if (stopped) return;
        setDetector(d);
        setReady(true);
      } catch (e) {
        console.error('Init error', e);
        setErr(e && e.message ? e.message : 'Unknown error');
        setReady(true); // default to manual practice
        // Keep UI usable without camera/detector
      }
    }
    init();
    return () => {
      stopped = true;
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks?.() || [];
        tracks.forEach((t) => t.stop());
      }
      // Note: if detector exposes dispose(), consider calling it here.
    };
  }, []);

  return { videoRef, canvasRef, detector, ready, err };
}


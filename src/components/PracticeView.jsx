import React, { useEffect, useRef, useState } from 'react';
import { AI_SUPPORTED } from '../data/signs.js';

export default function PracticeView({ target, onResult, detector, videoRef, canvasRef, recognize }) {
  const [status, setStatus] = useState('Try the sign when you’re ready');
  const [aiSupported, setAiSupported] = useState(!!AI_SUPPORTED[target]);
  const stableCounter = useRef(0);
  const rafRef = useRef(null);

  // Performance: gate status updates to avoid re-render every frame
  const lastStatus = useRef('');
  const setStatusIfChanged = (s) => {
    if (lastStatus.current !== s) {
      lastStatus.current = s;
      setStatus(s);
    }
  };

  // Throttle detection FPS
  const lastTsRef = useRef(0);
  const FPS = 20; // ~20fps saves CPU/GPU
  const FRAME = 1000 / FPS;

  useEffect(() => {
    setAiSupported(!!AI_SUPPORTED[target]);
    stableCounter.current = 0;
  }, [target]);

  useEffect(() => {
    let running = true;

    async function loop(ts) {
      if (!running) return;

      // Pause expensive work when tab is hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // FPS throttle
      if (ts != null) {
        const last = lastTsRef.current;
        if (ts - last < FRAME) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        lastTsRef.current = ts;
      }

      if (!videoRef.current || !canvasRef.current) {
        // Wait until video/canvas are ready (detector may be null in manual mode)
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      ctx.save();
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let hands = [];
      if (detector) {
        try {
          hands = await detector.estimateHands(video, { flipHorizontal: true });
        } catch {
          // ignore
        }
      }

      const canAI = aiSupported && !!detector;

      // Draw landmarks if we have them
      if (hands && hands.length) {
        ctx.lineWidth = 2;
        for (const hand of hands) {
          const kps = hand.keypoints || [];
          for (const kp of kps) {
            if (!kp) continue;
            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#10b981';
            ctx.fill();
          }
          const chains = [
            [0, 1, 2, 3, 4],
            [0, 5, 6, 7, 8],
            [0, 9, 10, 11, 12],
            [0, 13, 14, 15, 16],
            [0, 17, 18, 19, 20],
          ];
          ctx.strokeStyle = '#16a34a';
          for (const chain of chains) {
            ctx.beginPath();
            for (let i = 0; i < chain.length; i++) {
              const p = kps[chain[i]];
              if (!p) continue;
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
          }
        }
      }

      let recognized = null;
      if (canAI) {
        recognized = recognize(target, hands);
      }

      if (canAI && recognized && recognized.label === target && recognized.confidence > 0.8) {
        stableCounter.current += 1;
        setStatusIfChanged(`Detected: ${recognized.label} (${recognized.confidence.toFixed(2)})`);
      } else if (canAI) {
        stableCounter.current = Math.max(0, stableCounter.current - 1);
        setStatusIfChanged('Listening… try the sign');
      } else {
        // Manual fallback
        setStatusIfChanged('Manual practice: use buttons below.');
      }

      if (canAI && stableCounter.current >= 8) {
        running = false;
        setStatusIfChanged('Great job! ✔ Recognized');
        setTimeout(() => onResult(true), 350);
        ctx.restore();
        return;
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [detector, target, aiSupported, onResult, videoRef, canvasRef, recognize]);

  const canAI = aiSupported && !!detector;

  return (
    <div className="w-full space-y-3">
      <div className="text-sm text-gray-500">
        {canAI ? 'AI check enabled' : 'Manual check (camera/AI unavailable)'}
      </div>
      <div className="relative w-full max-w-2xl aspect-video rounded-2xl overflow-hidden shadow">
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas ref={canvasRef} className="w-full h-full bg-black" />
      </div>
      <div className="text-base font-medium">{status}</div>
      {!canAI && (
        <div className="flex gap-2">
          <button
            onClick={() => onResult(true)}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Mark Correct
          </button>
          <button
            onClick={() => onResult(false)}
            className="px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
          >
            Mark Again
          </button>
        </div>
      )}
    </div>
  );
}


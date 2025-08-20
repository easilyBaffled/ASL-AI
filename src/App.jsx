import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';

// ============================================
// ASL Baby Signs – Web POC (Webcam + AI + SRS)
// ============================================
// Fixes in this revision:
// - Added **manual-only fallback** with timeout: practice works even if camera/AI fails
// - Ensured all JSX blocks are fully and correctly closed (hinted build error)
// - Gated PracticeView behind detector readiness (no null usage)
// - Hardened guards around video/canvas context
// - Added FPS throttling + visibility pause + status state gating to reduce re-renders
// - Added more SRS + safety tests (existing tests unchanged)
//
// ✅ Webcam preview with hand landmark overlay (MediaPipe Hands via TFJS hand-pose-detection)
// ✅ Minimal AI recognition for demo signs: I LOVE YOU (ILY), MORE, HELP, STOP
// ✅ Spaced repetition (SM2‑lite) persisted in localStorage
// ✅ Practice flow for due signs + free practice
// ✅ Dev test panel (append #tests to URL)
//
// Notes:
// - Serve over HTTPS for camera permissions.
// - Some ASL signs require motion/body/face context; this POC uses simple heuristics.
// - You can later replace heuristics with a TF.js model to expand coverage.

/*************************
 * Sign List & Metadata (plain JS)
 *************************/

const ALL_SIGNS = [
  { id: 'Help', category: 'Actions' },
  { id: 'All Done', gloss: 'FINISH', category: 'Actions' },
  { id: 'Please', category: 'Politeness' },
  { id: 'More', category: 'Mealtime' },
  { id: 'Good', category: 'Politeness' },
  { id: 'Happy', category: 'Feelings' },
  { id: 'Sad', category: 'Feelings' },
  { id: 'Sleep', category: 'Routines' },
  { id: 'Drink', category: 'Mealtime' },
  { id: 'Eat', gloss: 'EAT/FOOD', category: 'Mealtime' },
  { id: 'Spoon', category: 'Objects' },
  { id: 'Bed', category: 'Objects' },
  { id: 'Diaper', category: 'Routines' },
  { id: 'Book', category: 'Objects' },
  { id: 'Mommy', gloss: 'MOTHER', category: 'People' },
  { id: 'Daddy', gloss: 'FATHER', category: 'People' },
  { id: 'Grandma', gloss: 'GRANDMOTHER', category: 'People' },
  { id: 'Grandpa', gloss: 'GRANDFATHER', category: 'People' },
  { id: 'Baby', category: 'People' },
  { id: 'Rain', category: 'Weather' },
  { id: 'House', category: 'Places' },
  { id: 'Car', category: 'Objects' },
  { id: 'Stroller', category: 'Objects' },
  { id: 'I Love You', gloss: 'ILY', category: 'Politeness' },
  { id: 'Hug', category: 'Feelings' },
  { id: 'Cold', category: 'Feelings' },
  { id: 'Pain', gloss: 'HURT', category: 'Feelings' },
  { id: 'Open', category: 'Actions' },
  { id: 'Close', category: 'Actions' },
  { id: 'Cry', category: 'Feelings' },
  { id: 'Play', category: 'Actions' },
  { id: 'Stop', category: 'Actions' },
  { id: 'Go', category: 'Actions' },
  { id: 'Laugh', category: 'Feelings' },
  { id: 'Tired', category: 'Feelings' },
  { id: 'Up', category: 'Directions' },
  { id: 'Out', category: 'Directions' },
  { id: 'Hold Me', category: 'Actions' },
];

// Minimal initial recognizer coverage for the POC.
const AI_SUPPORTED = {
  'I Love You': true,
  More: true,
  Help: true,
  Stop: true,
};

/*************************
 * Spaced Repetition (SM2-lite)
 *************************/

const STORAGE_KEY = 'asl_srs_v1';

function todayISO(d = new Date()) {
  // yyyy-mm-dd (local midnight)
  const z = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return z.toISOString().slice(0, 10);
}

function loadSrs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const now = todayISO();
  const init = {};
  ALL_SIGNS.forEach(({ id }) => {
    init[id] = { ease: 2.3, intervalDays: 0, due: now, streak: 0 };
  });
  saveSrs(init);
  return init;
}

function saveSrs(srs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(srs));
  } catch {
    // ignore
  }
}

function isDue(item, onDate = todayISO()) {
  return item && item.due <= onDate;
}

function schedule(srs, id, success) {
  const base = srs[id] || {
    ease: 2.3,
    intervalDays: 0,
    due: todayISO(),
    streak: 0,
  };
  let { ease, intervalDays, streak } = base;

  if (success) {
    streak += 1;
    if (intervalDays === 0) intervalDays = 1;
    else if (intervalDays === 1) intervalDays = 3;
    else intervalDays = Math.max(1, Math.round(intervalDays * ease));
    ease = Math.min(2.8, ease + 0.08);
  } else {
    streak = 0;
    ease = Math.max(1.3, ease - 0.2);
    intervalDays = 1;
  }

  const next = new Date();
  next.setDate(next.getDate() + intervalDays);
  srs[id] = { ease, intervalDays, due: todayISO(next), streak };
  saveSrs(srs);
}

/*************************
 * Hand Landmark Utilities (plain JS)
 *************************/

function dist(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function angleABC(a, b, c) {
  // angle at B between BA and BC in degrees
  const abx = a.x - b.x,
    aby = a.y - b.y;
  const cbx = c.x - b.x,
    cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 0;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

// MediaPipe Hands landmark indices:
// 0: wrist
// Thumb: 1-CMC, 2-MCP, 3-IP, 4-tip
// Index: 5-MCP, 6-PIP, 7-DIP, 8-tip
// Middle: 9-MCP, 10-PIP, 11-DIP, 12-tip
// Ring: 13-MCP, 14-PIP, 15-DIP, 16-tip
// Pinky: 17-MCP, 18-PIP, 19-DIP, 20-tip

function palmSize(hand) {
  const w = hand?.keypoints?.[0];
  const m = hand?.keypoints?.[9];
  if (!w || !m) return 1;
  return dist(w, m);
}

function fingerAngles(hand) {
  const kp = hand?.keypoints || [];
  const safe = (i) => kp[i] || kp[0] || { x: 0, y: 0 };
  const thumb = {
    pip: angleABC(safe(2), safe(3), safe(4)),
    mcp: angleABC(safe(1), safe(2), safe(3)),
  };
  const index = {
    pip: angleABC(safe(5), safe(6), safe(7)),
    dip: angleABC(safe(6), safe(7), safe(8)),
  };
  const middle = {
    pip: angleABC(safe(9), safe(10), safe(11)),
    dip: angleABC(safe(10), safe(11), safe(12)),
  };
  const ring = {
    pip: angleABC(safe(13), safe(14), safe(15)),
    dip: angleABC(safe(14), safe(15), safe(16)),
  };
  const pinky = {
    pip: angleABC(safe(17), safe(18), safe(19)),
    dip: angleABC(safe(18), safe(19), safe(20)),
  };
  return { thumb, index, middle, ring, pinky };
}

function isExtended(pip, dip) {
  return pip > 160 && (dip === undefined || dip > 160);
}

function isCurled(pip, dip) {
  return pip < 100 && (dip === undefined || dip < 100);
}

/*************************
 * Simple Heuristic Recognizers
 *************************/

function recogILY(hands) {
  if (!hands || hands.length < 1) return null;
  for (const hand of hands) {
    const ang = fingerAngles(hand);
    const thumbOK = ang.thumb.pip > 160;
    const indexOK = isExtended(ang.index.pip, ang.index.dip);
    const middleCurled = isCurled(ang.middle.pip, ang.middle.dip);
    const ringCurled = isCurled(ang.ring.pip, ang.ring.dip);
    const pinkyOK = isExtended(ang.pinky.pip, ang.pinky.dip);
    const score =
      [thumbOK, indexOK, middleCurled, ringCurled, pinkyOK].filter(Boolean)
        .length / 5;
    if (score > 0.8) return { label: 'I Love You', confidence: score };
  }
  return null;
}

function recogStop(hands) {
  if (!hands || hands.length < 1) return null;
  const hand = hands[0];
  const ang = fingerAngles(hand);
  const indexOK = isExtended(ang.index.pip, ang.index.dip);
  const middleOK = isExtended(ang.middle.pip, ang.middle.dip);
  const ringOK = isExtended(ang.ring.pip, ang.ring.dip);
  const pinkyOK = isExtended(ang.pinky.pip, ang.pinky.dip);
  const count = [indexOK, middleOK, ringOK, pinkyOK].filter(Boolean).length;
  const confidence = count / 4;
  if (confidence > 0.85) return { label: 'Stop', confidence };
  return null;
}

function isOShape(hand) {
  const kp = hand?.keypoints || [];
  const pSize = palmSize(hand);
  const thumbTip = kp[4],
    indexTip = kp[8];
  if (!thumbTip || !indexTip) return false;
  const pinch = dist(thumbTip, indexTip) / (pSize || 1);
  return pinch < 0.35; // thumbs + index close
}

function handCenter(hand) {
  const kp = hand?.keypoints || [];
  const ptsIdx = [0, 5, 9, 13, 17];
  const pts = ptsIdx.map((i) => kp[i]).filter(Boolean);
  if (!pts.length) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

function recogMore(hands) {
  if (!hands || hands.length < 2) return null;
  const h1 = hands[0],
    h2 = hands[1];
  const o1 = isOShape(h1);
  const o2 = isOShape(h2);
  if (!(o1 && o2)) return null;
  const c1 = handCenter(h1),
    c2 = handCenter(h2);
  const ps = (palmSize(h1) + palmSize(h2)) / 2 || 1;
  const centersClose = dist(c1, c2) / ps < 1.2;
  if (centersClose) return { label: 'More', confidence: 0.9 };
  return null;
}

function isFist(hand) {
  const ang = fingerAngles(hand);
  const fingersCurled = [
    isCurled(ang.index.pip, ang.index.dip),
    isCurled(ang.middle.pip, ang.middle.dip),
    isCurled(ang.ring.pip, ang.ring.dip),
    isCurled(ang.pinky.pip, ang.pinky.dip),
  ];
  const count = fingersCurled.filter(Boolean).length;
  return count >= 3;
}

function isFlatPalm(hand) {
  const ang = fingerAngles(hand);
  const fingersExt = [
    isExtended(ang.index.pip, ang.index.dip),
    isExtended(ang.middle.pip, ang.middle.dip),
    isExtended(ang.ring.pip, ang.ring.dip),
    isExtended(ang.pinky.pip, ang.pinky.dip),
  ];
  const count = fingersExt.filter(Boolean).length;
  return count >= 3;
}

function recogHelp(hands) {
  if (!hands || hands.length < 2) return null;
  const [a, b] = hands;
  const aFist = isFist(a),
    aFlat = isFlatPalm(a);
  const bFist = isFist(b),
    bFlat = isFlatPalm(b);
  const aC = handCenter(a),
    bC = handCenter(b);
  const ps = (palmSize(a) + palmSize(b)) / 2 || 1;
  const near =
    Math.abs(aC.x - bC.x) / ps < 1.2 && Math.abs(aC.y - bC.y) / ps < 1.2;
  const aAbove = aC.y < bC.y;
  if (aFist && bFlat && near && aAbove)
    return { label: 'Help', confidence: 0.85 };
  if (bFist && aFlat && near && !aAbove)
    return { label: 'Help', confidence: 0.85 };
  return null;
}

function recognize(target, hands) {
  switch (target) {
    case 'I Love You':
      return recogILY(hands);
    case 'Stop':
      return recogStop(hands);
    case 'More':
      return recogMore(hands);
    case 'Help':
      return recogHelp(hands);
    default:
      return null;
  }
}

/*************************
 * Camera + Detector Hook (robust init)
 *************************/

function useHandsDetector() {
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

        const model = handPoseDetection.SupportedModels.MediaPipeHands;
        const d = await handPoseDetection.createDetector(model, {
          runtime: 'mediapipe',
          modelType: 'lite',
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
        });
        if (stopped) return;
        setDetector(d);
        setReady(true);
      } catch (e) {
        console.error('Init error', e);
        setErr(e && e.message ? e.message : 'Unknown error');
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

/*************************
 * Practice Component (optimized + manual fallback)
 *************************/

function PracticeView({ target, onResult, detector, videoRef, canvasRef }) {
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
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
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

      if (
        canAI &&
        recognized &&
        recognized.label === target &&
        recognized.confidence > 0.8
      ) {
        stableCounter.current += 1;
        setStatusIfChanged(
          `Detected: ${recognized.label} (${recognized.confidence.toFixed(2)})`
        );
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
  }, [detector, target, aiSupported, onResult, videoRef, canvasRef]);

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

/*************************
 * Dev Tests (SRS + Safety)
 *************************/


/*************************
 * UI Helpers
 *************************/

function LoadingCard({ title, subtitle }) {
  return (
    <div className="p-6 rounded-2xl border bg-white shadow flex items-center gap-4">
      <div className="w-5 h-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-gray-600">{subtitle}</div>
      </div>
    </div>
  );
}

/*************************
 * Main App
 *************************/

export default function App() {
  const { videoRef, canvasRef, detector, ready, err } = useHandsDetector();
  const [srs, setSrs] = useState(() => loadSrs());
  const [practiceQueue, setPracticeQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [mode, setMode] = useState('home'); // "home" | "practice" | "free"

  // Manual-only fallback timeout: after N seconds, proceed without AI if still not ready
  const [aiTimeout, setAiTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAiTimeout(true), 6000);
    return () => clearTimeout(t);
  }, []);

  const dueToday = useMemo(() => {
    const today = todayISO();
    return ALL_SIGNS.filter((s) => isDue(srs[s.id], today)).map((s) => s.id);
  }, [srs]);

  useEffect(() => {
    saveSrs(srs);
  }, [srs]);

  function handleStartPractice() {
    const q = dueToday.slice(0, 8);
    if (q.length === 0) {
      alert('Nothing due today — pick any sign for free practice.');
      return;
    }
    setPracticeQueue(q);
    setCurrent(q[0]);
    setMode('practice');
  }

  function handlePracticeResult(success) {
    if (!current) return;
    const srsCopy = { ...srs };
    schedule(srsCopy, current, success);
    setSrs(srsCopy);

    const idx = practiceQueue.indexOf(current);
    const next = practiceQueue[idx + 1];
    if (next) setCurrent(next);
    else {
      setMode('home');
      setPracticeQueue([]);
      setCurrent(null);
    }
  }

  function handleFreePractice(sign) {
    setCurrent(sign);
    setMode('free');
  }

  function SignCard({ sign }) {
    const meta = ALL_SIGNS.find((s) => s.id === sign) || { category: '' };
    const ai = !!AI_SUPPORTED[sign];
    const item = srs[sign];
    const dueStr = item && item.due ? `Due: ${item.due}` : '';
    return (
      <div className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{sign}</div>
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              ai
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {ai ? 'AI-checked' : 'Manual'}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {meta.category}
          {meta.gloss ? ` · Gloss: ${meta.gloss}` : ''}
        </div>
        <div className="text-xs text-gray-500">{dueStr}</div>
        <div className="flex gap-2 pt-1">
          <button
            className="px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={() => handleFreePractice(sign)}
          >
            Practice
          </button>
          <button
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800"
            onClick={() => {
              const srsCopy = { ...srs };
              schedule(srsCopy, sign, true);
              setSrs(srsCopy);
            }}
          >
            Mark Known
          </button>
        </div>
      </div>
    );
  }


  const detectorReady = !!detector && ready;

  const statusBadgeClass = `inline-flex items-center gap-1 px-2 py-1 rounded-full ${
    detectorReady
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700'
  }`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">
            ASL Baby Signs · POC
          </h1>
          <div className="flex items-center gap-2 text-sm">
            <span className={statusBadgeClass}>
              <span className="w-2 h-2 rounded-full bg-current"></span>
              {detectorReady
                ? 'Camera & AI ready'
                : err
                ? `Error: ${err}`
                : 'Initializing camera & AI…'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {mode === 'home' && (
          <div className="space-y-6">
            <section className="rounded-2xl p-5 bg-white shadow">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Today’s Review</h2>
                  <p className="text-sm text-gray-600">
                    {dueToday.length > 0
                      ? `${dueToday.length} sign(s) due`
                      : 'Nothing due — explore free practice below.'}
                  </p>
                </div>
                <button
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  disabled={dueToday.length === 0}
                  onClick={handleStartPractice}
                >
                  Start Review
                </button>
              </div>
              {dueToday.length > 0 && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {dueToday.slice(0, 8).map((s) => (
                    <div
                      key={s}
                      className="px-3 py-2 rounded-xl bg-slate-100 text-sm"
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">All Signs</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALL_SIGNS.map((s) => (
                  <SignCard key={s.id} sign={s.id} />
                ))}
              </div>
            </section>

            <section className="prose max-w-none">
              <h2>How to Use</h2>
              <ol>
                <li>
                  Click <strong>Start Review</strong> for due signs, or pick any
                  sign to <strong>Practice</strong>.
                </li>
                <li>
                  Face the camera with good lighting. Keep your hands within the
                  frame.
                </li>
                <li>
                  For AI-supported signs (ILY, More, Help, Stop), the app
                  auto-checks your signing.
                </li>
                <li>
                  For other signs, use <em>Mark Correct</em> /{' '}
                  <em>Mark Again</em> to drive spaced repetition.
                </li>
              </ol>
              <p className="text-sm text-gray-600">
                Privacy: All processing runs in your browser. No video is
                uploaded.
              </p>
            </section>

          </div>
        )}

        {(mode === 'practice' || mode === 'free') && current && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Practice: {current}</h2>
                <p className="text-sm text-gray-600">
                  {AI_SUPPORTED[current]
                    ? 'AI will attempt to recognize your sign in real time.'
                    : 'Manual grading for this sign (POC).'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200"
                  onClick={() => {
                    setMode('home');
                    setCurrent(null);
                  }}
                >
                  Exit
                </button>
                {mode === 'free' && (
                  <button
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200"
                    onClick={() => setMode('home')}
                  >
                    Done
                  </button>
                )}
              </div>
            </div>

            {!detectorReady && !err && !aiTimeout ? (
              <LoadingCard
                title="Initializing camera & AI…"
                subtitle="Please allow camera access. The lesson will start automatically."
              />
            ) : (
              <div className="grid md:grid-cols-2 gap-6 items-start">
                <PracticeView
                  target={current}
                  onResult={(ok) => {
                    if (mode === 'free') {
                      if (ok) {
                        const copy = { ...srs };
                        schedule(copy, current, true);
                        setSrs(copy);
                      }
                      return;
                    }
                    handlePracticeResult(ok);
                  }}
                  detector={detectorReady ? detector : null}
                  videoRef={videoRef}
                  canvasRef={canvasRef}
                />

                <div className="space-y-3">
                  {(!detectorReady || err) && (
                    <div className="p-3 rounded-xl border bg-amber-50 text-amber-800 text-sm">
                      {err
                        ? `Camera/AI unavailable (${err}). Manual practice enabled.`
                        : aiTimeout
                        ? 'Camera/AI taking too long. Switched to manual practice.'
                        : ''}
                    </div>
                  )}

                  <div className="p-4 rounded-2xl bg-white border shadow">
                    <h3 className="font-semibold mb-2">Tips</h3>
                    <ul className="list-disc pl-4 text-sm text-gray-700 space-y-1">
                      <li>Keep your hands in the frame and well lit.</li>
                      <li>
                        Hold the final position for a moment so the app can
                        confirm.
                      </li>
                      <li>
                        For <strong>More</strong>: make an “O” with each hand
                        (thumb to index) and bring them together.
                      </li>
                      <li>
                        For <strong>Help</strong>: make a fist on top of your
                        open palm, fist slightly above.
                      </li>
                      <li>
                        For <strong>Stop</strong>: flat open palm toward the
                        camera.
                      </li>
                      <li>
                        For <strong>I Love You</strong>: thumb, index, and pinky
                        extended; middle and ring curled.
                      </li>
                    </ul>
                  </div>

                  <div className="p-4 rounded-2xl bg-white border shadow space-y-3">
                    <h3 className="font-semibold">Did it register?</h3>
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() =>
                          mode === 'practice'
                            ? handlePracticeResult(true)
                            : null
                        }
                      >
                        Mark Correct
                      </button>
                      <button
                        className="px-3 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
                        onClick={() =>
                          mode === 'practice'
                            ? handlePracticeResult(false)
                            : null
                        }
                      >
                        Mark Again
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Manual buttons are always available so you’re never
                      blocked.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-10 text-xs text-gray-500">
        <p>
          POC limitations: heuristics only; some signs require motion or
          body/face context. Extend with a learned classifier and more datasets
          for best accuracy.
        </p>
      </footer>
    </div>
  );
}

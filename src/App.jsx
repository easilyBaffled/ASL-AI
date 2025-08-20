import React, { useEffect, useMemo, useState } from 'react';
import PracticeView from './components/PracticeView.jsx';
import useHandsDetector from './hooks/useHandsDetector.js';
import { ALL_SIGNS, AI_SUPPORTED } from './data/signs.js';
import {
  loadSrs,
  saveSrs,
  todayISO,
  isDue,
  schedule,
  recognize,
} from './utils/srs.js';

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
 * Camera + Detector Hook (robust init)
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
                  recognize={recognize}
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

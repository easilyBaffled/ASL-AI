import { ALL_SIGNS } from '../data/signs.js';

const STORAGE_KEY = 'asl_srs_v1';

export function todayISO(d = new Date()) {
  // yyyy-mm-dd (local midnight)
  const z = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return z.toISOString().slice(0, 10);
}

export function loadSrs() {
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

export function saveSrs(srs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(srs));
  } catch {
    // ignore
  }
}

export function isDue(item, onDate = todayISO()) {
  return item && item.due <= onDate;
}

export function schedule(srs, id, success, startDateISO = todayISO()) {
  const nextItem = scheduleSim(srs[id], success, startDateISO);
  srs[id] = nextItem;
  saveSrs(srs);
}

export function scheduleSim(item, success, startDateISO) {
  const base = item || {
    ease: 2.3,
    intervalDays: 0,
    due: startDateISO,
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
  const d = new Date(startDateISO);
  d.setDate(d.getDate() + intervalDays);
  return { ease, intervalDays, due: todayISO(d), streak };
}

// --- Hand Landmark Utilities ---
function dist(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0);
  const dy = (a?.y || 0) - (b?.y || 0);
  return Math.hypot(dx, dy);
}

function angleABC(a, b, c) {
  const abx = (a.x || 0) - (b.x || 0);
  const aby = (a.y || 0) - (b.y || 0);
  const cbx = (c.x || 0) - (b.x || 0);
  const cby = (c.y || 0) - (b.y || 0);
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 0;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

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

// --- Simple Heuristic Recognizers ---
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
  const thumbTip = kp[4], indexTip = kp[8];
  if (!thumbTip || !indexTip) return false;
  const pinch = dist(thumbTip, indexTip) / (pSize || 1);
  return pinch < 0.35;
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
  const h1 = hands[0], h2 = hands[1];
  const o1 = isOShape(h1);
  const o2 = isOShape(h2);
  if (!(o1 && o2)) return null;
  const c1 = handCenter(h1), c2 = handCenter(h2);
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
  const aFist = isFist(a), aFlat = isFlatPalm(a);
  const bFist = isFist(b), bFlat = isFlatPalm(b);
  const aC = handCenter(a), bC = handCenter(b);
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

export function recognize(target, hands) {
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

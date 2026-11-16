import * as THREE from 'three';
import { SeededRandom } from './seededRandom';

export type FragmentType = 'tick' | 'arc' | 'panel' | 'core';

const DEG = Math.PI / 180;
const MAX_SEG_LEN = 0.05;
const MAX_RADIUS = 1.04;
const MAX_OVERSHOOT = 0.04;
const IS_DEV = import.meta.env.DEV;

const SHELL_SEG_TARGETS = [4600, 4000, 4700, 5300, 6400, 7800, 9800];

let _totalSegs = 0;
let _lastSeed = Number.NaN;

// ─── Math Helpers ─────────────────────────────────────────────────────────────

function randomAxis(rng: SeededRandom): THREE.Vector3 {
  const theta = rng.range(0, Math.PI * 2);
  const phi = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  if (v.lengthSq() < 1e-6) return new THREE.Vector3(0, 1, 0);
  return v.normalize();
}

/** Ring-axis distribution.
 * hint='front'      → axis ≈ Z  → ring looks like a circle from camera (HUD concentric)
 * hint='equatorial' → axis ≈ Y  → horizontal platter ring
 * hint='diagonal'   → 30-70° tilt → tilted ellipse (gyroscope look)
 * hint='default'    → original mixed distribution
 */
function jarvisAxis(
  rng: SeededRandom,
  hint: 'default' | 'front' | 'equatorial' | 'diagonal' = 'default',
): THREE.Vector3 {
  if (hint === 'front') {
    // Axis ≈ Z — ring appears as a circle when camera is at +Z
    const theta = rng.range(0, Math.PI * 2);
    const tilt  = rng.range(0, 0.42); // small wobble
    return new THREE.Vector3(
      Math.sin(tilt) * Math.cos(theta),
      Math.sin(tilt) * Math.sin(theta),
      Math.cos(tilt),
    ).normalize();
  }
  if (hint === 'equatorial') {
    const tilt = rng.range(0, 0.28);
    const yaw  = rng.range(0, Math.PI * 2);
    return new THREE.Vector3(Math.sin(tilt)*Math.cos(yaw), Math.cos(tilt), Math.sin(tilt)*Math.sin(yaw)).normalize();
  }
  if (hint === 'diagonal') {
    const tilt = rng.range(0.52, 1.10);
    const yaw  = rng.range(0, Math.PI * 2);
    return new THREE.Vector3(Math.sin(tilt)*Math.cos(yaw), Math.cos(tilt), Math.sin(tilt)*Math.sin(yaw)).normalize();
  }
  // Default mixed distribution
  const roll = rng.next();
  let tilt: number;
  if      (roll < 0.25) tilt = rng.range(0.00, 0.35);
  else if (roll < 0.50) tilt = rng.range(1.22, Math.PI * 0.5);
  else if (roll < 0.80) tilt = rng.range(0.44, 1.14);
  else return randomAxis(rng);
  const yaw = rng.range(0, Math.PI * 2);
  return new THREE.Vector3(Math.sin(tilt)*Math.cos(yaw), Math.cos(tilt), Math.sin(tilt)*Math.sin(yaw)).normalize();
}

function silhouetteAxis(index: number, rng: SeededRandom): THREE.Vector3 {
  const jitter = () => rng.range(-0.12, 0.12);
  switch (index % 4) {
    case 0: return new THREE.Vector3(jitter(), jitter(), 1).normalize();
    case 1: return new THREE.Vector3(jitter(), 1, jitter()).normalize();
    case 2: return new THREE.Vector3(1, jitter(), jitter()).normalize();
    default: return new THREE.Vector3(jitter(), 0.35 + jitter(), 1).normalize();
  }
}

function buildFrame(axis: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { u, v };
}

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function snapToShell(
  x: number, y: number, z: number,
  shellR: number,
  stats: ShellStats,
): [number, number, number] {
  const len = len3(x, y, z);
  if (len < 1e-7) return [shellR, 0, 0];
  const minR = shellR;
  const maxR = Math.min(MAX_RADIUS, shellR * (1 + MAX_OVERSHOOT));
  let r = len;
  if (r < minR - 1e-6 || r > maxR + 1e-6) {
    stats.radiusViolations++;
    r = Math.min(maxR, Math.max(minR, r));
  }
  if (r > MAX_RADIUS) {
    stats.radiusViolations++;
    r = MAX_RADIUS;
  }
  const s = r / len;
  return [x * s, y * s, z * s];
}

function slerpDir(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
): [number, number, number] {
  let dot = ax * bx + ay * by + az * bz;
  dot = Math.min(1, Math.max(-1, dot));
  if (dot > 0.9995) {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const l = len3(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / s;
  const w1 = Math.sin(t * theta) / s;
  const x = ax * w0 + bx * w1;
  const y = ay * w0 + by * w1;
  const z = az * w0 + bz * w1;
  const l = len3(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function interpShell(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
  shellR: number,
  stats: ShellStats,
): [number, number, number] {
  const ra = len3(ax, ay, az) || 1;
  const rb = len3(bx, by, bz) || 1;
  const [dx, dy, dz] = slerpDir(ax / ra, ay / ra, az / ra, bx / rb, by / rb, bz / rb, t);
  const r = ra + (rb - ra) * t;
  return snapToShell(dx * r, dy * r, dz * r, shellR, stats);
}

function pickIntensity(rng: SeededRandom, isCore: boolean): number {
  const u = rng.next();
  if (u < 0.90) return rng.range(0.28, 0.52);
  if (u < 0.98) return rng.range(0.60, 0.88);
  return isCore ? rng.range(1.0, 1.30) : 0.95;
}

function pointOnCircle(
  axis: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3,
  theta: number, colat: number, radius: number,
): [number, number, number] {
  const sinC = Math.sin(colat);
  const cosC = Math.cos(colat);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const dx = (ct * u.x + st * v.x) * sinC + axis.x * cosC;
  const dy = (ct * u.y + st * v.y) * sinC + axis.y * cosC;
  const dz = (ct * u.z + st * v.z) * sinC + axis.z * cosC;
  const l = len3(dx, dy, dz) || 1;
  return [dx / l * radius, dy / l * radius, dz / l * radius];
}

function circlePoint(
  u: THREE.Vector3, v: THREE.Vector3, theta: number, radius: number,
): [number, number, number] {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const dx = ct * u.x + st * v.x;
  const dy = ct * u.y + st * v.y;
  const dz = ct * u.z + st * v.z;
  const l = len3(dx, dy, dz) || 1;
  return [dx / l * radius, dy / l * radius, dz / l * radius];
}

// ─── Buffer Collector ─────────────────────────────────────────────────────────

interface ShellBuffers {
  positions: number[];
  axes: number[];
  speeds: number[];
  phases: number[];
  trails: number[];
  intensities: number[];
}

interface ShellStats {
  ticks: number;
  dashes: number;
  shards: number;
  core: number;
  radiusViolations: number;
  lengthViolations: number;
  longSplits: number;
  maxR: number;
  maxLen: number;
  minR: number;
}

type SegKind = 'ticks' | 'dashes' | 'shards' | 'core';

function createBuffers(): ShellBuffers {
  return { positions: [], axes: [], speeds: [], phases: [], trails: [], intensities: [] };
}

function createStats(): ShellStats {
  return {
    ticks: 0, dashes: 0, shards: 0, core: 0,
    radiusViolations: 0, lengthViolations: 0, longSplits: 0,
    maxR: 0, maxLen: 0, minR: Infinity,
  };
}

function pushRaw(
  buf: ShellBuffers,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  nx: number, ny: number, nz: number,
  speed: number, phase: number, intensity: number,
  kind: SegKind,
  stats: ShellStats,
): void {
  buf.positions.push(ax, ay, az);
  buf.axes.push(nx, ny, nz);
  buf.speeds.push(speed);
  buf.phases.push(phase);
  buf.trails.push(1.0);
  buf.intensities.push(intensity);

  buf.positions.push(bx, by, bz);
  buf.axes.push(nx, ny, nz);
  buf.speeds.push(speed);
  buf.phases.push(phase);
  buf.trails.push(0.0);
  buf.intensities.push(intensity);

  stats[kind]++;
}

function pushSegment(
  buf: ShellBuffers,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  axis: THREE.Vector3,
  speed: number,
  phase: number,
  intensity: number,
  shellR: number,
  kind: SegKind,
  stats: ShellStats,
  depth = 0,
): void {
  let nx = axis.x, ny = axis.y, nz = axis.z;
  const aLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (aLen < 1e-6) { nx = 0; ny = 1; nz = 0; }
  else { nx /= aLen; ny /= aLen; nz /= aLen; }

  const a = snapToShell(ax, ay, az, shellR, stats);
  const b = snapToShell(bx, by, bz, shellR, stats);

  const ra = len3(a[0], a[1], a[2]);
  const rb = len3(b[0], b[1], b[2]);
  stats.maxR = Math.max(stats.maxR, ra, rb);
  stats.minR = Math.min(stats.minR, ra, rb);

  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-8) return;

  if (dist > MAX_SEG_LEN) {
    stats.longSplits++;
    const n = Math.max(2, Math.ceil(dist / (MAX_SEG_LEN * 0.92)));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const p0 = interpShell(a[0], a[1], a[2], b[0], b[1], b[2], t0, shellR, stats);
      const p1 = interpShell(a[0], a[1], a[2], b[0], b[1], b[2], t1, shellR, stats);
      const sx = p1[0] - p0[0], sy = p1[1] - p0[1], sz = p1[2] - p0[2];
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl > MAX_SEG_LEN && depth < 10) {
        pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], axis, speed, phase, intensity, shellR, kind, stats, depth + 1);
      } else {
        stats.maxLen = Math.max(stats.maxLen, sl);
        pushRaw(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], nx, ny, nz, speed, phase, intensity, kind, stats);
      }
    }
    return;
  }

  stats.maxLen = Math.max(stats.maxLen, dist);
  pushRaw(buf, a[0], a[1], a[2], b[0], b[1], b[2], nx, ny, nz, speed, phase, intensity, kind, stats);
}

function fillKind(
  stats: ShellStats,
  kind: SegKind,
  target: number,
  maxIter: number,
  buildOnce: () => void,
): void {
  if (target <= 0) return;
  let i = 0;
  while (stats[kind] < target && i < maxIter) {
    const before = stats[kind];
    if (kind === 'ticks' && target - before < 250) break;
    buildOnce();
    if (stats[kind] === before) break;
    if (stats[kind] > target * 1.12) break;
    i++;
  }
}

// ─── STAGE 1: Plain Rings ─────────────────────────────────────────────────────

function buildPlainRings(buf: ShellBuffers, radius: number, stats: ShellStats): void {
  const axes = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0.707, 0.707, 0),
    new THREE.Vector3(0, 0.707, 0.707),
    new THREE.Vector3(0.577, 0.577, 0.577),
  ];
  for (const axis of axes) {
    const { u, v } = buildFrame(axis.normalize());
    const maxAng = MAX_SEG_LEN / Math.max(radius, 0.01);
    const N = Math.max(8, Math.ceil((Math.PI * 2) / maxAng));
    for (let s = 0; s < N; s++) {
      const t0 = (s / N) * Math.PI * 2;
      const t1 = ((s + 1) / N) * Math.PI * 2;
      const p0 = circlePoint(u, v, t0, radius);
      const p1 = circlePoint(u, v, t1, radius);
      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], axis, 0.1, 0, 0.4, radius, 'dashes', stats);
    }
  }
}

// ─── PRIMITIVE A: TICK BANDS ──────────────────────────────────────────────────

/**
 * buildRingTrack — the atomic JARVIS ring.
 * Generates one arc (or full circle) with:
 *   • A continuous rail of short segments
 *   • Minor tick marks every minorEvery rail steps  (perpendicular, on sphere surface)
 *   • Major tick marks every majorEvery minor ticks (taller)
 * No radial spikes — all marks stay on the sphere surface.
 */
function buildRingTrack(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  axis: THREE.Vector3,
  colat: number,
  arcStart: number,
  arcLen: number,
  speed: number,
  phase: number,
  isCore: boolean,
  stats: ShellStats,
  barcode = false,
  majorEvery = 6,
  showTicks = true,   // suppress ticks on non-middle parallel tracks (prevents ladder rungs)
): void {
  const { u, v } = buildFrame(axis);
  const railStep = (MAX_SEG_LEN * 0.86) / Math.max(r, 0.08);
  const nSeg = Math.max(10, Math.ceil(arcLen / railStep));

  const barPeriod  = barcode ? rng.int(10, 24) : 99999;
  const barGap     = barcode ? rng.int(2, Math.max(2, Math.floor(barPeriod * 0.38))) : 0;
  const minorEvery = Math.max(1, Math.round(rng.range(2.5, 5.5) * DEG / railStep));
  const ha_minor   = rng.range(0.008, 0.013) / Math.max(r, 0.08);
  const ha_major   = ha_minor * rng.range(2.0, 3.2);

  const railInt  = rng.range(isCore ? 0.60 : 0.52, isCore ? 0.80 : 0.72);
  const minorInt = rng.range(isCore ? 0.72 : 0.60, isCore ? 0.90 : 0.78);
  const majorInt = rng.range(isCore ? 0.92 : 0.80, isCore ? 1.0  : 0.96);

  // Organic wobble: makes rings slightly non-circular (like a wobbly hoop)
  const wobbleAmp   = rng.range(0, 0.014) / Math.max(r, 0.1);
  const wobbleFreq  = rng.int(2, 6);
  const wobblePhase = rng.range(0, Math.PI * 2);

  let tickStep = 0;

  for (let s = 0; s < nSeg; s++) {
    const inGap = barcode && (s % barPeriod) < barGap;
    const t0 = arcStart + (s / nSeg) * arcLen;
    const t1 = arcStart + ((s + 1) / nSeg) * arcLen;

    // Wobbled colatitude per step
    const c0 = colat + wobbleAmp * Math.sin(t0 * wobbleFreq + wobblePhase);
    const c1 = colat + wobbleAmp * Math.sin(t1 * wobbleFreq + wobblePhase);

    if (!inGap) {
      const p0 = pointOnCircle(axis, u, v, t0, c0, r);
      const p1 = pointOnCircle(axis, u, v, t1, c1, r);
      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
        axis, speed, phase, railInt, r, 'ticks', stats);
    }

    // Tick marks — only on the designated track to avoid ladder-rung artifacts
    if (showTicks) {
      tickStep++;
      if (!inGap && tickStep >= minorEvery) {
        tickStep = 0;
        const tickIdx = Math.round((t0 - arcStart) / (minorEvery * railStep));
        const isMajor = tickIdx % majorEvery === 0;
        const ha = isMajor ? ha_major : ha_minor;
        const a = pointOnCircle(axis, u, v, t0, c0 - ha, r);
        const b = pointOnCircle(axis, u, v, t0, c0 + ha, r);
        pushSegment(buf, a[0], a[1], a[2], b[0], b[1], b[2],
          axis, speed, phase, isMajor ? majorInt : minorInt, r, 'ticks', stats);
      }
    }
  }
}

/**
 * buildTickBandWithStats — a cluster of 1-4 parallel ring tracks.
 * Mimics the AoU JARVIS "hard-drive platter" / data-track look:
 *   • 1-4 closely-spaced parallel ring tracks (each its own buildRingTrack)
 *   • Full circle or partial arc (adds HUD variety)
 *   • Several pattern variants: solid, barcode, sparse
 *   • silhouette mode → equatorial, fine step, full circle, 1-2 tracks
 */
function buildTickBandWithStats(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  axis: THREE.Vector3,
  sign: number,
  isOuter: boolean,
  isCore: boolean,
  stats: ShellStats,
  silhouette = false,
): void {
  const speed = rng.range(isOuter ? 0.05 : 0.08, isOuter ? 0.22 : 0.45) * sign;
  const phase = rng.range(0, Math.PI * 2);

  // Base colatitude
  const baseColat = silhouette
    ? Math.PI * 0.5 + rng.range(-0.04, 0.04)
    : rng.range(Math.PI * 0.30, Math.PI * 0.70);

  // Number of parallel tracks (1-3; keep low to avoid clutter/rungs)
  const nTracks = silhouette ? rng.int(1, 2)
    : isCore  ? rng.int(1, 3)
    : isOuter ? rng.int(1, 3)
    : rng.int(1, 3);

  // Track spacing in colatitude
  const trackGap = rng.range(0.014, 0.034) / Math.max(r, 0.1);

  // Arc: full circle or partial arc (adds organic asymmetry)
  const isPartial = !silhouette && !isCore && rng.next() > 0.42;
  const arcFrac   = isPartial ? rng.range(0.25, 0.80) : 1.0;
  const arcStart  = isPartial ? rng.range(0, Math.PI * 2) : 0;
  const arcLen    = arcFrac * Math.PI * 2;

  const barcode    = !silhouette && rng.next() > 0.55;
  const majorEvery = rng.int(5, 10);
  const midTrack   = Math.floor(nTracks / 2);  // only middle track gets tick marks

  for (let t = 0; t < nTracks; t++) {
    const colat = baseColat + (t - (nTracks - 1) * 0.5) * trackGap;
    if (colat < 0.12 || colat > Math.PI - 0.12) continue;
    // showTicks=true only for middle track → no "ladder rung" artefacts
    buildRingTrack(buf, rng, r, axis, colat, arcStart, arcLen, speed, phase,
      isCore, stats, barcode, majorEvery, t === midTrack);
  }
}

// ─── PRIMITIVE B: DASHED RINGS ────────────────────────────────────────────────

function buildOneDashCluster(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  axis: THREE.Vector3,
  sign: number,
  isCore: boolean,
  stats: ShellStats,
): void {
  const speed = rng.range(0.05, 0.50) * sign;
  const phase = rng.range(0, Math.PI * 2);
  const { u, v } = buildFrame(axis);
  const ringCount = rng.int(2, 6);
  const baseColat = rng.range(Math.PI * 0.32, Math.PI * 0.68);
  const spacing = rng.range(0.004, 0.015);

  for (let a = 0; a < ringCount; a++) {
    const colat = baseColat + (a - (ringCount - 1) * 0.5) * spacing;
    if (colat < 0.15 || colat > Math.PI - 0.15) continue;

    const ringR = r;
    const maxDashAng = MAX_SEG_LEN / Math.max(ringR, 0.05);
    let angle = rng.range(0, Math.PI * 2);
    const end = angle + Math.PI * 2;
    let isDash = rng.next() > 0.25;

    while (angle < end - 1e-6) {
      const dashAng = rng.range(maxDashAng * 0.45, maxDashAng * 2.2);
      const gapAng = rng.range(maxDashAng * 0.35, maxDashAng * 2.0);
      const segAng = isDash ? dashAng : gapAng;
      const next = Math.min(angle + segAng, end);

      if (isDash && next - angle > 1e-5) {
        const intensity = pickIntensity(rng, isCore);
        const p0 = pointOnCircle(axis, u, v, angle, colat, ringR);
        const p1 = pointOnCircle(axis, u, v, next, colat, ringR);
        pushSegment(
          buf,
          p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
          axis, speed, phase, intensity,
          r, 'dashes', stats,
        );
      }

      angle = next;
      isDash = !isDash;
    }
  }
}

// ─── PRIMITIVE C: PANEL SHARDS ────────────────────────────────────────────────

function buildOnePanel(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  axis: THREE.Vector3,
  sign: number,
  isCore: boolean,
  stats: ShellStats,
): void {
  const speed = rng.range(0.05, 0.45) * sign;
  const phase = rng.range(0, Math.PI * 2);
  const { u, v } = buildFrame(axis);

  const baseLat = rng.range(0.20, Math.PI * 0.42);
  const baseLon = rng.range(0, Math.PI * 2);
  const latSize = rng.range(4, 10) * DEG;
  const lonSize = rng.range(4, 10) * DEG;
  const intensity = pickIntensity(rng, isCore);

  const getCorner = (lat: number, lon: number): [number, number, number] =>
    pointOnCircle(axis, u, v, lon, lat, r);

  const tl = getCorner(baseLat, baseLon);
  const tr = getCorner(baseLat, baseLon + lonSize);
  const bl = getCorner(baseLat + latSize, baseLon);
  const br = getCorner(baseLat + latSize, baseLon + lonSize);

  const edges: [[number, number, number], [number, number, number]][] = [
    [tl, tr], [tr, br], [br, bl], [bl, tl],
  ];
  for (const [e0, e1] of edges) {
    pushSegment(buf, e0[0], e0[1], e0[2], e1[0], e1[1], e1[2], axis, speed, phase, intensity, r, 'shards', stats);
  }

  if (rng.next() < 0.62) {
    const hatchCount = rng.int(3, 8);
    for (let h = 0; h < hatchCount; h++) {
      const t = (h + 1) / (hatchCount + 1);
      const p0 = getCorner(baseLat + t * latSize, baseLon);
      const p1 = getCorner(baseLat + t * latSize, baseLon + lonSize);
      pushSegment(
        buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
        axis, speed, phase, intensity * 0.85, r, 'shards', stats,
      );
    }
  }
}

// ─── PRIMITIVE D: CORE ────────────────────────────────────────────────────────

/**
 * buildCoreCluster — the JARVIS "heart":
 *   A) Iris: 2-3 Z-facing concentric ring tracks (look like nested circles from camera)
 *   B) Gyroscopic rings: 2-4 tilted ring tracks at diverse 3D axes
 *   C) Reticle cross: 6-10 short arc segments forming a compass/cross at equator
 */
function buildCoreCluster(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  stats: ShellStats,
): void {
  // ── A. Iris: viewer-facing concentric rings (Z axis) ──────────────────────
  const irisAxis = new THREE.Vector3(0.05, 0.05, 1).normalize();
  const irisCount = rng.int(2, 3);
  for (let i = 0; i < irisCount; i++) {
    const colat = Math.PI * 0.5 + (i - (irisCount - 1) * 0.5) * rng.range(0.04, 0.09);
    if (colat < 0.12 || colat > Math.PI - 0.12) continue;
    buildRingTrack(buf, rng, r, irisAxis, colat,
      0, Math.PI * 2,
      rng.range(0.08, 0.28) * (i % 2 === 0 ? 1 : -1),
      rng.range(0, Math.PI * 2),
      true, stats, false, 5);
  }

  // ── B. Gyroscopic tilted rings ─────────────────────────────────────────────
  const tiltCount = rng.int(2, 4);
  for (let i = 0; i < tiltCount; i++) {
    const tilt = rng.range(0.25, 1.30);
    const yaw  = i * (Math.PI * 2 / tiltCount) + rng.range(-0.3, 0.3);
    const axis = new THREE.Vector3(
      Math.sin(tilt) * Math.cos(yaw),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(yaw),
    ).normalize();
    const colat = Math.PI * 0.5 + rng.range(-0.08, 0.08);
    buildRingTrack(buf, rng, r, axis, colat,
      0, Math.PI * 2,
      rng.range(0.14, 0.50) * (i % 2 === 0 ? 1 : -1),
      rng.range(0, Math.PI * 2),
      true, stats, false, 6);
  }

  // ── C. Reticle / compass cross ─────────────────────────────────────────────
  const crossAxis = new THREE.Vector3(0, 1, 0);
  const { u: cu, v: cv } = buildFrame(crossAxis);
  const nSpokes = rng.int(6, 10);
  for (let i = 0; i < nSpokes; i++) {
    const theta0 = (i / nSpokes) * Math.PI * 2;
    const theta1 = theta0 + (Math.PI * 2 / nSpokes) * rng.range(0.07, 0.18);
    const p0 = pointOnCircle(crossAxis, cu, cv, theta0, Math.PI * 0.5 - 0.06, r);
    const p1 = pointOnCircle(crossAxis, cu, cv, theta1, Math.PI * 0.5 + 0.06, r);
    pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
      crossAxis, 0.06, 0, pickIntensity(rng, true), r, 'core', stats);
  }
}

// ─── GEOMETRY FINALIZER ───────────────────────────────────────────────────────

function finalizeShellGeometry(
  buf: ShellBuffers,
  shellIndex: number,
  radius: number,
  stats: ShellStats,
  seed: number,
  totalShells: number,
): THREE.BufferGeometry {
  const vertexCount = buf.positions.length / 3;
  const segs = vertexCount / 2;

  let hasNaN = false;
  for (let i = 0; i < buf.positions.length; i++) {
    if (!Number.isFinite(buf.positions[i])) {
      hasNaN = true;
      buf.positions[i] = 0;
    }
  }

  let postLenViol = 0;
  let postRadViol = 0;
  let maxR = 0;
  let minR = Infinity;
  let maxLen = 0;
  const minAllowed = radius;
  const maxAllowed = Math.min(MAX_RADIUS, radius * (1 + MAX_OVERSHOOT));

  for (let i = 0; i < buf.positions.length; i += 6) {
    const ax = buf.positions[i], ay = buf.positions[i + 1], az = buf.positions[i + 2];
    const bx = buf.positions[i + 3], by = buf.positions[i + 4], bz = buf.positions[i + 5];
    const ra = len3(ax, ay, az);
    const rb = len3(bx, by, bz);
    maxR = Math.max(maxR, ra, rb);
    minR = Math.min(minR, ra, rb);
    if (ra < minAllowed - 1e-4 || ra > maxAllowed + 1e-4) postRadViol++;
    if (rb < minAllowed - 1e-4 || rb > maxAllowed + 1e-4) postRadViol++;
    if (ra > MAX_RADIUS + 1e-4 || rb > MAX_RADIUS + 1e-4) postRadViol++;
    const sl = len3(bx - ax, by - ay, bz - az);
    maxLen = Math.max(maxLen, sl);
    if (sl > MAX_SEG_LEN + 1e-4) postLenViol++;
  }

  const attrOk = buf.axes.length === vertexCount * 3 &&
    buf.speeds.length === vertexCount && buf.phases.length === vertexCount &&
    buf.trails.length === vertexCount && buf.intensities.length === vertexCount;

  if (!attrOk) console.error(`[Shell ${shellIndex}] Attribute length mismatch!`);

  const ok = postLenViol === 0 && postRadViol === 0 && !hasNaN && maxR <= MAX_RADIUS + 1e-4;
  const mix = `ticks=${stats.ticks} dashes=${stats.dashes} shards=${stats.shards} core=${stats.core}`;

  if (IS_DEV) {
    if (postLenViol > 0) {
      console.warn(`[Shell ${shellIndex}] VIOLATION: ${postLenViol} segments longer than ${MAX_SEG_LEN} (max=${maxLen.toFixed(4)})`);
    }
    if (postRadViol > 0) {
      console.warn(`[Shell ${shellIndex}] VIOLATION: ${postRadViol} vertices outside r=[${minAllowed.toFixed(3)}, ${maxAllowed.toFixed(3)}] (min=${minR.toFixed(4)} max=${maxR.toFixed(4)})`);
    }
    if (maxR > MAX_RADIUS + 1e-4) {
      console.warn(`[Shell ${shellIndex}] VIOLATION: vertex beyond r=1.04 (maxR=${maxR.toFixed(4)})`);
    }
  }

  console.log(
    `[Shell ${shellIndex}] r=${radius.toFixed(2)} segs=${segs} ${mix} ` +
    `maxR=${maxR.toFixed(4)} maxLen=${maxLen.toFixed(4)} ` +
    (ok ? '✓' : '⚠') +
    (hasNaN ? ' NaN' : ''),
  );

  if (shellIndex === 0 || seed !== _lastSeed) {
    _totalSegs = 0;
    _lastSeed = seed;
  }
  _totalSegs += segs;
  if (shellIndex === totalShells - 1) {
    const inRange = _totalSegs >= 30000 && _totalSegs <= 50000;
    console.log(`[Geometry] total segments across ${totalShells} shells: ${_totalSegs}` + (inRange ? ' ✓' : ' ⚠ outside 30k-50k'));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',   new THREE.Float32BufferAttribute(new Float32Array(buf.positions),   3));
  geo.setAttribute('aAxis',      new THREE.Float32BufferAttribute(new Float32Array(buf.axes),        3));
  geo.setAttribute('aSpeed',     new THREE.Float32BufferAttribute(new Float32Array(buf.speeds),      1));
  geo.setAttribute('aPhase',     new THREE.Float32BufferAttribute(new Float32Array(buf.phases),      1));
  geo.setAttribute('aTrail',     new THREE.Float32BufferAttribute(new Float32Array(buf.trails),      1));
  geo.setAttribute('aIntensity', new THREE.Float32BufferAttribute(new Float32Array(buf.intensities), 1));
  geo.computeBoundingSphere();
  return geo;
}

function mixForShell(shellIndex: number, totalShells: number, radius: number): {
  ticks: number; dashes: number; shards: number; core: number;
} {
  const isOuter = shellIndex === totalShells - 1;
  const target = SHELL_SEG_TARGETS[shellIndex] ?? 5000;
  if (shellIndex === 0 || radius <= 0.35) {
    return {
      ticks: Math.round(target * 0.08),
      dashes: Math.round(target * 0.12),
      shards: Math.round(target * 0.08),
      core: Math.round(target * 0.72),  // core owns most segments on innermost shell
    };
  }
  if (isOuter) {
    return {
      ticks: Math.round(target * 0.56),  // lots of ticks on outer ring for clear silhouette
      dashes: Math.round(target * 0.16),
      shards: Math.round(target * 0.28),
      core: 0,
    };
  }
  const t = shellIndex / (totalShells - 1);
  return {
    ticks:  Math.round(target * (0.42 + t * 0.10)),  // more ticks on all inner shells
    dashes: Math.round(target * (0.26 - t * 0.06)),
    shards: Math.round(target * (0.32 - t * 0.04)),
    core: 0,
  };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export const generateShellGeometry = (
  radius: number,
  shellIndex: number,
  totalShells: number,
  seed: number,
  stage: number = 5,
): THREE.BufferGeometry => {
  const rng = new SeededRandom(seed + shellIndex * 7919);
  const buf = createBuffers();
  const stats = createStats();
  const isOuter = shellIndex === totalShells - 1;
  const isCore = shellIndex === 0 || radius <= 0.35;
  let bandSign = shellIndex % 2 === 0 ? 1 : -1;

  if (stage === 1) {
    buildPlainRings(buf, radius, stats);
    return finalizeShellGeometry(buf, shellIndex, radius, stats, seed, totalShells);
  }

  const mix = mixForShell(shellIndex, totalShells, radius);

  // ── Seed anchor rings (a few carefully-chosen axes per shell) ────────────
  if (!isCore) {
    // 1. ONE equatorial platter (horizontal reference ring, grounding the shape)
    buildTickBandWithStats(buf, rng, radius, jarvisAxis(rng, 'equatorial'), bandSign, isOuter, false, stats, isOuter);
    bandSign *= -1;

    // 2. TWO diagonal rings at distinct tilts (creates the 3D gyroscope depth)
    for (let i = 0; i < 2; i++) {
      buildTickBandWithStats(buf, rng, radius, jarvisAxis(rng, 'diagonal'), bandSign, isOuter, false, stats, false);
      bandSign *= -1;
    }

    // 3. Front-facing ring ONLY on outermost two shells (HUD concentric look, not a bullseye)
    if (shellIndex >= totalShells - 2) {
      buildTickBandWithStats(buf, rng, radius, jarvisAxis(rng, 'front'), bandSign, isOuter, false, stats, false);
      bandSign *= -1;
    }

    // 4. Clean silhouette arc on outer shell
    if (isOuter) {
      buildTickBandWithStats(buf, rng, radius, silhouetteAxis(0, rng), bandSign, true, false, stats, true);
      bandSign *= -1;
    }
  }

  // 5. Fill tick quota with 60% diagonal, 25% random, 15% front
  fillKind(stats, 'ticks', mix.ticks, 80, () => {
    const hintRoll = rng.next();
    const h: 'default' | 'front' | 'diagonal' =
      hintRoll < 0.60 ? 'diagonal' : hintRoll < 0.85 ? 'default' : 'front';
    buildTickBandWithStats(buf, rng, radius, jarvisAxis(rng, h), bandSign, isOuter, isCore, stats);
    bandSign *= -1;
  });

  if (isOuter && mix.dashes > 0) {
    buildOneDashCluster(buf, rng, radius, jarvisAxis(rng, 'front'), bandSign, false, stats);
    bandSign *= -1;
  }

  fillKind(stats, 'dashes', mix.dashes, 40, () => {
    buildOneDashCluster(buf, rng, radius, jarvisAxis(rng), bandSign, isCore, stats);
    bandSign *= -1;
  });

  fillKind(stats, 'shards', mix.shards, 220, () => {
    buildOnePanel(buf, rng, radius, jarvisAxis(rng), bandSign, isCore, stats);
    bandSign *= -1;
  });

  if (mix.core > 0) {
    fillKind(stats, 'core', mix.core, 8, () => {
      buildCoreCluster(buf, rng, radius, stats);
    });
  }

  return finalizeShellGeometry(buf, shellIndex, radius, stats, seed, totalShells);
};

export const generateCorePoints = (radius: number, count: number, seed: number): THREE.BufferGeometry => {
  const rng = new SeededRandom(seed + 999);
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
    const rr = radius * Math.pow(rng.next(), 1 / 3);
    positions.push(
      rr * Math.sin(phi) * Math.cos(theta),
      rr * Math.cos(phi),
      rr * Math.sin(phi) * Math.sin(theta),
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
};

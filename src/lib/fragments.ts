import * as THREE from 'three';
import { SeededRandom } from './seededRandom';

export type FragmentType = 'tick' | 'arc' | 'panel' | 'core';

// ─── Math Helpers ─────────────────────────────────────────────────────────────

function powerLaw(rng: SeededRandom, exp: number): number {
  return Math.pow(rng.next(), exp);
}

/**
 * Fully uniform random axis across the entire sphere surface.
 * This is the key to 3D gyroscopic look - axes at ALL angles.
 */
function randomAxis(rng: SeededRandom): THREE.Vector3 {
  const theta = rng.range(0, Math.PI * 2);
  const phi   = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  if (v.lengthSq() < 1e-6) return new THREE.Vector3(0, 1, 0);
  return v.normalize();
}

/**
 * JARVIS Gyroscopic Axis Distribution:
 * The key to the AoU JARVIS look is rings at EVERY ANGLE in 3D space.
 * No bias toward any single orientation.
 * Mix of equatorial (tilt ~0-20°), inclined (tilt 30-70°), polar (tilt 80-90°)
 * plus fully random axes for variety.
 */
function jarvisAxis(rng: SeededRandom, index: number): THREE.Vector3 {
  const roll = rng.next();

  if (roll < 0.25) {
    // 25%: Equatorial (nearly horizontal, tilt 0-20°) - the outer rings
    const tilt = rng.range(0.0, 0.35);
    const yaw  = rng.range(0, Math.PI * 2);
    return new THREE.Vector3(
      Math.sin(tilt) * Math.cos(yaw),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(yaw),
    ).normalize();
  } else if (roll < 0.50) {
    // 25%: Meridional (nearly vertical, tilt 70-90°) - vertical rings
    const tilt = rng.range(1.22, Math.PI * 0.5);
    const yaw  = rng.range(0, Math.PI * 2);
    return new THREE.Vector3(
      Math.sin(tilt) * Math.cos(yaw),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(yaw),
    ).normalize();
  } else if (roll < 0.80) {
    // 30%: Inclined (tilt 25-65°) - the diagonal "gyroscope" rings
    const tilt = rng.range(0.44, 1.14);
    const yaw  = rng.range(0, Math.PI * 2);
    return new THREE.Vector3(
      Math.sin(tilt) * Math.cos(yaw),
      Math.cos(tilt),
      Math.sin(tilt) * Math.sin(yaw),
    ).normalize();
  } else {
    // 20%: Fully random - maximum variety
    return randomAxis(rng);
  }

  // suppress TypeScript unreachable warning
  void index;
}

/** Clamp any point strictly onto sphere radius R */
function onSphere(x: number, y: number, z: number, r: number): [number, number, number] {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-7) return [r, 0, 0];
  const s = r / len;
  return [x * s, y * s, z * s];
}

/** Build an orthonormal frame {u, v} perpendicular to unit axis */
function buildFrame(axis: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { u, v };
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

function createBuffers(): ShellBuffers {
  return { positions: [], axes: [], speeds: [], phases: [], trails: [], intensities: [] };
}

function pushSegment(
  buf: ShellBuffers,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  axis: THREE.Vector3,
  speed: number,
  phase: number,
  intensity: number,
): void {
  let nx = axis.x, ny = axis.y, nz = axis.z;
  const aLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (aLen < 1e-6) { nx = 0; ny = 1; nz = 0; }
  else { nx /= aLen; ny /= aLen; nz /= aLen; }

  // Head vertex (aTrail = 1.0)
  buf.positions.push(ax, ay, az);
  buf.axes.push(nx, ny, nz);
  buf.speeds.push(speed);
  buf.phases.push(phase);
  buf.trails.push(1.0);
  buf.intensities.push(intensity);

  // Tail vertex (aTrail = 0.0)
  buf.positions.push(bx, by, bz);
  buf.axes.push(nx, ny, nz);
  buf.speeds.push(speed);
  buf.phases.push(phase);
  buf.trails.push(0.0);
  buf.intensities.push(intensity);
}

// ─── STAGE 1: Plain Rings ─────────────────────────────────────────────────────

function buildPlainRings(buf: ShellBuffers, radius: number): void {
  const axes = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0.707, 0.707, 0),
    new THREE.Vector3(0, 0.707, 0.707),
    new THREE.Vector3(0.577, 0.577, 0.577),
  ];
  for (const axis of axes) {
    const { u, v } = buildFrame(axis.normalize());
    const N = 120;
    for (let s = 0; s < N; s++) {
      const t0 = (s / N) * Math.PI * 2;
      const t1 = ((s + 1) / N) * Math.PI * 2;
      const d0 = u.clone().multiplyScalar(Math.cos(t0)).addScaledVector(v, Math.sin(t0));
      const d1 = u.clone().multiplyScalar(Math.cos(t1)).addScaledVector(v, Math.sin(t1));
      const p0 = onSphere(d0.x, d0.y, d0.z, radius);
      const p1 = onSphere(d1.x, d1.y, d1.z, radius);
      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], axis, 0.1, 0, 0.6);
    }
  }
}

// ─── PRIMITIVE A: TICK BANDS ──────────────────────────────────────────────────
/**
 * The backbone of the JARVIS look:
 * Full gyroscopic great-circle rings with dense radial ticks, at ALL tilt angles.
 * Each band/ring spins around its own random 3D axis.
 * Some are full rings (silhouette arcs), some are partial arcs (140-320 deg).
 * Tick marks are SHORT RADIAL SPIKES outward from the ring surface.
 * On outer shells many full-circle rings → clear sphere silhouette.
 */
function buildTickBands(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  bandCount: number,
  isOuterShell: boolean,
): void {
  for (let b = 0; b < bandCount; b++) {
    // Each band's tilt axis is fully 3D (the ring's "pole")
    const ringAxis = jarvisAxis(rng, b);
    // The ring spins cleanly around ITS OWN axis
    const spinAxis = ringAxis;
    const speed = rng.range(0.45, 1.35) * (b % 2 === 0 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);
    const { u, v } = buildFrame(ringAxis);

    // Latitude of the ring on the sphere (angular distance from ringAxis pole)
    // 0 = great circle, >0 = small circle offset from equator
    const latOffset = rng.range(0.0, Math.PI * 0.38);
    const cosLat = Math.cos(latOffset);
    const sinLat = Math.sin(latOffset);

    // Arc span: outer shells have more full rings for silhouette
    const isFullRing = (isOuterShell && b < 3) || rng.next() > 0.45;
    const arcSpan = isFullRing ? Math.PI * 2 : rng.range(Math.PI * 0.55, Math.PI * 1.60);
    const arcStart = isFullRing ? 0 : rng.range(0, Math.PI * 2);

    // Tick density: 0.5–1.2 degrees step
    const stepDeg = rng.range(0.5, 1.2);
    const stepRad = stepDeg * (Math.PI / 180);
    const stepCount = Math.round(arcSpan / stepRad);

    // Band style: ladder (double rail) or comb (single sided ticks)
    const isLadder = rng.next() > 0.5;
    const bandDensity = rng.range(0.60, 0.95);

    let prevInner: [number, number, number] | null = null;
    let prevOuter: [number, number, number] | null = null;

    for (let s = 0; s < stepCount; s++) {
      const theta = arcStart + s * stepRad;

      // Point on the ring (at the latOffset from ringAxis)
      const dirX = Math.cos(theta) * u.x + Math.sin(theta) * v.x;
      const dirY = Math.cos(theta) * u.y + Math.sin(theta) * v.y;
      const dirZ = Math.cos(theta) * u.z + Math.sin(theta) * v.z;

      const px = dirX * sinLat + ringAxis.x * cosLat;
      const py = dirY * sinLat + ringAxis.y * cosLat;
      const pz = dirZ * sinLat + ringAxis.z * cosLat;

      // Tick height (radial outward from sphere surface)
      const isMajor = s % 5 === 0;
      const h = isMajor
        ? rng.range(0.025, 0.040)
        : 0.010 + powerLaw(rng, 2.0) * 0.022;

      const actualOuterR = Math.min(1.04, r + h);

      const [ix, iy, iz] = onSphere(px, py, pz, r);
      const [ox, oy, oz] = onSphere(px, py, pz, actualOuterR);

      // Ring rail segments (arcs connecting adjacent tick bases)
      if (prevInner !== null) {
        pushSegment(buf, prevInner[0], prevInner[1], prevInner[2], ix, iy, iz,
          spinAxis, speed, phase, 0.38);

        if (isLadder && prevOuter !== null) {
          pushSegment(buf, prevOuter[0], prevOuter[1], prevOuter[2], ox, oy, oz,
            spinAxis, speed, phase, 0.28);
        }
      }
      prevInner = [ix, iy, iz];
      prevOuter = [ox, oy, oz];

      // Radial tick spike (the actual tooth / mark)
      if (rng.next() < bandDensity) {
        const rawInt = powerLaw(rng, 0.35);
        const intensity = rawInt > 0.97 ? rng.range(1.0, 1.5) : rng.range(0.28, 0.65);
        pushSegment(buf, ix, iy, iz, ox, oy, oz, spinAxis, speed, phase, intensity);

        // On outer shell: also emit inward spike (spiked gear look)
        if (isOuterShell && isMajor) {
          const [inx, iny, inz] = onSphere(px, py, pz, Math.max(0.3, r - 0.028));
          pushSegment(buf, ix, iy, iz, inx, iny, inz, spinAxis, speed, phase, 0.90);
        }
      }
    }
  }
}

// ─── PRIMITIVE B: DASHED ARCS ─────────────────────────────────────────────────
/**
 * Concentric parallel arcs at various 3D tilts.
 * 2-5 arcs per cluster, tightly spaced.
 * Each cluster spins around its own axis.
 */
function buildDashedArcs(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  clusterCount: number,
): void {
  for (let c = 0; c < clusterCount; c++) {
    const clusterAxis = jarvisAxis(rng, c + 500);
    const spinAxis    = clusterAxis;
    const speed = rng.range(0.40, 1.20) * (c % 2 === 0 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);
    const { u, v } = buildFrame(clusterAxis);

    const arcCount = rng.int(2, 5);
    const baseLat  = rng.range(0.08, Math.PI * 0.45);

    for (let a = 0; a < arcCount; a++) {
      const lat    = baseLat + a * rng.range(0.007, 0.018);
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);

      const arcSpan  = rng.range(Math.PI * 0.45, Math.PI * 1.60);
      const arcStart = rng.range(0, Math.PI * 2);
      const arcEnd   = arcStart + arcSpan;

      const dashRad = rng.range(0.06, 0.20);
      const gapRad  = rng.range(0.03, 0.10);
      const subN    = 8;

      let angle  = arcStart;
      let isDash = rng.next() > 0.4;

      while (angle < arcEnd) {
        const segLen = isDash ? dashRad : gapRad;
        if (isDash) {
          for (let s = 0; s < subN; s++) {
            const t0 = angle + (s / subN) * segLen;
            const t1 = angle + ((s + 1) / subN) * segLen;
            if (t1 > arcEnd) break;

            const [p0x, p0y, p0z] = onSphere(
              (Math.cos(t0) * u.x + Math.sin(t0) * v.x) * sinLat + clusterAxis.x * cosLat,
              (Math.cos(t0) * u.y + Math.sin(t0) * v.y) * sinLat + clusterAxis.y * cosLat,
              (Math.cos(t0) * u.z + Math.sin(t0) * v.z) * sinLat + clusterAxis.z * cosLat,
              r,
            );
            const [p1x, p1y, p1z] = onSphere(
              (Math.cos(t1) * u.x + Math.sin(t1) * v.x) * sinLat + clusterAxis.x * cosLat,
              (Math.cos(t1) * u.y + Math.sin(t1) * v.y) * sinLat + clusterAxis.y * cosLat,
              (Math.cos(t1) * u.z + Math.sin(t1) * v.z) * sinLat + clusterAxis.z * cosLat,
              r,
            );

            const rawInt  = powerLaw(rng, 0.4);
            const intensity = rawInt > 0.96 ? rng.range(0.9, 1.4) : rng.range(0.30, 0.65);
            pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, spinAxis, speed, phase, intensity);
          }
        }
        angle += segLen;
        isDash = !isDash;
      }
    }
  }
}

// ─── PRIMITIVE C: PANEL SHARDS ────────────────────────────────────────────────
/**
 * Small spherical rectangles (lat/lon aligned to LOCAL frame of their axis),
 * with corner bracket outlines, hatch lines inside, and tag notches.
 * Each panel is attached to a randomly tilted local axis, so panels appear
 * at all orientations around the sphere.
 */
function buildPanelShards(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  panelCount: number,
  isOuterShell: boolean,
): void {
  for (let p = 0; p < panelCount; p++) {
    const panelAxis  = jarvisAxis(rng, p + 200);
    const spinAxis   = panelAxis;
    const speed      = rng.range(0.30, 0.90) * (rng.next() > 0.5 ? 1 : -1);
    const phase      = rng.range(0, Math.PI * 2);
    const { u, v }   = buildFrame(panelAxis);

    // Position on this axis's sphere
    const baseLat  = rng.range(0.15, Math.PI * 0.40);
    const baseLon  = rng.range(0, Math.PI * 2);
    const latSize  = rng.range(5, 13) * (Math.PI / 180);
    const lonSize  = rng.range(5, 13) * (Math.PI / 180);

    // Helper: get a point on sphere using the tilted local frame
    const getCorner = (lat: number, lon: number): [number, number, number] => {
      const cosL = Math.cos(lat);
      const sinL = Math.sin(lat);
      const px = (Math.cos(lon) * u.x + Math.sin(lon) * v.x) * sinL + panelAxis.x * cosL;
      const py = (Math.cos(lon) * u.y + Math.sin(lon) * v.y) * sinL + panelAxis.y * cosL;
      const pz = (Math.cos(lon) * u.z + Math.sin(lon) * v.z) * sinL + panelAxis.z * cosL;
      return onSphere(px, py, pz, r);
    };

    const tl = getCorner(baseLat, baseLon);
    const tr = getCorner(baseLat, baseLon + lonSize);
    const bl = getCorner(baseLat + latSize, baseLon);
    const br = getCorner(baseLat + latSize, baseLon + lonSize);

    const rawInt    = powerLaw(rng, 0.4);
    const intensity = rawInt > 0.95 ? rng.range(0.95, 1.40) : rng.range(0.40, 0.80);

    // Rectangle outline
    const edges: [[number, number, number], [number, number, number]][] = [
      [tl, tr], [tr, br], [br, bl], [bl, tl],
    ];
    for (const [e0, e1] of edges) {
      pushSegment(buf, e0[0], e0[1], e0[2], e1[0], e1[1], e1[2], spinAxis, speed, phase, intensity);
    }

    // Horizontal hatch lines inside panel
    const hatchCount = rng.int(1, 4);
    for (let h = 0; h < hatchCount; h++) {
      const t  = (h + 1) / (hatchCount + 1);
      const p0 = getCorner(baseLat + t * latSize, baseLon);
      const p1 = getCorner(baseLat + t * latSize, baseLon + lonSize);
      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], spinAxis, speed, phase, intensity * 0.50);
    }

    // Corner bracket radial tags (outer tick at each corner)
    if (rng.next() > 0.4) {
      for (const corner of [tl, tr, bl, br]) {
        const outerR = Math.min(1.04, r + 0.025);
        const [ox, oy, oz] = onSphere(corner[0], corner[1], corner[2], outerR);
        pushSegment(buf, corner[0], corner[1], corner[2], ox, oy, oz, spinAxis, speed, phase, intensity * 1.1);
      }
    }

    // On outer shell: battlement notch tab at top of panel
    if (isOuterShell && rng.next() > 0.5) {
      const tabR = Math.min(1.04, r + 0.036);
      const [t0x, t0y, t0z] = onSphere(tl[0], tl[1], tl[2], tabR);
      const [t1x, t1y, t1z] = onSphere(tr[0], tr[1], tr[2], tabR);
      pushSegment(buf, tl[0], tl[1], tl[2], t0x, t0y, t0z, spinAxis, speed, phase, 1.25);
      pushSegment(buf, t0x, t0y, t0z, t1x, t1y, t1z, spinAxis, speed, phase, 1.35);
      pushSegment(buf, t1x, t1y, t1z, tr[0], tr[1], tr[2], spinAxis, speed, phase, 1.25);
    }
  }
}

// ─── PRIMITIVE D: CORE NUCLEUS ────────────────────────────────────────────────
/**
 * Dense gyroscopic nucleus:
 * 3-4 tilted orbital rings (each with its own axis) with radial gear teeth,
 * central crosshair reticle, and radial spoke arms.
 */
function buildCoreCluster(buf: ShellBuffers, rng: SeededRandom, r: number): void {
  const coreRadius = Math.min(r, 0.32);

  // ─── Crosshair reticle + diagonal ────────────────────────────────────────────
  const crossAxis  = new THREE.Vector3(0, 1, 0);
  const crossSpeed = 0.45;
  const armLen     = coreRadius * 0.70;

  const crossAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5, Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  for (const ca of crossAngles) {
    const [p0x, p0y, p0z] = onSphere(Math.cos(ca) * 0.015, 0, Math.sin(ca) * 0.015, coreRadius * 0.10);
    const [p1x, p1y, p1z] = onSphere(Math.cos(ca), 0, Math.sin(ca), armLen);
    pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, crossAxis, crossSpeed, 0, 1.30);

    // Graduation ticks along each arm
    for (let tk = 1; tk <= 3; tk++) {
      const frac = tk / 4;
      const tx   = p0x + (p1x - p0x) * frac;
      const ty   = p0y + (p1y - p0y) * frac;
      const tz   = p0z + (p1z - p0z) * frac;
      const perpX = -Math.sin(ca) * 0.014;
      const perpZ =  Math.cos(ca) * 0.014;
      pushSegment(buf, tx - perpX, ty, tz - perpZ, tx + perpX, ty, tz + perpZ, crossAxis, crossSpeed, 0, 1.10);
    }
  }

  // ─── Iris ring ────────────────────────────────────────────────────────────────
  const irisR     = coreRadius * 0.42;
  const irisSpeed = 0.60;
  const { u, v }  = buildFrame(crossAxis);
  const irisSteps = 48;
  for (let s = 0; s < irisSteps; s++) {
    const t0 = (s / irisSteps) * Math.PI * 2;
    const t1 = ((s + 1) / irisSteps) * Math.PI * 2;
    const [p0x, p0y, p0z] = onSphere(Math.cos(t0) * u.x + Math.sin(t0) * v.x, Math.cos(t0) * u.y + Math.sin(t0) * v.y, Math.cos(t0) * u.z + Math.sin(t0) * v.z, irisR);
    const [p1x, p1y, p1z] = onSphere(Math.cos(t1) * u.x + Math.sin(t1) * v.x, Math.cos(t1) * u.y + Math.sin(t1) * v.y, Math.cos(t1) * u.z + Math.sin(t1) * v.z, irisR);
    pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, crossAxis, irisSpeed, 0, 0.90);
    if (s % 3 === 0) {
      const [ox, oy, oz] = onSphere(Math.cos(t0) * u.x + Math.sin(t0) * v.x, Math.cos(t0) * u.y + Math.sin(t0) * v.y, Math.cos(t0) * u.z + Math.sin(t0) * v.z, irisR + 0.025);
      pushSegment(buf, p0x, p0y, p0z, ox, oy, oz, crossAxis, irisSpeed, 0, 1.20);
    }
  }

  // ─── Tilted gyroscopic rings (3 rings, each around different 3D axis) ────────
  const ringDefs = [
    { tilt: 0.55, yaw: 0.0,       speedMul: 1.0,  rFrac: 0.65 },
    { tilt: 1.05, yaw: Math.PI * 0.6, speedMul: -1.3, rFrac: 0.80 },
    { tilt: 0.80, yaw: Math.PI * 1.3, speedMul: 0.7,  rFrac: 0.95 },
  ];
  for (const rd of ringDefs) {
    const rAxis   = new THREE.Vector3(Math.sin(rd.tilt) * Math.cos(rd.yaw), Math.cos(rd.tilt), Math.sin(rd.tilt) * Math.sin(rd.yaw)).normalize();
    const rSpeed  = 0.75 * rd.speedMul;
    const rf      = buildFrame(rAxis);
    const orbitR  = coreRadius * rd.rFrac;
    const segN    = 64;
    for (let s = 0; s < segN; s++) {
      const t0 = (s / segN) * Math.PI * 2;
      const t1 = ((s + 1) / segN) * Math.PI * 2;
      const d0 = rf.u.clone().multiplyScalar(Math.cos(t0)).addScaledVector(rf.v, Math.sin(t0));
      const d1 = rf.u.clone().multiplyScalar(Math.cos(t1)).addScaledVector(rf.v, Math.sin(t1));
      const [p0x, p0y, p0z] = onSphere(d0.x, d0.y, d0.z, orbitR);
      const [p1x, p1y, p1z] = onSphere(d1.x, d1.y, d1.z, orbitR);
      pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, rAxis, rSpeed, rd.yaw, 0.95);
      if (s % 4 === 0) {
        const [ox, oy, oz] = onSphere(d0.x, d0.y, d0.z, orbitR + 0.022);
        pushSegment(buf, p0x, p0y, p0z, ox, oy, oz, rAxis, rSpeed, rd.yaw, 1.25);
      }
    }
  }

  // ─── Radial spokes ───────────────────────────────────────────────────────────
  for (let i = 0; i < 28; i++) {
    const sAxis = randomAxis(rng);
    const rA    = irisR + 0.012;
    const rB    = coreRadius + rng.range(0.01, 0.04);
    const [p0x, p0y, p0z] = onSphere(sAxis.x, sAxis.y, sAxis.z, rA);
    const [p1x, p1y, p1z] = onSphere(sAxis.x, sAxis.y, sAxis.z, rB);
    pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, sAxis, 0.12, rng.range(0, Math.PI * 2), 0.75);
  }
}

// ─── GEOMETRY FINALIZER ───────────────────────────────────────────────────────

function finalizeShellGeometry(buf: ShellBuffers, shellIndex: number, radius: number): THREE.BufferGeometry {
  const vertexCount  = buf.positions.length / 3;
  const segmentCount = vertexCount / 2;

  let hasNaN = false;
  for (let i = 0; i < buf.positions.length; i++) {
    if (!Number.isFinite(buf.positions[i])) {
      hasNaN = true;
      buf.positions[i] = 0;
    }
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < buf.positions.length; i += 3) {
    const x = buf.positions[i], y = buf.positions[i + 1], z = buf.positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const attrOk = buf.axes.length === vertexCount * 3 &&
    buf.speeds.length === vertexCount && buf.phases.length === vertexCount &&
    buf.trails.length === vertexCount && buf.intensities.length === vertexCount;

  if (!attrOk) console.error(`[Shell ${shellIndex}] Attribute length mismatch!`);

  console.log(
    `[Shell ${shellIndex}] r=${radius.toFixed(2)} segs=${segmentCount} ` +
    `bbox=[${minX.toFixed(2)}..${maxX.toFixed(2)}, ${minY.toFixed(2)}..${maxY.toFixed(2)}, ${minZ.toFixed(2)}..${maxZ.toFixed(2)}]` +
    (hasNaN ? ' ⚠NaN' : ' ✓'),
  );

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

  if (stage === 1) {
    buildPlainRings(buf, radius);
    return finalizeShellGeometry(buf, shellIndex, radius);
  }

  const outerFrac   = totalShells > 1 ? shellIndex / (totalShells - 1) : 0.5;
  const isOuterShell = shellIndex === totalShells - 1;

  // A. TICK BANDS (60%) — gyroscopic rings at all 3D tilt angles
  //    Outer shells: more bands, more full circles → clear silhouette
  //    Inner shells: fewer but denser bands
  const bandCount = isOuterShell
    ? 7
    : Math.round(4 + outerFrac * 3);
  buildTickBands(buf, rng, radius, bandCount, isOuterShell);

  // B. DASHED ARCS (20%) — concentric parallel arc clusters, fully 3D tilted
  const arcClusters = Math.round(2 + outerFrac * 3);
  buildDashedArcs(buf, rng, radius, arcClusters);

  // C. PANEL SHARDS (10%) — small lat/lon rectangles in tilted local frames
  const panelCount = Math.round(3 + (1 - outerFrac) * 3);
  buildPanelShards(buf, rng, radius, panelCount, isOuterShell);

  // D. CORE (10%) — gyroscopic nucleus with crosshair, tilted rings, spokes
  if (shellIndex === 0 || radius <= 0.35) {
    buildCoreCluster(buf, rng, radius);
  }

  return finalizeShellGeometry(buf, shellIndex, radius);
};

export const generateCorePoints = (radius: number, count: number, seed: number): THREE.BufferGeometry => {
  const rng       = new SeededRandom(seed + 999);
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi   = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
    const r     = radius * Math.pow(rng.next(), 1 / 3);
    positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
};

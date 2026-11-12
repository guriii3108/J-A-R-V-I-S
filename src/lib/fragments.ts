import * as THREE from 'three';
import { SeededRandom } from './seededRandom';

export type FragmentType = 'tick' | 'arc' | 'panel' | 'core';

// ─── Math Helpers ─────────────────────────────────────────────────────────────

/** Power-law random: biased toward low values when exponent > 1 */
function powerLaw(rng: SeededRandom, exp: number): number {
  return Math.pow(rng.next(), exp);
}

/** Random normalized unit axis on sphere */
function randomAxis(rng: SeededRandom): THREE.Vector3 {
  const theta = rng.range(0, Math.PI * 2);
  const phi   = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  if (v.lengthSq() < 1e-6) {
    return new THREE.Vector3(0, 1, 0);
  }
  return v.normalize();
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
  axes: number[];       // aAxis (vec3)
  speeds: number[];     // aSpeed (float)
  phases: number[];     // aPhase (float)
  trails: number[];     // aTrail (float) -> 1.0 = head, 0.0 = tail
  intensities: number[];// aIntensity (float)
}

function createBuffers(): ShellBuffers {
  return {
    positions: [],
    axes: [],
    speeds: [],
    phases: [],
    trails: [],
    intensities: [],
  };
}

/**
 * Push one line segment (2 vertices) with cluster attributes.
 * Vertex A = HEAD (aTrail = 1.0)
 * Vertex B = TAIL (aTrail = 0.0)
 */
function pushSegment(
  buf: ShellBuffers,
  ax: number, ay: number, az: number, // Head vertex
  bx: number, by: number, bz: number, // Tail vertex
  axis: THREE.Vector3,
  speed: number,
  phase: number,
  intensity: number,
): void {
  // Ensure axis is strictly normalized
  let nx = axis.x;
  let ny = axis.y;
  let nz = axis.z;
  const aLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (aLen < 1e-6) {
    nx = 0; ny = 1; nz = 0;
  } else {
    nx /= aLen; ny /= aLen; nz /= aLen;
  }

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

// ─── STAGE 1: Plain Rings (Static reference baseline) ─────────────────────────

function buildPlainRings(
  buf: ShellBuffers,
  radius: number,
  _shellIndex: number,
  _totalShells: number,
): void {
  const axis = new THREE.Vector3(0, 1, 0);
  const { u, v } = buildFrame(axis);
  const ringCount = 8;
  const segsPerRing = 120;

  for (let ri = 0; ri < ringCount; ri++) {
    // Latitude rings evenly spaced
    const lat = ((ri + 1) / (ringCount + 1)) * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    for (let s = 0; s < segsPerRing; s++) {
      const t0 = (s / segsPerRing) * Math.PI * 2;
      const t1 = ((s + 1) / segsPerRing) * Math.PI * 2;

      const p0 = onSphere(
        (Math.cos(t0) * u.x + Math.sin(t0) * v.x) * sinLat + axis.x * cosLat,
        (Math.cos(t0) * u.y + Math.sin(t0) * v.y) * sinLat + axis.y * cosLat,
        (Math.cos(t0) * u.z + Math.sin(t0) * v.z) * sinLat + axis.z * cosLat,
        radius,
      );
      const p1 = onSphere(
        (Math.cos(t1) * u.x + Math.sin(t1) * v.x) * sinLat + axis.x * cosLat,
        (Math.cos(t1) * u.y + Math.sin(t1) * v.y) * sinLat + axis.y * cosLat,
        (Math.cos(t1) * u.z + Math.sin(t1) * v.z) * sinLat + axis.z * cosLat,
        radius,
      );

      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], axis, 0.1, 0, 0.6);
    }
  }

  // Plus 2 great circles tilted at 45 and 90 deg
  const tiltAxes = [
    new THREE.Vector3(1, 0, 0).normalize(),
    new THREE.Vector3(0.707, 0, 0.707).normalize(),
  ];
  for (const tAxis of tiltAxes) {
    const fr = buildFrame(tAxis);
    for (let s = 0; s < segsPerRing; s++) {
      const t0 = (s / segsPerRing) * Math.PI * 2;
      const t1 = ((s + 1) / segsPerRing) * Math.PI * 2;
      const d0 = fr.u.clone().multiplyScalar(Math.cos(t0)).addScaledVector(fr.v, Math.sin(t0));
      const d1 = fr.u.clone().multiplyScalar(Math.cos(t1)).addScaledVector(fr.v, Math.sin(t1));
      const p0 = onSphere(d0.x, d0.y, d0.z, radius);
      const p1 = onSphere(d1.x, d1.y, d1.z, radius);
      pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tAxis, 0.15, 0, 0.75);
    }
  }
}

// ─── PRIMITIVE A: TICK BANDS (60% of segments) ────────────────────────────────
/**
 * A circle on the sphere (random tilt axis, angular half-width 3-25 degrees).
 * Tiny radial ticks: angle steps of 0.4-1.2 degrees along the circle.
 * Segment from radius r to r + h, h random 0.01-0.04 (power-law bias toward short).
 * Total radial extent <= 1.04.
 */
function buildTickBands(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  bandCount: number,
): void {
  for (let b = 0; b < bandCount; b++) {
    const axis = randomAxis(rng);
    const speed = rng.range(0.06, 0.55) * (rng.next() > 0.5 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);
    const { u, v } = buildFrame(axis);

    // Angular half-width / distance from axis (circle tilt on sphere)
    const latAngle = rng.range(0.12, Math.PI - 0.12);
    const cosLat = Math.cos(latAngle);
    const sinLat = Math.sin(latAngle);

    // Step size along circle: 0.4 to 1.2 degrees
    const stepDeg = rng.range(0.4, 1.2);
    const stepRad = stepDeg * (Math.PI / 180);
    const totalSteps = Math.round((Math.PI * 2) / stepRad);

    // Density variation per band: some solid (0.95), some sparse (0.35)
    const bandDensity = rng.range(0.35, 0.98);

    // Also draw a thin baseline circular rail along some tick bands (20% of ticks)
    const hasBaseline = rng.next() > 0.4;
    let prevBasePoint: [number, number, number] | null = null;

    for (let s = 0; s < totalSteps; s++) {
      const theta = s * stepRad;
      const dirX = Math.cos(theta) * u.x + Math.sin(theta) * v.x;
      const dirY = Math.cos(theta) * u.y + Math.sin(theta) * v.y;
      const dirZ = Math.cos(theta) * u.z + Math.sin(theta) * v.z;

      const px = dirX * sinLat + axis.x * cosLat;
      const py = dirY * sinLat + axis.y * cosLat;
      const pz = dirZ * sinLat + axis.z * cosLat;

      // Radial tick height: 0.01 to 0.04, power-law bias toward short ticks
      const h = 0.01 + powerLaw(rng, 2.5) * 0.03;
      // Strict constraint: nothing may exceed r=1.04
      const actualOuterR = Math.min(1.04, r + h);

      const [ix, iy, iz] = onSphere(px, py, pz, r);
      const [ox, oy, oz] = onSphere(px, py, pz, actualOuterR);

      // Baseline arc segment along the band circle
      if (hasBaseline) {
        if (prevBasePoint !== null && s % 2 === 0) {
          pushSegment(
            buf,
            prevBasePoint[0], prevBasePoint[1], prevBasePoint[2],
            ix, iy, iz,
            axis, speed, phase, 0.35,
          );
        }
        prevBasePoint = [ix, iy, iz];
      }

      // Skip tick according to density
      if (rng.next() > bandDensity) continue;

      // Power-law intensity: most 0.25-0.55, ~3% at 1.0+ for bloom flares
      const rawInt = powerLaw(rng, 0.35);
      const intensity = rawInt > 0.97 ? rng.range(1.0, 1.6) : rng.range(0.25, 0.55);

      // Push radial tick: inner=head (1.0), outer=tail (0.0)
      pushSegment(buf, ix, iy, iz, ox, oy, oz, axis, speed, phase, intensity);
    }
  }
}

// ─── PRIMITIVE B: DASHED ARCS (20% of segments) ───────────────────────────────
/**
 * Concentric small circles and great-circle arcs made of dashes with random lengths & gaps.
 * 2-6 parallel concentric arcs per cluster, tightly spaced (0.005-0.02 rad apart).
 */
function buildDashedArcs(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  clusterCount: number,
): void {
  for (let c = 0; c < clusterCount; c++) {
    const clusterAxis = randomAxis(rng);
    const speed = rng.range(0.05, 0.55) * (rng.next() > 0.5 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);
    const { u, v } = buildFrame(clusterAxis);

    const arcCount = rng.int(2, 6);
    const baseLat = rng.range(0.2, Math.PI * 0.8);

    for (let a = 0; a < arcCount; a++) {
      const lat = baseLat + a * rng.range(0.006, 0.018);
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);

      const arcSpan = rng.range(Math.PI * 0.4, Math.PI * 1.8);
      const arcStart = rng.range(0, Math.PI * 2);
      const arcEnd = arcStart + arcSpan;

      const dashRad = rng.range(0.05, 0.22);
      const gapRad = rng.range(0.02, 0.12);
      const subSegments = 6; // smooth curve per dash

      let angle = arcStart;
      let isDash = rng.next() > 0.4;

      while (angle < arcEnd) {
        const segLen = isDash ? dashRad : gapRad;
        if (isDash) {
          for (let s = 0; s < subSegments; s++) {
            const t0 = angle + (s / subSegments) * segLen;
            const t1 = angle + ((s + 1) / subSegments) * segLen;
            if (t1 > arcEnd) break;

            const d0x = Math.cos(t0) * u.x + Math.sin(t0) * v.x;
            const d0y = Math.cos(t0) * u.y + Math.sin(t0) * v.y;
            const d0z = Math.cos(t0) * u.z + Math.sin(t0) * v.z;

            const d1x = Math.cos(t1) * u.x + Math.sin(t1) * v.x;
            const d1y = Math.cos(t1) * u.y + Math.sin(t1) * v.y;
            const d1z = Math.cos(t1) * u.z + Math.sin(t1) * v.z;

            const [p0x, p0y, p0z] = onSphere(
              d0x * sinLat + clusterAxis.x * cosLat,
              d0y * sinLat + clusterAxis.y * cosLat,
              d0z * sinLat + clusterAxis.z * cosLat,
              r,
            );
            const [p1x, p1y, p1z] = onSphere(
              d1x * sinLat + clusterAxis.x * cosLat,
              d1y * sinLat + clusterAxis.y * cosLat,
              d1z * sinLat + clusterAxis.z * cosLat,
              r,
            );

            const rawInt = powerLaw(rng, 0.4);
            const intensity = rawInt > 0.96 ? rng.range(0.9, 1.4) : rng.range(0.3, 0.7);

            pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, clusterAxis, speed, phase, intensity);
          }
        }
        angle += segLen;
        isDash = !isDash;
      }
    }
  }
}

// ─── PRIMITIVE C: PANEL SHARDS (10% of segments) ──────────────────────────────
/**
 * Small spherical rectangles (lat/long aligned, 4-12 degrees),
 * drawn as edge outlines, some with internal hatch lines.
 */
function buildPanelShards(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
  panelCount: number,
): void {
  for (let p = 0; p < panelCount; p++) {
    const axis = randomAxis(rng);
    const speed = rng.range(0.04, 0.35) * (rng.next() > 0.5 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);

    const baseLat = rng.range(0.2, Math.PI - 0.2);
    const baseLon = rng.range(0, Math.PI * 2);
    const latSize = rng.range(4, 12) * (Math.PI / 180);
    const lonSize = rng.range(4, 12) * (Math.PI / 180);

    const getCorner = (lat: number, lon: number): [number, number, number] => {
      return onSphere(
        Math.sin(lat) * Math.cos(lon),
        Math.cos(lat),
        Math.sin(lat) * Math.sin(lon),
        r,
      );
    };

    const tl = getCorner(baseLat, baseLon);
    const tr = getCorner(baseLat, baseLon + lonSize);
    const bl = getCorner(baseLat + latSize, baseLon);
    const br = getCorner(baseLat + latSize, baseLon + lonSize);

    const rawInt = powerLaw(rng, 0.4);
    const intensity = rawInt > 0.95 ? rng.range(0.9, 1.3) : rng.range(0.35, 0.75);

    // 4 edges of the rectangle
    const edges: [[number, number, number], [number, number, number]][] = [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl],
    ];
    for (const [e0, e1] of edges) {
      pushSegment(buf, e0[0], e0[1], e0[2], e1[0], e1[1], e1[2], axis, speed, phase, intensity);
    }

    // Internal hatching (some panels)
    if (rng.next() > 0.35) {
      const hatchCount = rng.int(2, 6);
      for (let h = 0; h < hatchCount; h++) {
        const t = (h + 1) / (hatchCount + 1);
        const p0 = getCorner(baseLat + t * latSize, baseLon);
        const p1 = getCorner(baseLat + t * latSize, baseLon + lonSize);
        pushSegment(buf, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], axis, speed, phase, intensity * 0.6);
      }
    }
  }
}

// ─── PRIMITIVE D: CORE (10% of segments, inside r < 0.35) ─────────────────────
/**
 * Dense bright cluster inside r < 0.35: 2-3 tilted spiral rings
 * plus radial tick segments, hottest colors.
 */
function buildCoreCluster(
  buf: ShellBuffers,
  rng: SeededRandom,
  r: number,
): void {
  const coreRadius = Math.min(r, 0.35);
  const ringCount = rng.int(2, 3);

  for (let ring = 0; ring < ringCount; ring++) {
    const axis = randomAxis(rng);
    const speed = rng.range(0.2, 0.7) * (rng.next() > 0.5 ? 1 : -1);
    const phase = rng.range(0, Math.PI * 2);
    const { u, v } = buildFrame(axis);

    const turns = rng.range(1.5, 3.0);
    const steps = 140;

    for (let s = 0; s < steps; s++) {
      const t0 = (s / steps) * Math.PI * 2 * turns;
      const t1 = ((s + 1) / steps) * Math.PI * 2 * turns;

      const lat0 = 0.3 + Math.sin(t0 * 0.4) * 0.25;
      const lat1 = 0.3 + Math.sin(t1 * 0.4) * 0.25;

      const d0x = Math.cos(t0) * u.x + Math.sin(t0) * v.x;
      const d0y = Math.cos(t0) * u.y + Math.sin(t0) * v.y;
      const d0z = Math.cos(t0) * u.z + Math.sin(t0) * v.z;

      const d1x = Math.cos(t1) * u.x + Math.sin(t1) * v.x;
      const d1y = Math.cos(t1) * u.y + Math.sin(t1) * v.y;
      const d1z = Math.cos(t1) * u.z + Math.sin(t1) * v.z;

      const rad = coreRadius * (0.4 + 0.6 * (s / steps));

      const [p0x, p0y, p0z] = onSphere(
        d0x * Math.sin(lat0) + axis.x * Math.cos(lat0),
        d0y * Math.sin(lat0) + axis.y * Math.cos(lat0),
        d0z * Math.sin(lat0) + axis.z * Math.cos(lat0),
        rad,
      );
      const [p1x, p1y, p1z] = onSphere(
        d1x * Math.sin(lat1) + axis.x * Math.cos(lat1),
        d1y * Math.sin(lat1) + axis.y * Math.cos(lat1),
        d1z * Math.sin(lat1) + axis.z * Math.cos(lat1),
        rad,
      );

      // Core is hottest: 0.8 to 1.6
      const intensity = rng.range(0.8, 1.6);
      pushSegment(buf, p0x, p0y, p0z, p1x, p1y, p1z, axis, speed, phase, intensity);
    }
  }

  // Dense radial micro-ticks in core
  const tickCount = 200;
  for (let i = 0; i < tickCount; i++) {
    const axis = randomAxis(rng);
    const [px, py, pz] = onSphere(axis.x, axis.y, axis.z, rng.range(0.08, coreRadius));
    const [ox, oy, oz] = onSphere(axis.x, axis.y, axis.z, rng.range(0.08, coreRadius) + 0.02);
    pushSegment(buf, px, py, pz, ox, oy, oz, axis, 0.2, rng.range(0, Math.PI * 2), rng.range(0.9, 1.5));
  }
}

// ─── STAGE 0 ASSERTION & GEOMETRY FINALIZER ───────────────────────────────────

function finalizeShellGeometry(
  buf: ShellBuffers,
  shellIndex: number,
  radius: number,
): THREE.BufferGeometry {
  const vertexCount = buf.positions.length / 3;
  const segmentCount = vertexCount / 2;

  // 1. Check for NaN / Infinity
  let hasNaN = false;
  for (let i = 0; i < buf.positions.length; i++) {
    if (!Number.isFinite(buf.positions[i])) {
      hasNaN = true;
      console.error(`[STAGE 0 ERROR: Shell ${shellIndex}] Non-finite value in position at index ${i}:`, buf.positions[i]);
      buf.positions[i] = 0;
    }
  }

  // 2. Compute bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < buf.positions.length; i += 3) {
    const x = buf.positions[i];
    const y = buf.positions[i + 1];
    const z = buf.positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // 3. Verify attribute lengths and item sizes
  const attrOk =
    buf.axes.length === vertexCount * 3 &&
    buf.speeds.length === vertexCount &&
    buf.phases.length === vertexCount &&
    buf.trails.length === vertexCount &&
    buf.intensities.length === vertexCount;

  if (!attrOk) {
    console.error(`[STAGE 0 ERROR: Shell ${shellIndex}] Attribute length mismatch!`, {
      vertices: vertexCount,
      axes: buf.axes.length,
      speeds: buf.speeds.length,
      phases: buf.phases.length,
      trails: buf.trails.length,
      intensities: buf.intensities.length,
    });
  }

  // 4. Console log assertion report
  console.log(
    `[STAGE 0 VERIFIED] Shell ${shellIndex} | r=${radius.toFixed(3)} | ` +
    `segments=${segmentCount} | vertices=${vertexCount} | ` +
    `bbox=[${minX.toFixed(3)}..${maxX.toFixed(3)}, ${minY.toFixed(3)}..${maxY.toFixed(3)}, ${minZ.toFixed(3)}..${maxZ.toFixed(3)}]` +
    (hasNaN ? ' ⚠ NaN found!' : ' ✓ clean'),
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(buf.positions), 3));
  geo.setAttribute('aAxis', new THREE.Float32BufferAttribute(new Float32Array(buf.axes), 3));
  geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(new Float32Array(buf.speeds), 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(buf.phases), 1));
  geo.setAttribute('aTrail', new THREE.Float32BufferAttribute(new Float32Array(buf.trails), 1));
  geo.setAttribute('aIntensity', new THREE.Float32BufferAttribute(new Float32Array(buf.intensities), 1));

  geo.computeBoundingSphere();
  return geo;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Generate a complete shell geometry according to the active stage:
 * stage 1: Static plain rings (Stage 1)
 * stage 2+: Full Tick bands (60%), Dashed arcs (20%), Panel shards (10%), Core (10%)
 */
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
    // STAGE 1: Plain great-circle and latitude rings
    buildPlainRings(buf, radius, shellIndex, totalShells);
    return finalizeShellGeometry(buf, shellIndex, radius);
  }

  // STAGE 2+: Full primitives matching reference specification
  const outerFrac = totalShells > 1 ? shellIndex / (totalShells - 1) : 0.5;

  // Outer shells use more tick bands and arcs; inner shells use more shards and dense core
  // A. TICK BANDS (60%)
  const bandCount = Math.round(4 + outerFrac * 7); // 4 to 11 bands
  buildTickBands(buf, rng, radius, bandCount);

  // B. DASHED ARCS (20%)
  const arcClusters = Math.round(2 + outerFrac * 4); // 2 to 6 clusters
  buildDashedArcs(buf, rng, radius, arcClusters);

  // C. PANEL SHARDS (10%)
  const panelCount = Math.round(2 + (1 - outerFrac) * 5); // 2 to 7 panels
  buildPanelShards(buf, rng, radius, panelCount);

  // D. CORE (10% - only on innermost shell r <= 0.35)
  if (shellIndex === 0 || radius <= 0.38) {
    buildCoreCluster(buf, rng, radius);
  }

  return finalizeShellGeometry(buf, shellIndex, radius);
};

/**
 * Kept for Core.tsx point-cloud backwards compatibility
 */
export const generateCorePoints = (
  radius: number,
  count: number,
  seed: number,
): THREE.BufferGeometry => {
  const rng = new SeededRandom(seed + 999);
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(Math.max(-1, Math.min(1, 2 * rng.next() - 1)));
    const r = radius * Math.pow(rng.next(), 1 / 3);
    positions.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
};

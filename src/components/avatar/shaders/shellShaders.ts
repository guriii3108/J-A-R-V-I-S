import * as THREE from 'three';

export interface ShellUniforms {
  uTime: { value: number };
  uStage: { value: number };
  uColorPrimary: { value: THREE.Color };
  uColorSecondary: { value: THREE.Color };
  uColorHot: { value: THREE.Color };
  uOpacityBase: { value: number };
  uDisplacementStrength: { value: number };
  uGlowIntensity: { value: number };
  uPulseOrigins: { value: THREE.Vector3[] };
  uPulseTimes: { value: number[] };
  uHoverPoint: { value: THREE.Vector3 };
  uHoverStrength: { value: number };
  uStateTransition: { value: number };
  uScale: { value: number };
  uHeartbeat: { value: number };   // 0..1 autonomous heartbeat envelope
  uLiveness: { value: number };    // speed multiplier from state
  uShellIndex: { value: number };  // which shell (0=inner, 6=outer)
  uDissolve: { value: number };    // 0=solid, 1=fully dissolved
}

// ─── Vertex Shader ────────────────────────────────────────────────────────────

export const shellVertexShader = /* glsl */`
uniform float uTime;
uniform float uStage;
uniform float uDisplacementStrength;
uniform vec3  uPulseOrigins[4];
uniform float uPulseTimes[4];
uniform vec3  uHoverPoint;
uniform float uHoverStrength;
uniform float uScale;
uniform float uHeartbeat;    // 0..1 heartbeat envelope
uniform float uLiveness;     // overall energy multiplier
uniform float uShellIndex;   // 0=innermost, 6=outermost
uniform float uDissolve;     // 0=solid, 1=fully dissolved

attribute vec3  aAxis;
attribute float aSpeed;
attribute float aPhase;
attribute float aTrail;
attribute float aIntensity;

varying vec3  vColor;
varying float vAlpha;
varying float vDepth;

vec3 rodrigues(vec3 v, vec3 k, float a) {
  float c = cos(a); float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

vec3 getGradientColor(float t) {
  vec3 c0  = vec3(1.000, 0.541, 0.000); // #ff8a00
  vec3 c1  = vec3(1.000, 0.722, 0.188); // #ffb830
  vec3 hot = vec3(1.000, 0.878, 0.541); // #ffe08a
  if (t < 0.70) return mix(c0, c1, t / 0.70);
  return mix(c1, hot, (t - 0.70) / 0.30);
}

float easeOutExpo(float t) {
  return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

void main() {
  float origR = length(position);
  vec3 pos = position;

  // ─── 1. Rodrigues Rotation (each ring spins around its own normal aAxis) ────
  vec3 rotAxis = normalize(aAxis);
  // aSpeed is lively (0.45 - 1.35 rad/s) so rings visibly spin and counter-rotate!
  float liveSpeed = aSpeed * uLiveness * (1.0 + uHeartbeat * 0.25);
  float angle = uTime * liveSpeed + aPhase;
  pos = rodrigues(pos, rotAxis, angle);

  if (origR > 0.0001) pos = normalize(pos) * origR;

  // ─── 2. Autonomous Breathing — multi-octave radial pulse ────────────────────
  float breathFreq  = 0.75 + uShellIndex * 0.10;
  float breathPhase = uShellIndex * 0.45;
  float breathAmp   = 0.035 + uHeartbeat * 0.035;
  float breathe     = sin(uTime * breathFreq - breathPhase) * breathAmp;

  // Delicate micro-tremor on interior shells
  float tremor = sin(uTime * 5.0 + aPhase * 2.0) * 0.005 * (1.0 - uShellIndex / 7.0);

  if (origR > 0.0001) {
    pos = normalize(pos) * (origR + breathe + tremor);
  }

  // ─── 3. Light Trails ────────────────────────────────────────────────────────
  if (uStage >= 4.0) {
    vec3 c = cross(rotAxis, pos);
    float cLen = length(c);
    vec3 tangent = cLen > 0.0001 ? c / cLen : vec3(0.0);
    float trailLag = aSpeed * 0.14 * (1.0 - aTrail);
    pos -= tangent * trailLag;
    if (origR > 0.0001) pos = normalize(pos) * origR;
  }

  // ─── 4. Interaction Displacement ────────────────────────────────────────────
  float totalDisp  = 0.0;
  float totalPulse = 0.0;

  if (uStage >= 5.0) {
    for (int i = 0; i < 4; i++) {
      if (uPulseTimes[i] > 0.0) {
        float age = uTime - uPulseTimes[i];
        if (age > 0.0 && age < 1.4) {
          float dist      = length(pos - uPulseOrigins[i]);
          float ringPos   = age * 2.8;
          float ringDist  = abs(dist - ringPos);
          float ringFall  = 1.0 - smoothstep(0.0, 0.45, ringDist);
          float strength  = easeOutExpo(1.0 - age / 1.4) * ringFall;
          totalDisp  += strength * 0.10;
          totalPulse += strength;
        }
      }
    }

    if (uHoverStrength > 0.01) {
      float hDist = length(pos - uHoverPoint);
      float hFall = 1.0 - smoothstep(0.0, 0.45, hDist);
      totalDisp  += hFall * uHoverStrength * 0.07;
      totalPulse += hFall * uHoverStrength * 0.5;
    }

    vec3 radialDir = origR > 0.0001 ? normalize(pos) : vec3(0.0, 1.0, 0.0);
    pos += radialDir * totalDisp * uDisplacementStrength;
  }

  // ─── 5. Scale ───────────────────────────────────────────────────────────────
  pos *= uScale;

  // ─── 6. Eye Space ───────────────────────────────────────────────────────────
  vec4 eyePos    = modelViewMatrix * vec4(pos, 1.0);
  vec4 centerEye = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  // View-space depth: 0 = back hemisphere, 1 = front (applied in fragment)
  vDepth = 1.0;
  if (uStage >= 4.0 && origR > 0.0001) {
    float normZ = clamp((eyePos.z - centerEye.z) / origR, -1.0, 1.0);
    vDepth = clamp(normZ * 0.5 + 0.5, 0.0, 1.0);
  }

  // ─── 7. Color (amber gradient; white only in the core) ──────────────────────
  if (uStage <= 3.0) {
    vColor = vec3(1.0, 0.70, 0.15) * aIntensity;
    vAlpha = 0.55;
  } else {
    float inten = origR < 0.35 ? aIntensity : min(aIntensity, 1.0);
    float normI = clamp((inten - 0.15) / 0.85, 0.0, 1.0);
    vec3 baseColor = getGradientColor(normI) * inten;
    if (origR < 0.35 && inten > 1.0) {
      baseColor = mix(baseColor, vec3(1.0, 0.98, 0.92), smoothstep(1.0, 1.35, inten) * 0.45);
    }

    // Traveling electrical wave along each ring arc
    float arcAngle = atan(pos.z, pos.x) + atan(pos.y, length(pos.xz) + 0.001);
    float wave     = pow(clamp(sin(uTime * 3.0 * uLiveness + arcAngle * 4.0 + aPhase * 2.0) * 0.5 + 0.5, 0.0, 1.0), 3.0);

    // Heartbeat brightness surge (controlled, not blown out)
    float hbFlare  = uHeartbeat * 0.18;

    // Scintillating micro-sparks on ~1.5% of hot vertices
    float sparkHash = fract(sin(dot(floor(pos * 60.0), vec3(12.9898, 78.233, 45.543))) * 43758.5453 + floor(uTime * 10.0) * 0.1);
    float spark     = step(0.985, sparkHash) * 0.50;
    vec3 sparkCol   = origR < 0.35 ? vec3(1.0, 1.0, 0.95) : vec3(1.0, 0.878, 0.541) * 0.55;

    vColor  = baseColor + vec3(1.0, 0.92, 0.70) * (wave * 0.20 + hbFlare) + sparkCol * spark;
    vColor += vec3(1.0, 0.96, 0.82) * totalPulse * 0.50;

    float trailAlpha = mix(0.38, 0.65, aTrail);
    trailAlpha      *= mix(0.88, 1.0, clamp(inten, 0.0, 1.0));
    trailAlpha      *= (0.88 + wave * 0.12 + hbFlare * 0.20);
    vAlpha           = clamp(trailAlpha + totalPulse * 0.35, 0.38, 1.0);
  }

  // ─── 8. Dissolve / Reform ────────────────────────────────────────────────────
  if (uDissolve > 0.001) {
    // Per-band hash (consistent per ring cluster, varies across bands)
    vec3 bandKey = rotAxis * 100.0 + vec3(aPhase * 10.0);
    float bandHash = fract(sin(dot(bandKey, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    // Finer grain from coarse world position (varies within a band)
    float posHash  = fract(sin(dot(floor(pos * 7.0), vec3(12.9898, 78.233, 45.543))) * 43758.5);
    float dHash    = fract(bandHash * 0.55 + posHash * 0.45);

    // Smooth edge so segments fade smoothly as dissolve front sweeps through
    float dAlpha = 1.0 - smoothstep(uDissolve - 0.12, uDissolve + 0.12, dHash);
    vAlpha *= dAlpha;

    // Dissolving segments drift outward and glow brighter just before vanishing
    float riseAmt = (1.0 - dHash) * uDissolve * 0.055;
    if (origR > 0.0001) pos = normalize(pos) * (origR + riseAmt);

    // Brief bright flash on the dissolve front
    float frontProx = 1.0 - abs(dHash - uDissolve) / 0.14;
    vColor += vec3(1.0, 0.85, 0.55) * max(0.0, frontProx) * 0.6;
  }

  gl_Position = projectionMatrix * eyePos;
}
`;

// ─── Fragment Shader ──────────────────────────────────────────────────────────

export const shellFragmentShader = /* glsl */`
precision highp float;

uniform float uGlowIntensity;
uniform float uOpacityBase;

varying vec3  vColor;
varying float vAlpha;
varying float vDepth;

void main() {
  float depthFade = mix(0.35, 1.0, clamp(vDepth, 0.0, 1.0));
  vec3  finalColor = vColor * uGlowIntensity * depthFade;
  float finalAlpha = clamp(vAlpha * uOpacityBase, 0.0, 1.0);
  gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

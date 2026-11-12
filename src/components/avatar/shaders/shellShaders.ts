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

attribute vec3  aAxis;
attribute float aSpeed;
attribute float aPhase;
attribute float aTrail;
attribute float aIntensity;

varying vec3  vColor;
varying float vAlpha;

vec3 rodrigues(vec3 v, vec3 k, float a) {
  float c = cos(a); float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

vec3 getGradientColor(float t) {
  vec3 c0 = vec3(1.000, 0.541, 0.000); // #ff8a00 (rich warm amber)
  vec3 c1 = vec3(1.000, 0.784, 0.239); // #ffc83d (vibrant gold)
  vec3 c2 = vec3(1.000, 0.945, 0.722); // #fff1b8 (hot white-gold)
  if (t < 0.65) return mix(c0, c1, t / 0.65);
  return mix(c1, c2, (t - 0.65) / 0.35);
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

  // Depth fade: far side 40%, near side 100%
  float depthFade = 1.0;
  if (uStage >= 4.0 && origR > 0.0001) {
    float normZ = clamp((eyePos.z - centerEye.z) / origR, -1.0, 1.0);
    depthFade   = mix(0.40, 1.00, normZ * 0.5 + 0.5);
  }

  // ─── 7. Color (Rich JARVIS Golden Amber with Controlled Bloom) ──────────────
  if (uStage <= 3.0) {
    vColor = vec3(1.0, 0.70, 0.15) * aIntensity;
    vAlpha = 1.0;
  } else {
    float normI    = clamp((aIntensity - 0.25) / 0.85, 0.0, 1.0);
    vec3 baseColor = getGradientColor(normI) * aIntensity * depthFade;

    // Traveling electrical wave along each ring arc
    float arcAngle = atan(pos.z, pos.x) + atan(pos.y, length(pos.xz) + 0.001);
    float wave     = pow(clamp(sin(uTime * 3.0 * uLiveness + arcAngle * 4.0 + aPhase * 2.0) * 0.5 + 0.5, 0.0, 1.0), 3.0);

    // Heartbeat brightness surge (controlled, not blown out)
    float hbFlare  = uHeartbeat * 0.18;

    // Scintillating micro-sparks on ~1.5% of hot vertices
    float sparkHash = fract(sin(dot(floor(pos * 60.0), vec3(12.9898, 78.233, 45.543))) * 43758.5453 + floor(uTime * 10.0) * 0.1);
    float spark     = step(0.985, sparkHash) * 0.50;

    vColor  = baseColor + vec3(1.0, 0.92, 0.70) * (wave * 0.20 + hbFlare) + vec3(1.0, 1.0, 0.95) * spark;
    vColor += vec3(1.0, 0.96, 0.82) * totalPulse * 0.50;

    // Trail fade: head bright (1.0), tail dim (0.18 floor)
    float trailAlpha = mix(0.18, 1.0, aTrail);
    trailAlpha      *= clamp(aIntensity * 0.9, 0.25, 1.0);
    trailAlpha      *= (0.85 + wave * 0.15 + hbFlare * 0.20);
    vAlpha           = clamp(trailAlpha + totalPulse * 0.35, 0.18, 1.0);
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

void main() {
  vec3  finalColor = vColor * uGlowIntensity;
  float finalAlpha = clamp(vAlpha * uOpacityBase, 0.0, 1.0);
  gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

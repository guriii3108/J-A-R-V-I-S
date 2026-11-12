import * as THREE from 'three';

/**
 * Shell Uniforms interface
 */
export interface ShellUniforms {
  uTime: { value: number };
  uStage: { value: number }; // 1=Plain rings, 2=Geometry, 3=Basic shader, 4=Polish, 5=Full
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
}

// ─── Vertex Shader ────────────────────────────────────────────────────────────

export const shellVertexShader = /* glsl */`
// ---- Custom Uniforms ----
uniform float uTime;
uniform float uStage; // Controls active stage (3, 4, 5)
uniform float uDisplacementStrength;
uniform vec3  uPulseOrigins[4];
uniform float uPulseTimes[4];
uniform vec3  uHoverPoint;
uniform float uHoverStrength;
uniform float uScale;

// ---- Custom Per-Vertex Attributes ----
attribute vec3  aAxis;      // Cluster rotation axis (unit vector)
attribute float aSpeed;     // Signed rotation speed rad/s
attribute float aPhase;     // Phase offset
attribute float aTrail;     // 1.0 = head (bright), 0.0 = tail (dim)
attribute float aIntensity; // Power-law brightness

// ---- Varyings ----
varying vec3  vColor;
varying float vAlpha;

// ---- Rodrigues Rotation Formula ----
vec3 rodrigues(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// ---- JARVIS Golden Amber Gradient ----
// #ff8a00 -> #ffc83d -> hot #fff1b8
vec3 getGradientColor(float t) {
  vec3 c0 = vec3(1.000, 0.541, 0.000); // #ff8a00
  vec3 c1 = vec3(1.000, 0.784, 0.239); // #ffc83d
  vec3 c2 = vec3(1.000, 0.945, 0.722); // #fff1b8
  if (t < 0.65) {
    return mix(c0, c1, t / 0.65);
  } else {
    return mix(c1, c2, (t - 0.65) / 0.35);
  }
}

float easeOutExpo(float t) {
  return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

void main() {
  float origR = length(position);
  vec3 pos = position;

  // ─── 1. GPU Rodrigues Rotation ──────────────────────────────────────────────
  vec3 rotAxis = normalize(aAxis);
  float angle = uTime * aSpeed + aPhase;
  pos = rodrigues(pos, rotAxis, angle);

  // Keep strictly on sphere radius
  if (origR > 0.0001) {
    pos = normalize(pos) * origR;
  }

  // ─── 2. STAGE 4+: Light Trails ──────────────────────────────────────────────
  if (uStage >= 4.0) {
    // Tangent perpendicular to rotation axis
    vec3 c = cross(rotAxis, pos);
    float cLen = length(c);
    vec3 tangent = cLen > 0.0001 ? c / cLen : vec3(0.0);

    // Head (aTrail=1.0) has 0 offset; Tail (aTrail=0.0) lags behind
    float trailLag = aSpeed * 0.15 * (1.0 - aTrail);
    pos -= tangent * trailLag;

    // Re-clamp to spherical shell
    if (origR > 0.0001) {
      pos = normalize(pos) * origR;
    }
  }

  // ─── 3. STAGE 5: Radial Interaction Displacement ────────────────────────────
  float totalDisp = 0.0;
  float totalPulse = 0.0;

  if (uStage >= 5.0) {
    // Shockwave pulses
    for (int i = 0; i < 4; i++) {
      if (uPulseTimes[i] > 0.0) {
        float age = uTime - uPulseTimes[i];
        if (age > 0.0 && age < 1.2) {
          float dist = length(pos - uPulseOrigins[i]);
          float ringPos = age * 3.0;
          float ringDist = abs(dist - ringPos);
          float ringFalloff = 1.0 - smoothstep(0.0, 0.4, ringDist);
          float strength = easeOutExpo(1.0 - age / 1.2) * ringFalloff;
          totalDisp += strength * 0.08;
          totalPulse += strength;
        }
      }
    }

    // Hover interaction
    if (uHoverStrength > 0.01) {
      float hDist = length(pos - uHoverPoint);
      float hFall = 1.0 - smoothstep(0.0, 0.45, hDist);
      totalDisp += hFall * uHoverStrength * 0.06;
      totalPulse += hFall * uHoverStrength * 0.5;
    }

    // Strictly radial displacement along normalize(pos)
    vec3 radialDir = origR > 0.0001 ? normalize(pos) : vec3(0.0, 1.0, 0.0);
    pos += radialDir * totalDisp * uDisplacementStrength;
  }

  // Uniform scale
  pos *= uScale;

  // ─── 4. Eye Space & Depth Fade ──────────────────────────────────────────────
  vec4 eyePos = modelViewMatrix * vec4(pos, 1.0);
  vec4 centerEye = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  // Depth fade: far side of sphere at 40% brightness, near side at 100%
  float depthFade = 1.0;
  if (uStage >= 4.0 && origR > 0.0001) {
    float normZ = clamp((eyePos.z - centerEye.z) / origR, -1.0, 1.0);
    depthFade = mix(0.40, 1.00, normZ * 0.5 + 0.5);
  }

  // ─── 5. Color Calculation ───────────────────────────────────────────────────
  if (uStage <= 3.0) {
    // Stage 3 baseline: simple gold color * aIntensity
    vColor = vec3(1.0, 0.70, 0.15) * aIntensity;
    vAlpha = 1.0;
  } else {
    // Stage 4+ polish: full power-law gradient + depth fade + trail alpha
    float normI = clamp((aIntensity - 0.25) / 0.85, 0.0, 1.0);
    vec3 gradientCol = getGradientColor(normI);

    vColor = gradientCol * aIntensity * depthFade;

    // Pulse brightness boost
    vColor += vec3(1.0, 0.96, 0.82) * totalPulse * 0.6;

    // Trail alpha: head=1.0, tail=0.15 floor
    float trailAlpha = mix(0.15, 1.0, aTrail);
    trailAlpha *= clamp(aIntensity * 0.9, 0.2, 1.0);
    vAlpha = clamp(trailAlpha + totalPulse * 0.35, 0.15, 1.0);
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

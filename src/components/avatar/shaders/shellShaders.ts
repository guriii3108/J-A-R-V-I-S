import * as THREE from 'three';

/**
 * Shell vertex and fragment shaders with displacement and glow effects
 */

export interface ShellUniforms {
  uTime: { value: number };
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
  uStateTransition: { value: number }; // 0-1 for state transitions
  uScale: { value: number };
}

export const shellVertexShader = `
uniform float uTime;
uniform float uDisplacementStrength;
uniform vec3 uPulseOrigins[4];
uniform float uPulseTimes[4];
uniform vec3 uHoverPoint;
uniform float uHoverStrength;
uniform float uScale;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vDisplacement;
varying float vPulseIntensity;

// Simplex noise for organic motion
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) { 
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i); 
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0)) 
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Ease out expo
float easeOutExpo(float t) {
  return t == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
}

void main() {
  vPosition = position;
  vNormal = normal;
  
  vec3 pos = position;
  float totalDisplacement = 0.0;
  float totalPulse = 0.0;
  
  // Noise-based breathing
  float noise = snoise(position * 0.5 + uTime * 0.3) * 0.5 + 0.5;
  totalDisplacement += noise * 0.02;
  
  // Process pulses (shockwave rings)
  for (int i = 0; i < 4; i++) {
    if (uPulseTimes[i] > 0.0) {
      float pulseAge = uTime - uPulseTimes[i];
      if (pulseAge < 1.2 && pulseAge > 0.0) {
        vec3 toPoint = position - uPulseOrigins[i];
        float dist = length(toPoint);
        
        // Ring travels outward
        float ringPos = pulseAge * 3.0;
        float ringDist = abs(dist - ringPos);
        float ringFalloff = 1.0 - smoothstep(0.0, 0.4, ringDist);
        
        float pulseStrength = easeOutExpo(1.0 - pulseAge / 1.2) * ringFalloff;
        totalDisplacement += pulseStrength * 0.15;
        totalPulse += pulseStrength;
      }
    }
  }
  
  // Hover interaction
  if (uHoverStrength > 0.01) {
    vec3 toHover = position - uHoverPoint;
    float hoverDist = length(toHover);
    float hoverFalloff = 1.0 - smoothstep(0.0, 0.4, hoverDist);
    totalDisplacement += hoverFalloff * uHoverStrength * 0.08;
    totalPulse += hoverFalloff * uHoverStrength;
  }
  
  vDisplacement = totalDisplacement;
  vPulseIntensity = totalPulse;
  
  // Apply displacement along normal
  pos += normal * totalDisplacement * uDisplacementStrength;
  
  // Apply scale
  pos *= uScale;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const shellFragmentShader = `
uniform vec3 uColorPrimary;
uniform vec3 uColorSecondary;
uniform vec3 uColorHot;
uniform float uOpacityBase;
uniform float uGlowIntensity;
uniform float uTime;

varying vec3 vPosition;
varying vec3 vNormal;
varying float vDisplacement;
varying float vPulseIntensity;

void main() {
  // Base color mix
  float mixFactor = sin(uTime * 0.5 + vPosition.y * 2.0) * 0.5 + 0.5;
  vec3 baseColor = mix(uColorPrimary, uColorSecondary, mixFactor);
  
  // Hot spots at displacement
  float hotness = smoothstep(0.0, 0.1, vDisplacement);
  vec3 color = mix(baseColor, uColorHot, hotness * 0.6);
  
  // Pulse brightness
  color += uColorHot * vPulseIntensity * 0.8;
  
  // Edge glow (Fresnel-like)
  vec3 viewDirection = normalize(cameraPosition - vPosition);
  float fresnel = 1.0 - abs(dot(viewDirection, vNormal));
  fresnel = pow(fresnel, 2.0);
  
  color += baseColor * fresnel * uGlowIntensity * 0.5;
  
  // Opacity pulsing
  float opacity = uOpacityBase;
  opacity += sin(uTime * 2.0 + vPosition.x * 5.0 + vPosition.z * 5.0) * 0.15;
  opacity = clamp(opacity, 0.6, 1.0);
  
  // Boost opacity during pulses
  opacity += vPulseIntensity * 0.3;
  opacity = clamp(opacity, 0.0, 1.0);
  
  gl_FragColor = vec4(color * uGlowIntensity, opacity);
}
`;

import { useRef, useMemo, useEffect, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { generateShellGeometry } from '../../lib/fragments';
import { shellVertexShader, shellFragmentShader } from './shaders/shellShaders';
import { useAvatarStore } from '../../lib/useAvatar';

interface ShellProps {
  radius: number;
  shellIndex: number;
  totalShells: number;
  seed: number;
  stage?: number;
  colorPrimary: string;
  colorSecondary: string;
  colorHot: string;
  speed: number;
  rotationAxis: THREE.Vector3;
  displacementStrength?: number;
}

export const Shell = forwardRef<THREE.LineSegments, ShellProps>((
  {
    radius,
    shellIndex,
    totalShells,
    seed,
    stage = 5,
    colorPrimary,
    colorSecondary,
    colorHot,
    speed,
    rotationAxis,
    displacementStrength = 1.0,
  },
  forwardedRef,
) => {
  const meshRef      = useRef<THREE.LineSegments>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') forwardedRef(meshRef.current);
    else forwardedRef.current = meshRef.current;
  }, [forwardedRef]);

  const state     = useAvatarStore((s) => s.state);
  const amplitude = useAvatarStore((s) => s.amplitude);
  const pulses    = useAvatarStore((s) => s.pulses);

  const rotationSpeed  = useRef(speed);
  const currentScale   = useRef(1.0);
  const hoverPoint     = useRef(new THREE.Vector3());
  const hoverStrength  = useRef(0);
  // Heartbeat state: 0..1 envelope, fires every ~1.6s
  const heartbeatVal   = useRef(0.0);
  const lastBeatTime   = useRef(0.0);
  // Liveness: target multiplier driven by state
  const livenessTarget = useRef(1.0);
  const livenessVal    = useRef(1.0);

  const geometry = useMemo(() => {
    return generateShellGeometry(radius, shellIndex, totalShells, seed, stage);
  }, [radius, shellIndex, totalShells, seed, stage]);

  const uniforms = useMemo(() => ({
    uTime:                 { value: 0 },
    uStage:                { value: stage },
    uColorPrimary:         { value: new THREE.Color(colorPrimary) },
    uColorSecondary:       { value: new THREE.Color(colorSecondary) },
    uColorHot:             { value: new THREE.Color(colorHot) },
    uOpacityBase:          { value: 1.0 },
    uDisplacementStrength: { value: displacementStrength },
    uGlowIntensity:        { value: 1.0 },
    uPulseOrigins:         { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uPulseTimes:           { value: [0, 0, 0, 0] },
    uHoverPoint:           { value: new THREE.Vector3() },
    uHoverStrength:        { value: 0 },
    uStateTransition:      { value: 0 },
    uScale:                { value: 1.0 },
    uHeartbeat:            { value: 0.0 },
    uLiveness:             { value: 1.0 },
    uShellIndex:           { value: shellIndex },
  }), [colorPrimary, colorSecondary, colorHot, displacementStrength, stage, shellIndex]);

  // Sync pulses → uniforms
  useEffect(() => {
    pulses.forEach((pulse, i) => {
      if (i < 4) {
        if (pulse.origin) uniforms.uPulseOrigins.value[i].copy(pulse.origin);
        uniforms.uPulseTimes.value[i] = pulse.startTime / 1000;
      }
    });
  }, [pulses, uniforms]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const t = performance.now() / 1000;
    uniforms.uTime.value  = t;
    uniforms.uStage.value = stage;

    // ── Autonomous Heartbeat ───────────────────────────────────────────────────
    // Beat period varies 1.4s (speaking) to 2.2s (idle).
    // Each shell beats slightly offset (peristaltic wave through the sphere).
    const beatPeriod = state === 'speaking' ? 1.0 + amplitude * 0.4
                     : state === 'thinking' ? 1.2
                     : 1.8;
    const shellOffset = shellIndex * 0.14; // propagation delay inner→outer
    const beatPhase   = (t - shellOffset) % beatPeriod;
    if (beatPhase < 0.08 && t - lastBeatTime.current > beatPeriod * 0.6) {
      // Trigger beat: envelope peaks immediately then decays
      heartbeatVal.current  = 1.0;
      lastBeatTime.current  = t;
    }
    // Exponential decay: 0.08s attack, ~0.6s release
    heartbeatVal.current = Math.max(0, heartbeatVal.current - delta * 1.65);
    uniforms.uHeartbeat.value = THREE.MathUtils.lerp(
      uniforms.uHeartbeat.value,
      heartbeatVal.current,
      delta * 10,
    );

    // ── Liveness multiplier per state ─────────────────────────────────────────
    switch (state) {
      case 'idle':      livenessTarget.current = 1.0; break;
      case 'listening': livenessTarget.current = 0.7 + amplitude * 0.4; break;
      case 'thinking':  livenessTarget.current = 1.8; break;        // faster rings
      case 'speaking':  livenessTarget.current = 1.2 + amplitude * 0.8; break;
    }
    livenessVal.current = THREE.MathUtils.lerp(livenessVal.current, livenessTarget.current, delta * 2);
    uniforms.uLiveness.value = livenessVal.current;

    // ── Scale: multi-frequency breathing (enlarge & shrink rhythmically) ───
    const phase0 = shellIndex * 0.45;
    const b1 = Math.sin(t * 1.0 + phase0) * 0.045;         // primary swell (±4.5%)
    const b2 = Math.sin(t * 2.2 + phase0 * 1.6) * 0.018;   // secondary breath ripple
    const breathe = 1.0 + b1 + b2;

    // State-driven scale modulation
    let stateScale    = 1.0;
    let stateRotMult  = 1.0;
    let glowIntensity = 1.0;

    switch (state) {
      case 'listening':
        stateScale    = 0.94 + amplitude * 0.06;
        stateRotMult  = 0.75;
        glowIntensity = 1.25;
        break;
      case 'thinking': {
        const tf  = shellIndex / (totalShells - 1);
        stateRotMult  = tf < 0.5 ? 2.5 : 0.6;
        stateScale    = 1.0 + tf * 0.07;
        glowIntensity = 1.15;
        break;
      }
      case 'speaking':
        stateScale    = 1.0 + amplitude * 0.16 * (1 - shellIndex / totalShells);
        glowIntensity = 1.1 + amplitude * 0.4;
        stateRotMult  = 1.0 + amplitude * 0.8;
        break;
    }

    // Add heartbeat "pop": sphere expands outward on each beat
    const hbPop = heartbeatVal.current * 0.05 * (1 - shellIndex / (totalShells * 1.4));
    const targetScale = breathe * stateScale + hbPop;

    rotationSpeed.current = THREE.MathUtils.lerp(
      rotationSpeed.current,
      speed * stateRotMult,
      delta * 2,
    );
    currentScale.current = THREE.MathUtils.lerp(currentScale.current, targetScale, delta * 4);
    uniforms.uScale.value = currentScale.current;

    uniforms.uGlowIntensity.value = THREE.MathUtils.lerp(
      uniforms.uGlowIntensity.value,
      glowIntensity + heartbeatVal.current * 0.2,
      delta * 4,
    );

    // Shell counter-rotation on CPU (fast and visibly active)
    meshRef.current.rotateOnAxis(rotationAxis, rotationSpeed.current * delta);

    uniforms.uHoverPoint.value.copy(hoverPoint.current);
    uniforms.uHoverStrength.value = THREE.MathUtils.lerp(
      uniforms.uHoverStrength.value,
      hoverStrength.current,
      delta * 8,
    );

    // Direct uniform sync to ShaderMaterial
    if (shaderMatRef.current && shaderMatRef.current.uniforms) {
      shaderMatRef.current.uniforms.uTime.value = t;
      shaderMatRef.current.uniforms.uScale.value = currentScale.current;
      shaderMatRef.current.uniforms.uHeartbeat.value = uniforms.uHeartbeat.value;
      shaderMatRef.current.uniforms.uLiveness.value = uniforms.uLiveness.value;
      shaderMatRef.current.uniforms.uGlowIntensity.value = uniforms.uGlowIntensity.value;
      shaderMatRef.current.uniforms.uHoverStrength.value = uniforms.uHoverStrength.value;
    }
  });

  // Expose hover method to parent
  useEffect(() => {
    if (meshRef.current) {
      (meshRef.current as any).setHover = (
        point: THREE.Vector3 | null,
        strength: number,
      ) => {
        if (point) hoverPoint.current.copy(point);
        hoverStrength.current = strength;
      };
    }
  }, []);

  return (
    <lineSegments ref={meshRef} geometry={geometry} frustumCulled={false}>
      {stage <= 2 ? (
        <lineBasicMaterial
          color="#ffb020"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      ) : (
        <shaderMaterial
          ref={shaderMatRef}
          vertexShader={shellVertexShader}
          fragmentShader={shellFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      )}
    </lineSegments>
  );
});

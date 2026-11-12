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
  stage?: number; // 1: Static rings, 2: Ticks/Arcs basic, 3: Shader rot, 4: Polish, 5: Full
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
  const meshRef = useRef<THREE.LineSegments>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);

  // Connect forwardedRef
  useEffect(() => {
    if (!forwardedRef) return;
    if (typeof forwardedRef === 'function') forwardedRef(meshRef.current);
    else forwardedRef.current = meshRef.current;
  }, [forwardedRef]);

  const state = useAvatarStore((s) => s.state);
  const amplitude = useAvatarStore((s) => s.amplitude);
  const pulses = useAvatarStore((s) => s.pulses);

  const rotationSpeed = useRef(speed);
  const currentScale = useRef(1.0);
  const hoverPoint = useRef(new THREE.Vector3());
  const hoverStrength = useRef(0);

  // ─── STAGE 0 ASSERTION: Generate Geometry ──────────────────────────────────
  const geometry = useMemo(() => {
    return generateShellGeometry(radius, shellIndex, totalShells, seed, stage);
  }, [radius, shellIndex, totalShells, seed, stage]);

  // ─── Shader Uniforms ────────────────────────────────────────────────────────
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uStage: { value: stage },
    uColorPrimary: { value: new THREE.Color(colorPrimary) },
    uColorSecondary: { value: new THREE.Color(colorSecondary) },
    uColorHot: { value: new THREE.Color(colorHot) },
    uOpacityBase: { value: 1.0 },
    uDisplacementStrength: { value: displacementStrength },
    uGlowIntensity: { value: 1.5 },
    uPulseOrigins: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uPulseTimes: { value: [0, 0, 0, 0] },
    uHoverPoint: { value: new THREE.Vector3() },
    uHoverStrength: { value: 0 },
    uStateTransition: { value: 0 },
    uScale: { value: 1.0 },
  }), [colorPrimary, colorSecondary, colorHot, displacementStrength, stage]);

  // Sync pulses to uniforms
  useEffect(() => {
    pulses.forEach((pulse, i) => {
      if (i < 4) {
        if (pulse.origin) uniforms.uPulseOrigins.value[i].copy(pulse.origin);
        uniforms.uPulseTimes.value[i] = pulse.startTime / 1000;
      }
    });
  }, [pulses, uniforms]);

  // ─── Per-Frame Animation ────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Stage 1 & 2: Mesh rotates on CPU because it uses LineBasicMaterial
    if (stage <= 2) {
      meshRef.current.rotateOnAxis(rotationAxis, rotationSpeed.current * delta);
    } else {
      // Stage 3+: Very slow drift rotation on CPU, main rotation is in vertex shader
      meshRef.current.rotateOnAxis(rotationAxis, rotationSpeed.current * 0.1 * delta);
    }

    // Always update uTime in uniforms every frame
    const currentTime = performance.now() / 1000;
    uniforms.uTime.value = currentTime;
    uniforms.uStage.value = stage;

    // Breathing scale
    const breathPhase = shellIndex / totalShells;
    const breathe = Math.sin(currentTime * 0.5 + breathPhase * Math.PI) * 0.015 + 1.0;

    let stateScale = 1.0;
    let stateRotMult = 1.0;
    let glowIntensity = 1.5;

    switch (state) {
      case 'listening':
        stateScale = 0.96 + amplitude * 0.02;
        stateRotMult = 0.6;
        glowIntensity = 1.8;
        break;

      case 'thinking': {
        const tf = 1 - shellIndex / totalShells;
        stateRotMult = tf > 0.5 ? 2.5 : 0.4;
        stateScale = 1.0 + (1 - tf) * 0.05;
        glowIntensity = 1.6;
        break;
      }

      case 'speaking':
        stateScale = 1.0 + amplitude * 0.08;
        glowIntensity = 1.5 + amplitude * 0.6;
        break;
    }

    rotationSpeed.current = THREE.MathUtils.lerp(
      rotationSpeed.current,
      speed * stateRotMult,
      delta * 2,
    );

    currentScale.current = THREE.MathUtils.lerp(
      currentScale.current,
      breathe * stateScale,
      delta * 3,
    );
    uniforms.uScale.value = currentScale.current;

    uniforms.uGlowIntensity.value = THREE.MathUtils.lerp(
      uniforms.uGlowIntensity.value,
      glowIntensity,
      delta * 3,
    );

    uniforms.uHoverPoint.value.copy(hoverPoint.current);
    uniforms.uHoverStrength.value = THREE.MathUtils.lerp(
      uniforms.uHoverStrength.value,
      hoverStrength.current,
      delta * 8,
    );
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
    // HARD RULE: frustumCulled = false on every shell LineSegments
    <lineSegments
      ref={meshRef}
      geometry={geometry}
      frustumCulled={false}
    >
      {stage <= 2 ? (
        // STAGE 1 & 2: LineBasicMaterial (#ffb020, transparent, AdditiveBlending, depthWrite: false)
        <lineBasicMaterial
          color="#ffb020"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      ) : (
        // STAGE 3, 4, 5: ShaderMaterial with additive blending
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

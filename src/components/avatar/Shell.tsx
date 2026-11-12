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
  colorPrimary: string;
  colorSecondary: string;
  colorHot: string;
  speed: number;
  rotationAxis: THREE.Vector3;
  displacementStrength?: number;
}

export const Shell = forwardRef<THREE.LineSegments, ShellProps>(({
  radius,
  shellIndex,
  totalShells,
  seed,
  colorPrimary,
  colorSecondary,
  colorHot,
  speed,
  rotationAxis,
  displacementStrength = 1.0,
}, forwardedRef) => {
  const meshRef = useRef<THREE.LineSegments>(null);
  
  // Merge internal ref with forwarded ref
  useEffect(() => {
    if (forwardedRef) {
      if (typeof forwardedRef === 'function') {
        forwardedRef(meshRef.current);
      } else {
        forwardedRef.current = meshRef.current;
      }
    }
  }, [forwardedRef]);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  const state = useAvatarStore((s) => s.state);
  const amplitude = useAvatarStore((s) => s.amplitude);
  const pulses = useAvatarStore((s) => s.pulses);
  
  const rotationSpeed = useRef(speed);
  const targetScale = useRef(1.0);
  const currentScale = useRef(1.0);
  const hoverPoint = useRef(new THREE.Vector3(0, 0, 0));
  const hoverStrength = useRef(0);
  
  const geometry = useMemo(() => {
    return generateShellGeometry(radius, shellIndex, totalShells, seed);
  }, [radius, shellIndex, totalShells, seed]);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorPrimary: { value: new THREE.Color(colorPrimary) },
    uColorSecondary: { value: new THREE.Color(colorSecondary) },
    uColorHot: { value: new THREE.Color(colorHot) },
    uOpacityBase: { value: 0.8 },
    uDisplacementStrength: { value: displacementStrength },
    uGlowIntensity: { value: 1.0 },
    uPulseOrigins: { value: [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]},
    uPulseTimes: { value: [0, 0, 0, 0] },
    uHoverPoint: { value: new THREE.Vector3() },
    uHoverStrength: { value: 0 },
    uStateTransition: { value: 0 },
    uScale: { value: 1.0 },
  }), [colorPrimary, colorSecondary, colorHot, displacementStrength]);
  
  // Update pulses
  useEffect(() => {
    if (!materialRef.current) return;
    
    pulses.forEach((pulse, i) => {
      if (i < 4) {
        if (pulse.origin) {
          uniforms.uPulseOrigins.value[i].copy(pulse.origin);
        }
        uniforms.uPulseTimes.value[i] = pulse.startTime / 1000;
      }
    });
  }, [pulses, uniforms]);
  
  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;
    
    const time = performance.now() / 1000;
    uniforms.uTime.value = time;
    
    // Rotation
    meshRef.current.rotateOnAxis(rotationAxis, rotationSpeed.current * delta);
    
    // Breathing scale
    const breathPhase = shellIndex / totalShells;
    const breathe = Math.sin(time * 0.5 + breathPhase * Math.PI) * 0.015 + 1.0;
    
    // State-based behavior
    let stateScale = 1.0;
    let stateRotationMult = 1.0;
    let glowIntensity = 1.0;
    
    switch (state) {
      case 'listening':
        stateScale = 0.96;
        stateRotationMult = 0.6;
        glowIntensity = 1.3;
        // Subtle amplitude pulse
        stateScale += amplitude * 0.02;
        break;
        
      case 'thinking':
        // Inner shells fast, outer slow
        const thinkingFactor = 1 - (shellIndex / totalShells);
        stateRotationMult = thinkingFactor > 0.5 ? 2.5 : 0.4;
        stateScale = 1.0 + (1 - thinkingFactor) * 0.05;
        glowIntensity = 1.2;
        // Color shift
        const yellowShift = new THREE.Color(colorSecondary);
        uniforms.uColorSecondary.value.lerp(yellowShift, delta * 2);
        break;
        
      case 'speaking':
        stateScale = 1.0 + amplitude * 0.08;
        glowIntensity = 1.0 + amplitude * 0.5;
        break;
    }
    
    // Smooth rotation speed transition
    const targetRotSpeed = speed * stateRotationMult;
    rotationSpeed.current = THREE.MathUtils.lerp(rotationSpeed.current, targetRotSpeed, delta * 2);
    
    // Smooth scale transition
    targetScale.current = breathe * stateScale;
    currentScale.current = THREE.MathUtils.lerp(currentScale.current, targetScale.current, delta * 3);
    uniforms.uScale.value = currentScale.current;
    
    // Glow intensity
    uniforms.uGlowIntensity.value = THREE.MathUtils.lerp(
      uniforms.uGlowIntensity.value,
      glowIntensity,
      delta * 3
    );
    
    // Hover interaction
    uniforms.uHoverPoint.value.copy(hoverPoint.current);
    uniforms.uHoverStrength.value = THREE.MathUtils.lerp(
      uniforms.uHoverStrength.value,
      hoverStrength.current,
      delta * 8
    );
  });
  
  // Expose methods for parent interactions
  useEffect(() => {
    if (meshRef.current) {
      (meshRef.current as any).setHover = (point: THREE.Vector3 | null, strength: number) => {
        if (point) {
          hoverPoint.current.copy(point);
          hoverStrength.current = strength;
        } else {
          hoverStrength.current = 0;
        }
      };
    }
  }, []);
  
  return (
    <lineSegments ref={meshRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={shellVertexShader}
        fragmentShader={shellFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
});

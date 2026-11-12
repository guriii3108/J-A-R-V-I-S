import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { generateCorePoints } from '../../lib/fragments';
import { useAvatarStore } from '../../lib/useAvatar';

interface CoreProps {
  seed: number;
  colorPrimary: string;
  colorHot: string;
  particleCount?: number;
}

export const Core: React.FC<CoreProps> = ({
  seed,
  colorPrimary,
  colorHot,
  particleCount = 500,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  
  const state = useAvatarStore((s) => s.state);
  const amplitude = useAvatarStore((s) => s.amplitude);
  
  const geometry = useMemo(() => {
    return generateCorePoints(0.3, particleCount, seed);
  }, [seed, particleCount]);
  
  const color = useMemo(() => new THREE.Color(colorPrimary), [colorPrimary]);
  const hotColor = useMemo(() => new THREE.Color(colorHot), [colorHot]);
  
  useFrame((_, delta) => {
    if (!pointsRef.current || !materialRef.current) return;
    
    const time = performance.now() / 1000;
    
    // Rotation
    pointsRef.current.rotation.y += delta * 0.1;
    pointsRef.current.rotation.x = Math.sin(time * 0.3) * 0.1;
    
    // State-based behavior
    let targetSize = 0.005;
    let targetOpacity = 0.30;
    let colorMix = 0;
    
    switch (state) {
      case 'listening':
        targetSize = 0.010;
        targetOpacity = 0.65;
        colorMix = 0.3;
        // Pulse with amplitude
        const listenPulse = Math.sin(time * 8 + amplitude * 10) * 0.002;
        targetSize += listenPulse;
        break;
        
      case 'thinking':
        targetSize = 0.007;
        targetOpacity = 0.60;
        colorMix = 0.6;
        // Faster rotation
        pointsRef.current.rotation.y += delta * 0.3;
        break;
        
      case 'speaking':
        targetSize = 0.008 + amplitude * 0.005;
        targetOpacity = 0.45 + amplitude * 0.2;
        colorMix = amplitude * 0.5;
        break;
    }
    
    // Smooth transitions
    const currentSize = materialRef.current.size;
    materialRef.current.size = THREE.MathUtils.lerp(currentSize, targetSize, delta * 3);
    
    const currentOpacity = materialRef.current.opacity;
    materialRef.current.opacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, delta * 3);
    
    // Color mixing
    const currentColor = materialRef.current.color;
    const targetColor = new THREE.Color().lerpColors(color, hotColor, colorMix);
    currentColor.lerp(targetColor, delta * 3);
  });
  
  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        color={color}
        size={0.008}
        transparent
        opacity={0.45}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
};

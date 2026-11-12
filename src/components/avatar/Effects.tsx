import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { useAvatarStore } from '../../lib/useAvatar';

interface EffectsProps {
  bloomIntensity?: number;
  reducedMotion?: boolean;
}

export const Effects: React.FC<EffectsProps> = ({
  bloomIntensity = 1.2,
  reducedMotion = false,
}) => {
  const chromaticAberrationRef = useRef<any>(null);
  
  const state = useAvatarStore((s) => s.state);
  const amplitude = useAvatarStore((s) => s.amplitude);
  const pulses = useAvatarStore((s) => s.pulses);
  
  useFrame(() => {
    if (!chromaticAberrationRef.current || reducedMotion) return;
    
    // Base chromatic aberration
    let targetOffset = 0.0005;
    
    // Increase during pulses
    const now = performance.now();
    pulses.forEach(pulse => {
      const age = (now - pulse.startTime) / 1000;
      if (age < 1.2) {
        const intensity = Math.max(0, 1 - age / 1.2);
        targetOffset += intensity * 0.002;
      }
    });
    
    // Increase during speaking
    if (state === 'speaking') {
      targetOffset += amplitude * 0.001;
    }
    
    // Smooth transition
    const currentOffset = chromaticAberrationRef.current.offset;
    const newX = THREE.MathUtils.lerp(currentOffset.x, targetOffset, 0.1);
    const newY = THREE.MathUtils.lerp(currentOffset.y, targetOffset, 0.1);
    
    chromaticAberrationRef.current.offset.set(newX, newY);
  });
  
  // Adjust bloom based on state
  let effectiveBloomIntensity = bloomIntensity;
  
  if (state === 'listening') {
    effectiveBloomIntensity = bloomIntensity * 1.15;
  } else if (state === 'speaking') {
    effectiveBloomIntensity = bloomIntensity * (1 + amplitude * 0.4);
  } else if (state === 'thinking') {
    effectiveBloomIntensity = bloomIntensity * 1.3;
  }
  
  return (
    <EffectComposer>
      <Bloom
        intensity={effectiveBloomIntensity}
        luminanceThreshold={0.48}
        luminanceSmoothing={0.50}
        mipmapBlur
      />
      <Vignette
        offset={0.3}
        darkness={0.5}
        blendFunction={BlendFunction.NORMAL}
      />
      {!reducedMotion && (
        <ChromaticAberration
          ref={chromaticAberrationRef}
          offset={new THREE.Vector2(0.0005, 0.0005)}
          blendFunction={BlendFunction.NORMAL}
        />
      )}
    </EffectComposer>
  );
};

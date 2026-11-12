import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SeededRandom } from '../../lib/seededRandom';
import { useAvatarStore } from '../../lib/useAvatar';

interface SparkData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface SparksProps {
  count: number;
  seed: number;
  colorPrimary: string;
  colorHot: string;
  shellRadii: number[];
}

export const Sparks: React.FC<SparksProps> = ({
  count,
  seed,
  colorPrimary,
  colorHot,
  shellRadii,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  
  const state = useAvatarStore((s) => s.state);
  const pulses = useAvatarStore((s) => s.pulses);
  
  const sparks = useRef<SparkData[]>([]);
  const lastPulseCount = useRef(0);
  
  const rng = useMemo(() => new SeededRandom(seed), [seed]);
  
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    return geo;
  }, [count]);
  
  // Initialize sparks
  useMemo(() => {
    sparks.current = [];
    const color1 = new THREE.Color(colorPrimary);
    const color2 = new THREE.Color(colorHot);
    
    for (let i = 0; i < count; i++) {
      sparks.current.push(createSpark(rng, shellRadii, color1, color2));
    }
  }, [count, seed, shellRadii, colorPrimary, colorHot, rng]);
  
  // Handle pulse bursts
  useFrame(() => {
    if (pulses.length > lastPulseCount.current) {
      // New pulse - create burst
      const latestPulse = pulses[pulses.length - 1];
      const burstCount = Math.min(50, count);
      
      for (let i = 0; i < burstCount; i++) {
        const spark = sparks.current[i % count];
        if (latestPulse.origin) {
          spark.position.copy(latestPulse.origin);
        } else {
          spark.position.set(0, 0, 0);
        }
        
        // Random burst direction
        const theta = rng.range(0, Math.PI * 2);
        const phi = rng.range(0, Math.PI);
        const speed = rng.range(0.3, 0.8);
        
        spark.velocity.set(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.cos(phi) * speed,
          Math.sin(phi) * Math.sin(theta) * speed
        );
        
        spark.life = spark.maxLife;
      }
    }
    lastPulseCount.current = pulses.length;
  });
  
  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    
    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const sizes = geometry.attributes.size.array as Float32Array;
    
    const color1 = new THREE.Color(colorPrimary);
    const color2 = new THREE.Color(colorHot);
    
    let activeCount = 0;
    
    sparks.current.forEach((spark, i) => {
      // Update life
      spark.life -= delta;
      
      if (spark.life <= 0) {
        // Respawn
        Object.assign(spark, createSpark(rng, shellRadii, color1, color2));
      }
      
      // Update position
      spark.position.add(spark.velocity.clone().multiplyScalar(delta));
      
      // Apply drag
      spark.velocity.multiplyScalar(0.98);
      
      // State-based behavior
      if (state === 'thinking') {
        // Orbit around core
        const toCenter = spark.position.clone().normalize();
        const tangent = new THREE.Vector3(-toCenter.z, 0, toCenter.x).normalize();
        spark.velocity.add(tangent.multiplyScalar(delta * 0.5));
      }
      
      const lifeRatio = spark.life / spark.maxLife;
      
      // Update geometry
      positions[i * 3] = spark.position.x;
      positions[i * 3 + 1] = spark.position.y;
      positions[i * 3 + 2] = spark.position.z;
      
      // Color fade
      const color = color1.clone().lerp(color2, 1 - lifeRatio);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      
      // Size fade
      sizes[i] = spark.size * lifeRatio;
      
      activeCount++;
    });
    
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    
    // Adjust material opacity based on state
    if (materialRef.current) {
      const targetOpacity = state === 'thinking' ? 0.9 : 0.7;
      materialRef.current.opacity = THREE.MathUtils.lerp(
        materialRef.current.opacity,
        targetOpacity,
        delta * 2
      );
    }
  });
  
  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        vertexColors
        size={0.015}
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
};

function createSpark(
  rng: SeededRandom,
  shellRadii: number[],
  _color1: THREE.Color,
  _color2: THREE.Color
): SparkData {
  // Spawn on a random shell edge
  const shellRadius = shellRadii[rng.int(0, shellRadii.length - 1)];
  
  const theta = rng.range(0, Math.PI * 2);
  const phi = rng.range(0, Math.PI);
  
  const position = new THREE.Vector3(
    shellRadius * Math.sin(phi) * Math.cos(theta),
    shellRadius * Math.cos(phi),
    shellRadius * Math.sin(phi) * Math.sin(theta)
  );
  
  // Drift outward slowly
  const velocity = position.clone().normalize().multiplyScalar(rng.range(0.05, 0.15));
  
  // Add some random tangential motion
  const tangent = new THREE.Vector3(
    rng.range(-1, 1),
    rng.range(-1, 1),
    rng.range(-1, 1)
  ).normalize().multiplyScalar(rng.range(0.02, 0.05));
  
  velocity.add(tangent);
  
  return {
    position,
    velocity,
    life: rng.range(2, 4),
    maxLife: rng.range(2, 4),
    size: rng.range(0.01, 0.02),
  };
}

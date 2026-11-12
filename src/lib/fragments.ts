import * as THREE from 'three';
import { SeededRandom } from './seededRandom';

/**
 * Fragment types that can be generated
 */
export type FragmentType = 'arc' | 'ring' | 'panel';

/**
 * Configuration for generating shell fragments
 */
export interface ShellFragmentConfig {
  radius: number;
  fragmentType: FragmentType;
  segmentCount: number;
  gapProbability: number; // 0-1, how likely gaps appear
  seed: number;
}

/**
 * Generate fragmented arc segments (latitude/longitude lines with gaps)
 */
export const generateArcFragments = (
  config: ShellFragmentConfig
): THREE.BufferGeometry => {
  const { radius, segmentCount, gapProbability, seed } = config;
  const rng = new SeededRandom(seed);
  
  const positions: number[] = [];
  const segments = 32;

  // Generate latitude rings
  for (let lat = 0; lat < segmentCount; lat++) {
    const phi = (lat / segmentCount) * Math.PI;
    const inSegment = rng.next() > gapProbability;
    
    if (inSegment) {
      const startLon = rng.range(0, Math.PI * 2);
      const arcLength = rng.range(Math.PI * 0.3, Math.PI * 1.5);
      
      for (let i = 0; i < segments; i++) {
        const theta = startLon + (i / segments) * arcLength;
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.cos(phi);
        const z = radius * Math.sin(phi) * Math.sin(theta);
        
        positions.push(x, y, z);
        
        if (i < segments - 1) {
          const theta2 = startLon + ((i + 1) / segments) * arcLength;
          const x2 = radius * Math.sin(phi) * Math.cos(theta2);
          const y2 = radius * Math.cos(phi);
          const z2 = radius * Math.sin(phi) * Math.sin(theta2);
          positions.push(x2, y2, z2);
        }
      }
    }
  }

  // Generate longitude lines
  for (let lon = 0; lon < segmentCount; lon++) {
    const theta = (lon / segmentCount) * Math.PI * 2;
    const inSegment = rng.next() > gapProbability;
    
    if (inSegment) {
      const startPhi = rng.range(0, Math.PI);
      const arcLength = rng.range(Math.PI * 0.3, Math.PI * 0.8);
      
      for (let i = 0; i < segments; i++) {
        const phi = startPhi + (i / segments) * arcLength;
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.cos(phi);
        const z = radius * Math.sin(phi) * Math.sin(theta);
        
        positions.push(x, y, z);
        
        if (i < segments - 1) {
          const phi2 = startPhi + ((i + 1) / segments) * arcLength;
          const x2 = radius * Math.sin(phi2) * Math.cos(theta);
          const y2 = radius * Math.cos(phi2);
          const z2 = radius * Math.sin(phi2) * Math.sin(theta);
          positions.push(x2, y2, z2);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  return geometry;
};

/**
 * Generate fragmented ring segments
 */
export const generateRingFragments = (
  config: ShellFragmentConfig
): THREE.BufferGeometry => {
  const { radius, segmentCount, gapProbability, seed } = config;
  const rng = new SeededRandom(seed);
  
  const positions: number[] = [];
  const segmentsPerRing = 64;

  for (let ring = 0; ring < segmentCount; ring++) {
    const phi = (ring / segmentCount) * Math.PI;
    const ringRadius = radius * Math.sin(phi);
    const y = radius * Math.cos(phi);
    
    // Determine continuous arc segments
    let i = 0;
    while (i < segmentsPerRing) {
      if (rng.next() > gapProbability) {
        const arcStart = i;
        const arcLength = rng.int(8, 32);
        const arcEnd = Math.min(arcStart + arcLength, segmentsPerRing);
        
        for (let j = arcStart; j < arcEnd - 1; j++) {
          const theta1 = (j / segmentsPerRing) * Math.PI * 2;
          const theta2 = ((j + 1) / segmentsPerRing) * Math.PI * 2;
          
          const x1 = ringRadius * Math.cos(theta1);
          const z1 = ringRadius * Math.sin(theta1);
          const x2 = ringRadius * Math.cos(theta2);
          const z2 = ringRadius * Math.sin(theta2);
          
          positions.push(x1, y, z1);
          positions.push(x2, y, z2);
        }
        
        i = arcEnd + rng.int(2, 8); // Gap
      } else {
        i++;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  return geometry;
};

/**
 * Generate fragmented panel shards (edge-only)
 */
export const generatePanelFragments = (
  config: ShellFragmentConfig
): THREE.BufferGeometry => {
  const { radius, segmentCount, seed } = config;
  const rng = new SeededRandom(seed);
  
  const positions: number[] = [];

  for (let i = 0; i < segmentCount; i++) {
    // Random panel corners on the sphere
    const corners: THREE.Vector3[] = [];
    const baseTheta = rng.range(0, Math.PI * 2);
    const basePhi = rng.range(0, Math.PI);
    const size = rng.range(0.1, 0.3);
    
    for (let j = 0; j < 4; j++) {
      const offsetTheta = baseTheta + (j < 2 ? 0 : size);
      const offsetPhi = basePhi + (j % 2 === 0 ? 0 : size);
      
      const x = radius * Math.sin(offsetPhi) * Math.cos(offsetTheta);
      const y = radius * Math.cos(offsetPhi);
      const z = radius * Math.sin(offsetPhi) * Math.sin(offsetTheta);
      
      corners.push(new THREE.Vector3(x, y, z));
    }
    
    // Draw edges only
    for (let j = 0; j < 4; j++) {
      const start = corners[j];
      const end = corners[(j + 1) % 4];
      
      positions.push(start.x, start.y, start.z);
      positions.push(end.x, end.y, end.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  return geometry;
};

/**
 * Generate a complete shell with mixed fragment types
 */
export const generateShellGeometry = (
  radius: number,
  shellIndex: number,
  totalShells: number,
  seed: number
): THREE.BufferGeometry => {
  const rng = new SeededRandom(seed + shellIndex);
  
  // Inner shells are denser, outer shells more fragmented
  const densityFactor = 1 - (shellIndex / totalShells);
  const gapProbability = 0.3 + (1 - densityFactor) * 0.4;
  
  // Mix different fragment types
  const fragmentType: FragmentType = 
    shellIndex < 2 ? 'ring' : 
    shellIndex < 4 ? 'arc' : 
    'panel';
  
  const segmentCount = Math.floor(8 + densityFactor * 12);
  
  const config: ShellFragmentConfig = {
    radius,
    fragmentType,
    segmentCount,
    gapProbability,
    seed: seed + shellIndex * 1000,
  };
  
  switch (fragmentType) {
    case 'arc':
      return generateArcFragments(config);
    case 'ring':
      return generateRingFragments(config);
    case 'panel':
      return generatePanelFragments(config);
  }
};

/**
 * Generate point cloud for the dense core
 */
export const generateCorePoints = (
  radius: number,
  count: number,
  seed: number
): THREE.BufferGeometry => {
  const rng = new SeededRandom(seed);
  const positions: number[] = [];
  
  for (let i = 0; i < count; i++) {
    // Use spherical coordinates for even distribution
    const theta = rng.range(0, Math.PI * 2);
    const phi = Math.acos(2 * rng.next() - 1);
    const r = radius * Math.pow(rng.next(), 1 / 3); // Cubic root for volume distribution
    
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);
    
    positions.push(x, y, z);
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  return geometry;
};

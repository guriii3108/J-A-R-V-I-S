import { useRef, useMemo, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { damp3 } from 'maath/easing';
import { Shell } from './Shell';
import { Core } from './Core';
import { Sparks } from './Sparks';
import { Effects } from './Effects';
import { useAvatar } from '../../lib/useAvatar';
import { easeOutCubic } from '../../lib/easing';
import type { AvatarState } from '../../lib/useAvatar';

interface AvatarProps {
  seed?: number;
  shellCount?: number;
  colorPrimary?: string;
  colorSecondary?: string;
  colorHot?: string;
  speed?: number;
  bloomIntensity?: number;
  particleCount?: number;
  intro?: boolean;
  interactive?: boolean;
  audioSource?: 'mic' | HTMLAudioElement | null;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  seed = 12345,
  shellCount = 6,
  colorPrimary = '#ff9d1a',
  colorSecondary = '#ffd36b',
  colorHot = '#fff3c4',
  speed = 1.0,
  bloomIntensity = 1.2,
  particleCount = 400,
  intro = true,
  interactive = true,
  audioSource = null,
  className = '',
}) => {
  const [dpr, setDpr] = useState(1.5);
  const [adaptiveParticleCount, setAdaptiveParticleCount] = useState(particleCount);
  const reducedMotion = useRef(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = mediaQuery.matches;
    
    const handler = (e: MediaQueryListEvent) => {
      reducedMotion.current = e.matches;
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  
  return (
    <div className={`w-full h-full ${className}`}>
      <Canvas
        dpr={[1, Math.min(dpr, 2)]}
        gl={{ 
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        frameloop="always"
      >
        <Suspense fallback={null}>
          <PerformanceMonitor
            onIncline={() => setDpr(2)}
            onDecline={() => {
              setDpr(1.5);
              setAdaptiveParticleCount(Math.floor(particleCount * 0.6));
            }}
          />
          
          <PerspectiveCamera makeDefault position={[0, 0, 4]} fov={50} />
          
          <color attach="background" args={['#050b14']} />
          
          <AvatarScene
            seed={seed}
            shellCount={shellCount}
            colorPrimary={colorPrimary}
            colorSecondary={colorSecondary}
            colorHot={colorHot}
            speed={speed}
            particleCount={adaptiveParticleCount}
            intro={intro}
            interactive={interactive}
            reducedMotion={reducedMotion.current}
          />
          
          <Effects bloomIntensity={bloomIntensity} reducedMotion={reducedMotion.current} />
        </Suspense>
      </Canvas>
    </div>
  );
};

interface AvatarSceneProps {
  seed: number;
  shellCount: number;
  colorPrimary: string;
  colorSecondary: string;
  colorHot: string;
  speed: number;
  particleCount: number;
  intro: boolean;
  interactive: boolean;
  reducedMotion: boolean;
}

const AvatarScene: React.FC<AvatarSceneProps> = ({
  seed,
  shellCount,
  colorPrimary,
  colorSecondary,
  colorHot,
  speed,
  particleCount,
  intro,
  interactive,
  reducedMotion,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const shellRefs = useRef<(THREE.LineSegments | null)[]>([]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useRef(new THREE.Vector2(0, 0));
  const isDragging = useRef(false);
  const dragVelocity = useRef(new THREE.Vector2(0, 0));
  const lastPointer = useRef(new THREE.Vector2(0, 0));
  const isHovering = useRef(false);
  const introProgress = useRef(intro ? 0 : 1);
  const introStartTime = useRef(performance.now());
  
  const { camera, gl, size } = useThree();
  const { pulse } = useAvatar();
  
  // Generate shell configuration
  const shells = useMemo(() => {
    const baseRadius = 0.8;
    const shellData = [];
    
    for (let i = 0; i < shellCount; i++) {
      const radius = baseRadius + i * 0.25;
      const rotationSpeed = (0.02 + i * 0.03) * speed * (i % 2 === 0 ? 1 : -1);
      const axis = new THREE.Vector3(
        Math.sin(i * 0.5),
        Math.cos(i * 0.7),
        Math.sin(i * 1.3)
      ).normalize();
      
      shellData.push({ radius, rotationSpeed, axis });
    }
    
    return shellData;
  }, [shellCount, speed, seed]);
  
  const shellRadii = useMemo(() => shells.map(s => s.radius), [shells]);
  
  // Handle pointer move
  useEffect(() => {
    if (!interactive) return;
    
    const handlePointerMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / size.width) * 2 - 1;
      pointer.current.y = -(e.clientY / size.height) * 2 + 1;
      
      if (isDragging.current) {
        const dx = pointer.current.x - lastPointer.current.x;
        const dy = pointer.current.y - lastPointer.current.y;
        dragVelocity.current.set(dx, dy);
      }
      
      lastPointer.current.copy(pointer.current);
    };
    
    const handlePointerDown = (e: PointerEvent) => {
      isDragging.current = true;
      lastPointer.current.set(
        (e.clientX / size.width) * 2 - 1,
        -(e.clientY / size.height) * 2 + 1
      );
    };
    
    const handlePointerUp = () => {
      isDragging.current = false;
    };
    
    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
    };
  }, [interactive, gl, size]);
  
  // Handle click/tap
  useEffect(() => {
    if (!interactive) return;
    
    const handleClick = () => {
      if (!groupRef.current) return;
      
      raycaster.setFromCamera(pointer.current, camera);
      
      // Find intersection point
      const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), shells[shells.length - 1].radius);
      const intersectionPoint = new THREE.Vector3();
      const ray = raycaster.ray;
      
      if (ray.intersectSphere(sphere, intersectionPoint)) {
        pulse(intersectionPoint);
      } else {
        pulse();
      }
    };
    
    gl.domElement.addEventListener('click', handleClick);
    return () => gl.domElement.removeEventListener('click', handleClick);
  }, [interactive, gl, camera, raycaster, shells, pulse]);
  
  // Handle keyboard
  useEffect(() => {
    if (!interactive) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pulse();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [interactive, pulse]);
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const speedMult = reducedMotion ? 0.2 : 1.0;
    const adjustedDelta = delta * speedMult;
    
    // Intro animation
    if (introProgress.current < 1) {
      const elapsed = (performance.now() - introStartTime.current) / 1000;
      introProgress.current = Math.min(elapsed / 2.5, 1);
      
      const eased = easeOutCubic(introProgress.current);
      groupRef.current.scale.setScalar(eased);
      groupRef.current.rotation.y = (1 - eased) * Math.PI * 2;
      
      if (introProgress.current >= 1) {
        pulse();
      }
    }
    
    if (interactive && introProgress.current >= 1) {
      // Parallax tilt
      const targetRotX = pointer.current.y * 0.2;
      const targetRotY = pointer.current.x * 0.2;
      
      damp3(
        groupRef.current.rotation as any,
        [targetRotX, targetRotY, 0],
        0.3,
        adjustedDelta
      );
      
      // Drag rotation with inertia
      if (isDragging.current) {
        groupRef.current.rotation.y += dragVelocity.current.x * 2;
        groupRef.current.rotation.x += dragVelocity.current.y * 2;
      } else {
        // Decay velocity
        dragVelocity.current.multiplyScalar(0.95);
        groupRef.current.rotation.y += dragVelocity.current.x * 2;
        groupRef.current.rotation.x += dragVelocity.current.y * 2;
      }
      
      // Hover detection and proximity interaction
      raycaster.setFromCamera(pointer.current, camera);
      
      let hovering = false;
      let closestPoint: THREE.Vector3 | null = null;
      let closestDist = Infinity;
      
      shells.forEach((shell, i) => {
        const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), shell.radius);
        const intersectionPoint = new THREE.Vector3();
        
        if (raycaster.ray.intersectSphere(sphere, intersectionPoint)) {
          hovering = true;
          const dist = intersectionPoint.distanceTo(raycaster.ray.origin);
          if (dist < closestDist) {
            closestDist = dist;
            closestPoint = intersectionPoint.clone();
          }
        }
      });
      
      isHovering.current = hovering;
      
      // Apply hover effect to shells
      shellRefs.current.forEach((shellRef) => {
        if (shellRef && (shellRef as any).setHover) {
          (shellRef as any).setHover(closestPoint, hovering ? 1 : 0);
        }
      });
      
      // Cursor style
      gl.domElement.style.cursor = hovering ? 'pointer' : 'default';
    }
  });
  
  return (
    <group ref={groupRef} tabIndex={0} aria-label="JARVIS holographic avatar">
      {/* Background elements */}
      <BackgroundPanels />
      
      {/* Core */}
      <Core
        seed={seed}
        colorPrimary={colorPrimary}
        colorHot={colorHot}
        particleCount={Math.floor(particleCount * 0.5)}
      />
      
      {/* Shells */}
      {shells.map((shell, i) => (
        <Shell
          key={i}
          ref={(ref) => (shellRefs.current[i] = ref)}
          radius={shell.radius}
          shellIndex={i}
          totalShells={shellCount}
          seed={seed}
          colorPrimary={colorPrimary}
          colorSecondary={colorSecondary}
          colorHot={colorHot}
          speed={shell.rotationSpeed}
          rotationAxis={shell.axis}
          displacementStrength={1.0}
        />
      ))}
      
      {/* Sparks */}
      <Sparks
        count={particleCount}
        seed={seed + 9999}
        colorPrimary={colorPrimary}
        colorHot={colorHot}
        shellRadii={shellRadii}
      />
    </group>
  );
};

const BackgroundPanels: React.FC = () => {
  return (
    <group>
      <mesh position={[-3, 2, -5]} rotation={[0, 0.3, 0]}>
        <planeGeometry args={[2, 3]} />
        <meshBasicMaterial color="#0a1828" transparent opacity={0.3} />
      </mesh>
      
      <mesh position={[3, -1, -6]} rotation={[0, -0.4, 0]}>
        <planeGeometry args={[1.5, 2.5]} />
        <meshBasicMaterial color="#0a2040" transparent opacity={0.25} />
      </mesh>
      
      <mesh position={[0, 0, -8]}>
        <planeGeometry args={[10, 10]} />
        <meshBasicMaterial color="#050b14" transparent opacity={0.8} />
      </mesh>
    </group>
  );
};

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

interface AvatarProps {
  seed?: number;
  shellCount?: number;
  stage?: number;
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
  shellCount = 7,
  stage = 5,
  colorPrimary = '#ff8a00',
  colorSecondary = '#ffc83d',
  colorHot = '#fff1b8',
  speed = 1.0,
  bloomIntensity = 1.2,
  particleCount = 400,
  intro = true,
  interactive = true,
  audioSource: _audioSource = null,
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
          
          {/* Large, imposing sphere filling ~85% of viewport height */}
          <PerspectiveCamera makeDefault position={[0, 0, 3.2]} fov={45} />
          
          <color attach="background" args={['#070a1c']} />
          
          <AvatarScene
            seed={seed}
            shellCount={shellCount}
            stage={stage}
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
  stage: number;
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
  stage,
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
    // 6-8 shells, radii 0.30 to 1.00
    // The outermost shell forms a clear circular silhouette
    const shellData = [];
    for (let i = 0; i < shellCount; i++) {
      const t = shellCount > 1 ? i / (shellCount - 1) : 0.5;
      const radius = 0.30 + t * 0.70; // 0.30 to 1.00

      // Active 3D counter-rotation per shell
      const rotationSpeed = (0.12 + i * 0.04) * speed * (i % 2 === 0 ? 1 : -1);
      // Spread axes across varied 3D orientations for true gyroscopic counter-rotation
      const tiltAngle = (i / (shellCount - 1)) * (Math.PI * 0.75) + 0.2;
      const yaw       = i * 2.399; // golden angle spread
      const axis = new THREE.Vector3(
        Math.sin(tiltAngle) * Math.cos(yaw),
        Math.cos(tiltAngle),
        Math.sin(tiltAngle) * Math.sin(yaw),
      ).normalize();
      shellData.push({ radius, rotationSpeed, axis });
    }
    return shellData;
  }, [shellCount, speed]);
  
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
  
  useFrame((_state, delta) => {
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
      
      shells.forEach((shell) => {
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
    <group ref={groupRef} aria-label="JARVIS holographic avatar">
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
          ref={(ref) => { shellRefs.current[i] = ref; }}
          radius={shell.radius}
          shellIndex={i}
          totalShells={shellCount}
          seed={seed}
          stage={stage}
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
      {/* Large blurred blue/purple glass panels at different depths */}
      {/* Left panel */}
      <mesh position={[-3.2, 0.5, -6]} rotation={[0, 0.25, 0]}>
        <planeGeometry args={[2.5, 5]} />
        <meshBasicMaterial color="#1a2060" transparent opacity={0.18} />
      </mesh>
      {/* Right panel */}
      <mesh position={[3.0, -0.5, -7]} rotation={[0, -0.3, 0]}>
        <planeGeometry args={[2.0, 4.5]} />
        <meshBasicMaterial color="#2a0a4a" transparent opacity={0.15} />
      </mesh>
      {/* Center far panel */}
      <mesh position={[0.5, 1.0, -9]}>
        <planeGeometry args={[3.0, 5.0]} />
        <meshBasicMaterial color="#0d1540" transparent opacity={0.20} />
      </mesh>
      {/* Accent panel upper-right */}
      <mesh position={[2.0, 2.5, -5]} rotation={[0, -0.15, 0.05]}>
        <planeGeometry args={[1.2, 3.0]} />
        <meshBasicMaterial color="#150828" transparent opacity={0.22} />
      </mesh>
      {/* Faint reflective floor line */}
      <mesh position={[0, -1.6, -4]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6, 2]} />
        <meshBasicMaterial color="#1a3060" transparent opacity={0.08} />
      </mesh>
      {/* Far background gradient fill */}
      <mesh position={[0, 0, -10]}>
        <planeGeometry args={[20, 15]} />
        <meshBasicMaterial color="#070a1c" transparent opacity={0.95} />
      </mesh>
    </group>
  );
};

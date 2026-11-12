# JARVIS Holographic Avatar

A production-quality interactive holographic "JARVIS-style" AI avatar sphere built with React, Three.js, and TypeScript.

![JARVIS Avatar](./preview.png)

## Features

### Visual Design
- **Fragmented Holographic Shells**: 6 nested shells made of partial arcs, latitude/longitude line fragments, and thin edge-only panel shards with deliberate gaps
- **Dense Bright Core**: Point cloud with 500+ particles and tight inner rings
- **Golden-Amber Aesthetic**: Colors transition from `#ff9d1a` to `#ffd36b` with hot spots at `#fff3c4`
- **Additive Blending**: All elements use additive blending for authentic holographic appearance
- **Post-Processing Effects**: Bloom, vignette, and subtle chromatic aberration

### Always-On Motion (Idle State)
- Each shell rotates independently with distinct axis and speed (0.02-0.25 rad/s)
- Adjacent shells counter-rotate
- Breathing animation: sphere scales 1.0 → 1.03 on ~4s sine wave
- Inner shells breathe out of phase with outer shells
- Fragment opacity pulses at random phases (0.6-1.0)
- 400+ spark particles drift outward, fade, and respawn

### Interactions
All interactions use shader uniforms and damped refs (no per-frame React state) for optimal performance:

1. **Pointer Move**: Group tilts toward cursor (parallax), outer shells follow more than inner shells
2. **Cursor Proximity**: Fragments near raycast hit point displace outward and brighten, then spring back
3. **Hover**: Rotation speeds increase ~1.5x, bloom lifts slightly, cursor becomes pointer
4. **Click/Tap**: Shockwave ring travels from click point across shells over ~1.2s, supports 4 overlapping pulses
5. **Drag**: Rotate group with inertia, velocity decays with damping
6. **Touch**: Full touch support via pointer events
7. **Keyboard**: Focusable with Tab, Enter/Space triggers pulse (accessible)

### Avatar States
Smooth transitions (~0.6s) between states via Zustand store:

- **Idle**: Default behavior with all motion systems active
- **Listening**: Shells contract ~4%, rotation slows, core brightens, fragments lean toward viewer, amplitude drives subtle core pulse
- **Thinking**: Inner shells spin fast, outer shells slow, gaps widen, sparks orbit core in swirl, color shifts toward `#ffd36b`
- **Speaking**: Whole sphere pulses with amplitude, shells expand/contract radially per audio level, bloom follows amplitude, pulse rings emit on loud peaks

### Audio Reactivity
- **Microphone Input**: Request user permission, handle denial gracefully
- **Web Audio API**: AnalyserNode with RMS smoothing and exponential decay
- **Simulated Amplitude**: Fallback with layered sines + noise for demo purposes
- Real-time amplitude visualization in speaking and listening states

### Intro Animation
Optional "assemble" sequence where fragments fly in from random offsets and snap into place over ~2.5s with easeOutCubic easing, staggered per shell, ending with one soft pulse.

### Performance Optimizations
- **Merged BufferGeometry** per shell for efficient rendering
- **Custom ShaderMaterial** for vertex displacement and fragment glow
- **No per-frame allocations**, vector reuse
- **60fps target** on mid-range laptops
- **Adaptive DPR** capped at 2
- **Adaptive particle count** via PerformanceMonitor
- **Seeded RNG** for deterministic structure
- **Proper cleanup** on unmount (geometries, materials, textures)
- **Prefers-reduced-motion** support: slows animations ~80%, no intro, no chromatic aberration

## Tech Stack

- **React 19** with TypeScript (strict mode, no `any`)
- **Vite** for fast development and optimized builds
- **Three.js** via `@react-three/fiber`
- **@react-three/drei** for helpers and utilities
- **@react-three/postprocessing** for bloom, vignette, chromatic aberration
- **maath** for damping and easing utilities
- **zustand** for lightweight state management
- **Tailwind CSS** for UI styling
- **React Router** for navigation

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Build

```bash
npm run build
```

## Project Structure

```
src/
├── components/avatar/
│   ├── Avatar.tsx              # Main canvas and scene root
│   ├── Shell.tsx               # Individual shell component
│   ├── Core.tsx                # Dense point cloud core
│   ├── Sparks.tsx              # Particle system
│   ├── Effects.tsx             # Post-processing effects
│   └── shaders/
│       └── shellShaders.ts     # Vertex and fragment shaders
├── lib/
│   ├── easing.ts               # Easing functions
│   ├── fragments.ts            # Geometry generators (seeded)
│   ├── seededRandom.ts         # Seeded RNG for determinism
│   ├── useAvatar.ts            # Zustand store + hook
│   └── useAudioLevel.ts        # Audio analysis hooks
├── pages/
│   └── HologramPage.tsx        # Demo page with controls
├── App.tsx                     # Router setup
├── main.tsx                    # Entry point
└── index.css                   # Global styles + Tailwind
```

## Key Configuration Constants

### Displacement & Animation
- **Displacement strength**: `0.08-0.15` (hover and pulse interactions)
- **Pulse duration**: `1.2s`
- **Pulse falloff radius**: `0.4`
- **State transition time**: `0.6s` (smooth state changes)
- **Breathing cycle**: `4s` with scale `1.0-1.03`

### Rotation
- **Shell rotation speeds**: `0.02-0.25 rad/s`
- **Adjacent shells**: Counter-rotate for visual interest
- **Hover speed multiplier**: `1.5x`
- **Thinking state**: Inner shells `2.5x`, outer shells `0.4x`

### Visual Effects
- **Bloom intensity**: `1.2` (adjustable via props)
- **Bloom threshold**: `0.2`
- **Chromatic aberration**: `0.0005` base, increases during pulses
- **Opacity range**: `0.6-1.0` with random phase pulsing
- **Spark lifetime**: `2-4s`

### Performance
- **DPR**: Capped at `2`, adaptive based on performance
- **Particle count**: `400` (adaptive, reduces to `240` on slower devices)
- **Core particles**: `500`
- **Shell count**: `6` (5-7 recommended range)
- **Fragments per shell**: `8-20` (density-based)

## Component Props

### `<Avatar>` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `seed` | `number` | `12345` | Seed for deterministic geometry generation |
| `shellCount` | `number` | `6` | Number of nested shells (5-7 recommended) |
| `colorPrimary` | `string` | `#ff9d1a` | Primary hologram color |
| `colorSecondary` | `string` | `#ffd36b` | Secondary hologram color |
| `colorHot` | `string` | `#fff3c4` | Hot spot/highlight color |
| `speed` | `number` | `1.0` | Global speed multiplier |
| `bloomIntensity` | `number` | `1.2` | Post-processing bloom intensity |
| `particleCount` | `number` | `400` | Number of spark particles |
| `intro` | `boolean` | `true` | Enable intro assembly animation |
| `interactive` | `boolean` | `true` | Enable all interactions |
| `audioSource` | `'mic' \| HTMLAudioElement \| null` | `null` | Audio source for reactivity |
| `className` | `string` | `''` | Additional CSS classes |

## useAvatar Hook

```typescript
const { state, setState, amplitude, setAmplitude, pulse } = useAvatar();

// State type
type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Methods
setState(state: AvatarState): void
setAmplitude(amplitude: number): void  // 0-1
pulse(origin?: Vector3): void          // Trigger shockwave
```

## Browser Support

- Modern browsers with WebGL 2.0 support
- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile browsers with touch support

## Accessibility

- Keyboard navigation: Tab to focus, Enter/Space to trigger pulse
- `aria-label` for screen readers
- `prefers-reduced-motion` support
- Graceful degradation on slower devices

## License

MIT

## Credits

Built with ❤️ using React, Three.js, and modern web technologies.

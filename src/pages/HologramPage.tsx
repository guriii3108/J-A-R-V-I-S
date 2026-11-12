import { useState, useRef, useEffect } from 'react';
import { Avatar } from '../components/avatar/Avatar';
import { useAvatar, type AvatarState } from '../lib/useAvatar';
import { useAudioLevel, useSimulatedAmplitude } from '../lib/useAudioLevel';

export const HologramPage: React.FC = () => {
  const { state, setState, setAmplitude, pulse } = useAvatar();
  const [micEnabled, setMicEnabled] = useState(false);
  const [useSimulated, setUseSimulated] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [stage, setStage] = useState<number>(5);
  const introKey = useRef(0);
  
  // Audio level hooks
  const { levelRef: micLevelRef, isActive: micActive, error: micError } = useAudioLevel(
    micEnabled ? 'mic' : null
  );
  
  const simulatedLevelRef = useSimulatedAmplitude(useSimulated && state === 'speaking');
  
  // Update amplitude based on audio source
  useEffect(() => {
    const interval = setInterval(() => {
      if (state === 'speaking') {
        if (micEnabled && micActive) {
          setAmplitude(micLevelRef.current);
        } else if (useSimulated) {
          setAmplitude(simulatedLevelRef.current);
        } else {
          setAmplitude(0);
        }
      } else if (state === 'listening' && micEnabled && micActive) {
        setAmplitude(micLevelRef.current * 0.5);
      } else {
        setAmplitude(0);
      }
    }, 1000 / 60); // 60fps
    
    return () => clearInterval(interval);
  }, [state, micEnabled, micActive, setAmplitude, micLevelRef, simulatedLevelRef, useSimulated]);
  
  const handleStateChange = (newState: AvatarState) => {
    setState(newState);
    
    // Auto-enable simulation when switching to speaking without mic
    if (newState === 'speaking' && !micEnabled) {
      setUseSimulated(true);
    } else if (newState !== 'speaking') {
      setUseSimulated(false);
    }
  };
  
  const handleMicToggle = async () => {
    if (micEnabled) {
      setMicEnabled(false);
    } else {
      setMicEnabled(true);
    }
  };
  
  const handleReplayIntro = () => {
    introKey.current += 1;
    setShowIntro(true);
  };
  
  const handleTriggerPulse = () => {
    pulse();
  };
  
  return (
    <div className="w-full h-screen bg-bg-navy flex flex-col">
      {/* Header */}
      <header className="bg-black/50 backdrop-blur-sm border-b border-hologram-primary/20 p-4">
        <h1 className="text-3xl font-bold text-hologram-primary">
          JARVIS Holographic Avatar
        </h1>
        <p className="text-hologram-secondary/70 text-sm mt-1">
          Production-quality interactive AI assistant visualization
        </p>
      </header>
      
      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Avatar Canvas */}
        <div className="flex-1 relative">
          <Avatar
            key={`${introKey.current}-stage-${stage}`}
            seed={12345}
            shellCount={7}
            stage={stage}
            colorPrimary="#ff8a00"
            colorSecondary="#ffc83d"
            colorHot="#fff1b8"
            speed={1.0}
            bloomIntensity={1.0}
            particleCount={400}
            intro={showIntro}
            interactive={true}
            className="w-full h-full"
          />
          
          {/* Instructions Overlay */}
          <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg p-4 text-hologram-secondary/90 text-sm max-w-xs">
            <h3 className="font-semibold text-hologram-primary mb-2">Interactions:</h3>
            <ul className="space-y-1">
              <li>• <span className="text-hologram-hot">Move cursor</span> - parallax tilt</li>
              <li>• <span className="text-hologram-hot">Hover</span> - proximity reaction</li>
              <li>• <span className="text-hologram-hot">Click/Tap</span> - shockwave pulse</li>
              <li>• <span className="text-hologram-hot">Drag</span> - rotate with inertia</li>
              <li>• <span className="text-hologram-hot">Enter/Space</span> - trigger pulse</li>
            </ul>
          </div>
        </div>
        
        {/* Control Panel */}
        <div className="w-80 bg-black/70 backdrop-blur-sm border-l border-hologram-primary/20 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Pipeline Stage Controls */}
            <div>
              <h2 className="text-lg font-semibold text-hologram-primary mb-2">
                Pipeline Stage
              </h2>
              <p className="text-xs text-hologram-secondary/70 mb-3">
                Switch stages to isolate & verify rendering layers
              </p>
              <div className="space-y-1.5">
                {[
                  { num: 1, label: 'Stage 1: Static Rings (LineBasic)' },
                  { num: 2, label: 'Stage 2: 25k-50k Ticks & Arcs' },
                  { num: 3, label: 'Stage 3: GPU Rodrigues Rotation' },
                  { num: 4, label: 'Stage 4: Trails, Gradient, Depth' },
                  { num: 5, label: 'Stage 5: Full JARVIS (Interactive)' },
                ].map(({ num, label }) => (
                  <button
                    key={num}
                    onClick={() => setStage(num)}
                    className={`
                      w-full text-left text-xs px-3 py-2 rounded-lg font-medium transition-all
                      ${stage === num
                        ? 'bg-hologram-primary text-black font-bold shadow-md shadow-hologram-primary/40'
                        : 'bg-hologram-primary/10 text-hologram-secondary hover:bg-hologram-primary/20 border border-hologram-primary/25'
                      }
                    `}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* State Controls */}
            <div>
              <h2 className="text-lg font-semibold text-hologram-primary mb-3">
                Avatar State
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {(['idle', 'listening', 'thinking', 'speaking'] as AvatarState[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStateChange(s)}
                    className={`
                      px-4 py-2 rounded-lg font-medium transition-all
                      ${state === s
                        ? 'bg-hologram-primary text-black shadow-lg shadow-hologram-primary/50'
                        : 'bg-hologram-primary/10 text-hologram-secondary hover:bg-hologram-primary/20 border border-hologram-primary/30'
                      }
                    `}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Audio Controls */}
            <div>
              <h2 className="text-lg font-semibold text-hologram-primary mb-3">
                Audio Reactivity
              </h2>
              
              <button
                onClick={handleMicToggle}
                className={`
                  w-full px-4 py-2 rounded-lg font-medium transition-all mb-2
                  ${micEnabled
                    ? 'bg-green-600 text-white'
                    : 'bg-hologram-primary/10 text-hologram-secondary hover:bg-hologram-primary/20 border border-hologram-primary/30'
                  }
                `}
              >
                {micEnabled ? '🎤 Microphone Active' : '🎤 Enable Microphone'}
              </button>
              
              {micError && (
                <p className="text-red-400 text-xs mb-2">
                  {micError}
                </p>
              )}
              
              {micActive && (
                <p className="text-green-400 text-xs mb-2">
                  ✓ Audio input connected
                </p>
              )}
              
              <label className="flex items-center space-x-2 text-hologram-secondary text-sm">
                <input
                  type="checkbox"
                  checked={useSimulated}
                  onChange={(e) => setUseSimulated(e.target.checked)}
                  className="rounded"
                />
                <span>Use simulated audio (demo)</span>
              </label>
              
              <p className="text-hologram-secondary/60 text-xs mt-2">
                Audio reactivity works in 'listening' and 'speaking' states.
                Simulated audio auto-enables when speaking without mic.
              </p>
            </div>
            
            {/* Animation Controls */}
            <div>
              <h2 className="text-lg font-semibold text-hologram-primary mb-3">
                Animations
              </h2>
              
              <button
                onClick={handleReplayIntro}
                className="w-full px-4 py-2 rounded-lg font-medium bg-hologram-primary/10 text-hologram-secondary hover:bg-hologram-primary/20 border border-hologram-primary/30 transition-all mb-2"
              >
                🔄 Replay Intro
              </button>
              
              <button
                onClick={handleTriggerPulse}
                className="w-full px-4 py-2 rounded-lg font-medium bg-hologram-primary/10 text-hologram-secondary hover:bg-hologram-primary/20 border border-hologram-primary/30 transition-all"
              >
                ⚡ Trigger Pulse
              </button>
            </div>
            
            {/* Configuration Info */}
            <div>
              <h2 className="text-lg font-semibold text-hologram-primary mb-3">
                Configuration
              </h2>
              
              <div className="space-y-2 text-xs text-hologram-secondary/70">
                <div className="flex justify-between">
                  <span>Shells:</span>
                  <span className="text-hologram-secondary">6</span>
                </div>
                <div className="flex justify-between">
                  <span>Particles:</span>
                  <span className="text-hologram-secondary">400</span>
                </div>
                <div className="flex justify-between">
                  <span>Bloom Intensity:</span>
                  <span className="text-hologram-secondary">1.2</span>
                </div>
                <div className="flex justify-between">
                  <span>Seed:</span>
                  <span className="text-hologram-secondary">12345</span>
                </div>
              </div>
            </div>
            
            {/* Performance Notes */}
            <div className="bg-hologram-primary/5 rounded-lg p-3 border border-hologram-primary/20">
              <h3 className="text-sm font-semibold text-hologram-primary mb-2">
                Performance Features
              </h3>
              <ul className="text-xs text-hologram-secondary/70 space-y-1">
                <li>• Adaptive DPR & particle count</li>
                <li>• Prefers-reduced-motion support</li>
                <li>• Shader-based interactions</li>
                <li>• Merged geometries</li>
                <li>• 60fps on mid-range laptops</li>
              </ul>
            </div>
            
            {/* Technical Details */}
            <div className="bg-hologram-primary/5 rounded-lg p-3 border border-hologram-primary/20">
              <h3 className="text-sm font-semibold text-hologram-primary mb-2">
                Key Constants
              </h3>
              <ul className="text-xs text-hologram-secondary/70 space-y-1">
                <li>• Displacement: <code>0.08-0.15</code></li>
                <li>• Pulse duration: <code>1.2s</code></li>
                <li>• Pulse falloff: <code>0.4 radius</code></li>
                <li>• State transition: <code>0.6s</code></li>
                <li>• Rotation: <code>0.02-0.25 rad/s</code></li>
                <li>• Breathing: <code>4s cycle, 1.0-1.03</code></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

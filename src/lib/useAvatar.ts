import { create } from 'zustand';
import type { Vector3 } from 'three';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface PulseData {
  origin: Vector3 | null;
  startTime: number;
}

interface AvatarStore {
  state: AvatarState;
  amplitude: number;
  pulses: PulseData[];
  setState: (state: AvatarState) => void;
  setAmplitude: (amplitude: number) => void;
  pulse: (origin?: Vector3) => void;
}

export const useAvatarStore = create<AvatarStore>((set) => ({
  state: 'idle',
  amplitude: 0,
  pulses: [],
  
  setState: (state: AvatarState) => set({ state }),
  
  setAmplitude: (amplitude: number) => set({ amplitude }),
  
  pulse: (origin?: Vector3) => set((state) => {
    const newPulse: PulseData = {
      origin: origin || null,
      startTime: performance.now(),
    };
    
    // Keep only the last 4 pulses (ring buffer)
    const pulses = [...state.pulses, newPulse].slice(-4);
    
    return { pulses };
  }),
}));

/**
 * Hook to access and control the avatar state
 */
export const useAvatar = () => {
  const { state, setState, amplitude, setAmplitude, pulse } = useAvatarStore();
  
  return {
    state,
    setState,
    amplitude,
    setAmplitude,
    pulse,
  };
};

import { useEffect, useRef, useState } from 'react';

type AudioSource = 'mic' | HTMLAudioElement;

interface UseAudioLevelOptions {
  smoothing?: number; // Exponential smoothing factor (0-1), default 0.8
  fftSize?: number; // FFT size, default 256
}

/**
 * Hook to analyze audio levels from microphone or audio element
 * Returns a ref that updates on every frame (not state to avoid re-renders)
 */
export const useAudioLevel = (
  source: AudioSource | null,
  options: UseAudioLevelOptions = {}
) => {
  const {
    smoothing = 0.8,
    fftSize = 256,
  } = options;

  const levelRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!source) {
      cleanup();
      return;
    }

    const setupAudio = async () => {
      try {
        // Create audio context
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;

        // Create analyser
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothing;
        analyserRef.current = analyser;

        const bufferLength = analyser.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(bufferLength);

        // Connect source
        if (source === 'mic') {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const sourceNode = audioContext.createMediaStreamSource(stream);
          sourceNodeRef.current = sourceNode;
          sourceNode.connect(analyser);
        } else {
          const sourceNode = audioContext.createMediaElementSource(source);
          sourceNodeRef.current = sourceNode;
          sourceNode.connect(analyser);
          analyser.connect(audioContext.destination); // Also play the audio
        }

        setIsActive(true);
        setError(null);

        // Start analyzing
        const analyze = () => {
          if (!analyserRef.current || !dataArrayRef.current) return;

          analyserRef.current.getByteTimeDomainData(dataArrayRef.current as any);

          // Calculate RMS (Root Mean Square)
          let sum = 0;
          for (let i = 0; i < dataArrayRef.current.length; i++) {
            const normalized = (dataArrayRef.current[i] - 128) / 128;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / dataArrayRef.current.length);

          // Update ref (not state to avoid re-renders)
          levelRef.current = Math.min(rms * 2, 1); // Amplify and clamp

          animationFrameRef.current = requestAnimationFrame(analyze);
        };

        analyze();

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to access audio';
        setError(message);
        setIsActive(false);
        console.error('Audio setup error:', err);
      }
    };

    setupAudio();

    return cleanup;
  }, [source, smoothing, fftSize]);

  const cleanup = () => {
    // Stop animation
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect and close audio nodes
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    levelRef.current = 0;
    setIsActive(false);
  };

  return {
    levelRef,
    isActive,
    error,
  };
};

/**
 * Generate simulated audio amplitude for demo purposes
 * Uses layered sine waves and noise
 */
export const useSimulatedAmplitude = (enabled: boolean = true) => {
  const amplitudeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!enabled) {
      amplitudeRef.current = 0;
      return;
    }

    let animationFrameId: number;

    const update = () => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      
      // Layer multiple sine waves for organic feel
      const slow = Math.sin(elapsed * 0.5) * 0.3;
      const medium = Math.sin(elapsed * 1.2) * 0.4;
      const fast = Math.sin(elapsed * 3.7) * 0.2;
      const noise = (Math.random() - 0.5) * 0.1;
      
      amplitudeRef.current = Math.max(0, Math.min(1, 
        0.3 + slow + medium + fast + noise
      ));

      animationFrameId = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(animationFrameId);
      amplitudeRef.current = 0;
    };
  }, [enabled]);

  return amplitudeRef;
};

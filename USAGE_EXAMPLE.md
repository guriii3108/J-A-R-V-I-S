# Usage Examples

## Basic Usage

```tsx
import { Avatar } from './components/avatar/Avatar';

function MyApp() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar />
    </div>
  );
}
```

## With Custom Configuration

```tsx
import { Avatar } from './components/avatar/Avatar';

function MyApp() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar
        seed={54321}
        shellCount={7}
        colorPrimary="#00ff88"
        colorSecondary="#00ffff"
        colorHot="#ffffff"
        speed={1.5}
        bloomIntensity={1.5}
        particleCount={600}
        intro={true}
        interactive={true}
      />
    </div>
  );
}
```

## Programmatic State Control

```tsx
import { useState, useEffect } from 'react';
import { Avatar } from './components/avatar/Avatar';
import { useAvatar } from './lib/useAvatar';

function AIAssistant() {
  const { state, setState, setAmplitude, pulse } = useAvatar();
  
  // Simulate AI assistant states
  useEffect(() => {
    // When user starts speaking
    setState('listening');
    
    // When AI is processing
    setTimeout(() => setState('thinking'), 2000);
    
    // When AI responds
    setTimeout(() => setState('speaking'), 4000);
    
    // Back to idle
    setTimeout(() => setState('idle'), 8000);
  }, [setState]);
  
  // Simulate speaking amplitude
  useEffect(() => {
    if (state === 'speaking') {
      const interval = setInterval(() => {
        const amplitude = Math.random() * 0.8 + 0.2;
        setAmplitude(amplitude);
      }, 100);
      
      return () => clearInterval(interval);
    }
  }, [state, setAmplitude]);
  
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar interactive={true} />
      
      <div style={{ position: 'absolute', top: 20, left: 20 }}>
        <button onClick={() => setState('idle')}>Idle</button>
        <button onClick={() => setState('listening')}>Listening</button>
        <button onClick={() => setState('thinking')}>Thinking</button>
        <button onClick={() => setState('speaking')}>Speaking</button>
        <button onClick={() => pulse()}>Pulse</button>
      </div>
    </div>
  );
}
```

## With Microphone Input

```tsx
import { useState } from 'react';
import { Avatar } from './components/avatar/Avatar';
import { useAvatar } from './lib/useAvatar';
import { useAudioLevel } from './lib/useAudioLevel';

function VoiceActivatedAvatar() {
  const { setState, setAmplitude } = useAvatar();
  const [micEnabled, setMicEnabled] = useState(false);
  
  const { levelRef, isActive, error } = useAudioLevel(
    micEnabled ? 'mic' : null
  );
  
  // Update amplitude from mic
  useEffect(() => {
    if (isActive) {
      const interval = setInterval(() => {
        setAmplitude(levelRef.current);
      }, 1000 / 60);
      
      return () => clearInterval(interval);
    }
  }, [isActive, levelRef, setAmplitude]);
  
  // Auto-switch to listening when mic is active
  useEffect(() => {
    if (isActive) {
      setState('listening');
    } else {
      setState('idle');
    }
  }, [isActive, setState]);
  
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar interactive={true} />
      
      <button
        onClick={() => setMicEnabled(!micEnabled)}
        style={{ position: 'absolute', top: 20, left: 20 }}
      >
        {micEnabled ? 'Disable Mic' : 'Enable Mic'}
      </button>
      
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}
```

## Custom Colors and Styling

```tsx
import { Avatar } from './components/avatar/Avatar';

function CustomStyledAvatar() {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(to bottom, #000033, #000011)'
    }}>
      <Avatar
        colorPrimary="#ff0088"    // Hot pink
        colorSecondary="#ff66ff"  // Light pink
        colorHot="#ffffff"        // White hot spots
        bloomIntensity={1.8}      // More bloom
        speed={0.5}               // Slower rotation
        className="custom-avatar"
      />
    </div>
  );
}
```

## Integration with Speech Recognition

```tsx
import { useEffect } from 'react';
import { Avatar } from './components/avatar/Avatar';
import { useAvatar } from './lib/useAvatar';

function SpeechRecognitionAvatar() {
  const { setState, pulse } = useAvatar();
  
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) return;
    
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => {
      setState('listening');
    };
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      console.log('Heard:', transcript);
      
      // Pulse on speech detected
      pulse();
    };
    
    recognition.onerror = () => {
      setState('idle');
    };
    
    recognition.onend = () => {
      setState('idle');
    };
    
    recognition.start();
    
    return () => {
      recognition.stop();
    };
  }, [setState, pulse]);
  
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar interactive={true} />
    </div>
  );
}
```

## Disable Intro Animation

```tsx
import { Avatar } from './components/avatar/Avatar';

function NoIntroAvatar() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar intro={false} />
    </div>
  );
}
```

## Non-Interactive Display

```tsx
import { Avatar } from './components/avatar/Avatar';

function DisplayOnlyAvatar() {
  return (
    <div style={{ width: '800px', height: '600px' }}>
      <Avatar
        interactive={false}
        intro={false}
        speed={0.3}
      />
    </div>
  );
}
```

## Performance Optimized for Mobile

```tsx
import { Avatar } from './components/avatar/Avatar';

function MobileOptimizedAvatar() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Avatar
        shellCount={5}           // Fewer shells
        particleCount={200}      // Fewer particles
        bloomIntensity={1.0}     // Less bloom
        speed={0.8}              // Slightly slower
      />
    </div>
  );
}
```

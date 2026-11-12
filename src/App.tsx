import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HologramPage } from './pages/HologramPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/hologram" replace />} />
        <Route path="/hologram" element={<HologramPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

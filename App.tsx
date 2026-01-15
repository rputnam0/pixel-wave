import React from 'react';
import PixelGridBackground from './components/PixelGridBackground';

function App() {
  return (
    <div className="relative min-h-screen font-sans text-gray-900">
      {/* Background Layer */}
      <PixelGridBackground />
    </div>
  );
}

export default App;
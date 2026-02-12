import { useState, useEffect } from 'react';
import { InteractiveGraph } from './components/InteractiveGraph';
import { GlassmorphicControlPanel } from './components/GlassmorphicControlPanel';

export default function App() {
  // State for peak parameters
  const [peakPosition, setPeakPosition] = useState(25.64);
  const [peakWidth, setPeakWidth] = useState(0.22);
  const [peakHeight, setPeakHeight] = useState(270);
  const [aiTemp, setAiTemp] = useState(25);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // FORWARD MODE: Sliders -> Temp
  useEffect(() => {
    if (!autoSyncEnabled) {
      const fetchTemp = async () => {

        const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(`${BASE_URL}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // CHANGE THIS: Match the names in your main.py ForwardInput class
          body: JSON.stringify({
            pos: peakPosition,
            fwhm: peakWidth,      // Changed from 'width' to 'fwhm'
            intensity: peakHeight // Changed from 'height' to 'intensity'
          })
        });
        const data = await response.json();
        setAiTemp(data.temperature);
      };
      fetchTemp();
    }
  }, [peakPosition, peakWidth, peakHeight, autoSyncEnabled]);

  // INVERSE MODE: Temperature -> Physical Params
  const handleTempChange = async (newTemp: number) => {
    setAiTemp(newTemp);
    if (autoSyncEnabled) {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ temp: newTemp })
        });
        const data = await response.json();
        setPeakPosition(data.pos);
        setPeakWidth(data.fwhm);
        setPeakHeight(data.intensity);
      } catch (err) {
        console.error("Simulation error:", err);
      }
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto">

        {/* Header - Center on mobile, left-align on desktop */}
        <div className="mb-6 text-center md:text-left">
          <h1 className="text-2xl md:text-4xl font-bold text-white font-mono tracking-wider mb-2">
            CdSe X-Ray Diffraction Thermometry
          </h1>
          <p className="text-zinc-400 font-mono text-xs md:text-sm">
            Real-time Temperature Prediction & Peak Analysis System
          </p>
        </div>

        {/* AI Result Card - Full width on mobile */}
        <div className="mb-6 bg-zinc-900 border border-cyan-500/30 p-4 rounded-xl w-full md:w-fit text-center md:text-left">
          <p className="text-cyan-500 text-[10px] font-mono uppercase tracking-widest mb-1">AI Prediction</p>
          <p className="text-3xl md:text-4xl text-white font-mono">{(aiTemp || 0).toFixed(2)} °C</p>
        </div>

        {/* Main Content: Column on mobile, Row on desktop */}
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Interactive Graph - Takes full width on mobile, shrinks on desktop */}
          <div className="w-full lg:flex-1 order-1 lg:order-1">
            <InteractiveGraph
              peakPosition={peakPosition}
              peakWidth={peakWidth}
              peakHeight={peakHeight}
              predictedTemp={aiTemp}
            />
          </div>

          {/* Control Panel - Stacks below graph on mobile */}
          <div className="w-full lg:w-80 order-2 lg:order-2 flex justify-center">
            <GlassmorphicControlPanel
              peakPosition={peakPosition}
              peakWidth={peakWidth}
              peakHeight={peakHeight}
              currentTemp={aiTemp}
              onPeakPositionChange={setPeakPosition}
              onPeakWidthChange={setPeakWidth}
              onPeakHeightChange={setPeakHeight}
              onTemperatureChange={handleTempChange}
              autoSyncEnabled={autoSyncEnabled}
              onAutoSyncToggle={setAutoSyncEnabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

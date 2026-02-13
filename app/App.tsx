import { useState, useEffect } from 'react';
import { InteractiveGraph } from './components/InteractiveGraph';
import { GlassmorphicControlPanel } from './components/GlassmorphicControlPanel';
import { TabNavigation } from './components/TabNavigation'; // Don't forget this!
import { FWHMEstimator } from './components/FWHMEstimator';   // Don't forget this!

export default function App() {
  // State for peak parameters
  const [peakPosition, setPeakPosition] = useState(25.64);
  const [peakWidth, setPeakWidth] = useState(0.22); // Keep only one declaration
  const [peakHeight, setPeakHeight] = useState(270);
  const [aiTemp, setAiTemp] = useState(25);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<'predictor' | 'fwhm'>('predictor');
  const [showApplyFeedback, setShowApplyFeedback] = useState(false);

  // FIXED: Added missing { and ensured one peakWidth variable
  const handleApplyFWHM = (newFWHM: number) => {
    setPeakWidth(newFWHM);
    setActiveTab('predictor');

    setShowApplyFeedback(true);
    setTimeout(() => setShowApplyFeedback(false), 3000);
  };

  // FORWARD MODE: Sliders -> Temp
  useEffect(() => {
    if (!autoSyncEnabled) {
      const fetchTemp = async () => {
        try {
          const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
          const response = await fetch(`${BASE_URL}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pos: peakPosition,
              fwhm: peakWidth,
              intensity: peakHeight
            })
          });
          const data = await response.json();
          setAiTemp(data.temperature);
        } catch (err) {
          console.error("Prediction error:", err);
        }
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

      {/* GLOBAL SUCCESS OVERLAY */}
      {showApplyFeedback && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in zoom-in slide-in-from-top-4 duration-300">
          <div className="bg-emerald-500 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-3 border border-emerald-400">
            <div className="bg-white/20 rounded-full p-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <span className="font-mono font-bold text-xs uppercase tracking-widest">
              Estimated FWHM Applied to Predictor
            </span>
          </div>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="mb-6 text-center md:text-left">
          <h1 className="text-2xl md:text-4xl font-bold text-white font-mono tracking-wider mb-2">
            CdSe X-Ray Diffraction Thermometry
          </h1>
          <p className="text-zinc-400 font-mono text-xs md:text-sm">
            Real-time Temperature Prediction & Peak Analysis System
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8">
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* CONDITIONAL RENDERING: Tab Switch logic */}
        {activeTab === 'predictor' ? (
          <>
            {/* AI Result Card */}
            <div className="mb-6 bg-zinc-900 border border-cyan-500/30 p-4 rounded-xl w-full md:w-fit text-center md:text-left">
              <p className="text-cyan-500 text-[10px] font-mono uppercase tracking-widest mb-1">AI Prediction</p>
              <p className="text-3xl md:text-4xl text-white font-mono">{(aiTemp || 0).toFixed(2)} °C</p>
            </div>

            {/* Main Content: Graph and Sliders */}
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="w-full lg:flex-1 order-1 lg:order-1">
                <InteractiveGraph
                  peakPosition={peakPosition}
                  peakWidth={peakWidth}
                  peakHeight={peakHeight}
                  predictedTemp={aiTemp}
                />
              </div>

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
          </>
        ) : (
          /* FWHM Tab Content */
          <div className="animate-in fade-in duration-500">
            <FWHMEstimator onApplyToPredictor={handleApplyFWHM} />
          </div>
        )}
      </div>
    </div>
  );
}
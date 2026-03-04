import { useState, useEffect } from 'react';
import { InteractiveGraph } from './components/InteractiveGraph';
import { GlassmorphicControlPanel } from './components/GlassmorphicControlPanel';
import { TabNavigation } from './components/TabNavigation';
import { FWHMEstimator } from './components/FWHMEstimator';
import { DatasetFactory } from './components/DatasetFactory';

export default function App() {
  // --- Predictor States ---
  const [peakPosition, setPeakPosition] = useState(25.64);
  const [peakWidth, setPeakWidth] = useState(0.22);
  const [peakHeight, setPeakHeight] = useState(270);
  const [aiTemp, setAiTemp] = useState(25);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);

  // --- Navigation & Calibration States ---
  const [activeTab, setActiveTab] = useState<'predictor' | 'fwhm' | 'factory'>('predictor');
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [modelMode, setModelMode] = useState<'base' | 'calibrated'>('base');

  // --- Feedback States ---
  const [showApplyFeedback, setShowApplyFeedback] = useState(false);
  const [showCalibFeedback, setShowCalibFeedback] = useState(false);

  // --- LIFTED FACTORY STATES (Persistent Memory) ---
  const [factoryFiles, setFactoryFiles] = useState<File[]>([]);
  const [factoryExtractedData, setFactoryExtractedData] = useState<any[]>([]);
  const [factoryLogs, setFactoryLogs] = useState<string[]>(['> System initialized...', '> Awaiting DNA intake...']);

  const handleApplyFWHM = (newFWHM: number) => {
    setPeakWidth(newFWHM);
    setActiveTab('predictor');
    setShowApplyFeedback(true);
    setTimeout(() => setShowApplyFeedback(false), 3000);
  };

  const handleCalibrationComplete = () => {
    setIsCalibrated(true);
    setModelMode('calibrated');
    setActiveTab('predictor');
    setShowCalibFeedback(true);
    setTimeout(() => setShowCalibFeedback(false), 4000);
  };

  // Predictor Inference Effect
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
              intensity: peakHeight,
              use_calibrated: modelMode === 'calibrated'
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
  }, [peakPosition, peakWidth, peakHeight, autoSyncEnabled, modelMode]);

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
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-4 md:p-6 relative">

      {/* Feedback Overlays */}
      {showApplyFeedback && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in zoom-in slide-in-from-top-4 duration-300 bg-emerald-500 text-white px-6 py-3 rounded-full font-mono text-xs uppercase font-bold border border-emerald-400">
          Estimated FWHM Applied
        </div>
      )}

      {showCalibFeedback && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in zoom-in slide-in-from-top-4 duration-300 bg-cyan-500 text-white px-8 py-4 rounded-2xl font-mono border border-cyan-400 text-center">
          <p className="font-bold text-sm uppercase">Calibration Successful</p>
          <p className="text-[10px] opacity-90">Machine-specific model active</p>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl md:text-4xl font-bold text-white font-mono tracking-wider">
            CdSe X-Ray Diffraction Thermometry
          </h1>
          <p className="text-zinc-400 font-mono text-xs md:text-sm">Real-time Prediction & Refinery System</p>
        </header>

        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="mt-8">
          {activeTab === 'predictor' && (
            <div className="flex flex-col lg:flex-row gap-6 animate-in fade-in duration-500">
              <div className="flex-1 space-y-6">
                <div className="bg-zinc-900 border border-cyan-500/30 p-4 rounded-xl w-fit">
                  <p className="text-cyan-500 text-[10px] font-mono uppercase tracking-widest mb-1">
                    {modelMode === 'calibrated' ? 'Calibrated Mode' : 'Base Mode'}
                  </p>
                  <p className="text-3xl md:text-4xl text-white font-mono">{(aiTemp || 0).toFixed(2)} °C</p>
                </div>
                <InteractiveGraph peakPosition={peakPosition} peakWidth={peakWidth} peakHeight={peakHeight} predictedTemp={aiTemp} />
              </div>
              <GlassmorphicControlPanel
                peakPosition={peakPosition} peakWidth={peakWidth} peakHeight={peakHeight} currentTemp={aiTemp}
                onPeakPositionChange={setPeakPosition} onPeakWidthChange={setPeakWidth} onPeakHeightChange={setPeakHeight}
                onTemperatureChange={handleTempChange} autoSyncEnabled={autoSyncEnabled} onAutoSyncToggle={setAutoSyncEnabled}
                highlightWidth={showApplyFeedback} isCalibrated={isCalibrated} modelMode={modelMode} onModelModeChange={setModelMode}
              />
            </div>
          )}

          {activeTab === 'fwhm' && <FWHMEstimator onApplyToPredictor={handleApplyFWHM} />}

          {activeTab === 'factory' && (
            <DatasetFactory
              files={factoryFiles} setFiles={setFactoryFiles}
              extractedData={factoryExtractedData} setExtractedData={setFactoryExtractedData}
              consoleLog={factoryLogs} setConsoleLog={setFactoryLogs}
              onCalibrationComplete={handleCalibrationComplete}
            />
          )}
        </main>
      </div>
    </div>
  );
}
import React, { useState } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Info, Sparkles, ArrowRight, Atom, CheckCircle2 } from 'lucide-react';

interface FWHMEstimatorProps {
  onApplyToPredictor: (fwhm: number) => void;
}

export function FWHMEstimator({ onApplyToPredictor }: FWHMEstimatorProps) {
  const [peakPosition, setPeakPosition] = useState<string>('30.0');
  const [maxIntensity, setMaxIntensity] = useState<string>('500');
  const [estimatedFWHM, setEstimatedFWHM] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Physics-based FWHM estimation using Scherrer-inspired formula
  const estimateFWHM = async () => {
    const theta = parseFloat(peakPosition);
    const intensityValue = parseFloat(maxIntensity);

    if (isNaN(theta) || isNaN(intensityValue)) return;

    try {
      const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${BASE_URL}/estimate-fwhm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pos: theta,
          intensity: intensityValue
        }),
      });

      const data = await response.json();
      setEstimatedFWHM(parseFloat(data.fwhm.toFixed(4)));
      setShowResults(true);
    } catch (err) {
      console.error("FWHM Estimation Error:", err);
      alert("Failed to connect to the AI Estimation server.");
    }
  };

  const handleApplyToPredictor = () => {
    if (estimatedFWHM !== null) {
      setIsApplying(true); // Show local "Checkmark" state

      // Delay the tab switch slightly so the user sees the confirmation
      setTimeout(() => {
        onApplyToPredictor(estimatedFWHM);
        // Reset after a delay so it's fresh if they come back to this tab
        setTimeout(() => setIsApplying(false), 500);
      }, 800);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold text-white font-mono">
                AI-ASSISTED PEAK CHARACTERIZATION
              </h2>
              <button className="text-cyan-400 hover:text-cyan-300 transition-colors">
                <Info className="w-5 h-5" />
              </button>
            </div>
            <p className="text-zinc-400 text-sm">
              Physics-based FWHM prediction for CdSe XRD patterns
            </p>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Input Fields */}
            <div className="space-y-4">
              {/* Peak Position Input */}
              <div className="space-y-2">
                <Label className="text-zinc-700 font-mono text-sm flex items-center gap-2">
                  <Atom className="w-4 h-4 text-cyan-600" />
                  Peak Position (2θ)
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={peakPosition}
                    onChange={(e) => setPeakPosition(e.target.value)}
                    placeholder="30.0"
                    min="20"
                    max="40"
                    step="0.1"
                    className="w-full h-14 text-lg font-mono border-2 border-zinc-300 focus:border-cyan-500 rounded-xl pl-4 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-sm">
                    deg
                  </span>
                </div>
                <p className="text-xs text-zinc-500 font-mono">
                  Valid range: 20° – 40°
                </p>
              </div>

              {/* Max Intensity Input */}
              <div className="space-y-2">
                <Label className="text-zinc-700 font-mono text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Max Intensity
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={maxIntensity}
                    onChange={(e) => setMaxIntensity(e.target.value)}
                    placeholder="500"
                    min="0"
                    max="1000"
                    step="10"
                    className="w-full h-14 text-lg font-mono border-2 border-zinc-300 focus:border-purple-500 rounded-xl pl-4 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 font-mono text-sm">
                    a.u.
                  </span>
                </div>
                <p className="text-xs text-zinc-500 font-mono">
                  Valid range: 0 – 1000 a.u.
                </p>
              </div>
            </div>

            {/* Magic Button */}
            <Button
              onClick={estimateFWHM}
              className="w-full h-14 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-mono font-bold text-base rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Estimate FWHM from Physics Baseline
            </Button>

            {/* Results Card */}
            {showResults && estimatedFWHM !== null && (
              <div className="bg-gradient-to-br from-zinc-900 to-zinc-800 rounded-xl p-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center">
                  <p className="text-zinc-400 text-sm font-mono mb-2">
                    SUGGESTED FWHM
                  </p>
                  <p className="text-5xl font-bold text-cyan-400 font-mono tracking-wider">
                    {estimatedFWHM}°
                  </p>
                  <p className="text-zinc-500 text-xs font-mono mt-2">
                    Full Width at Half Maximum
                  </p>
                </div>

                {/* Physics Context */}
                <div className="border-t border-zinc-700 pt-4">
                  <p className="text-zinc-400 text-xs font-mono leading-relaxed">
                    <span className="text-cyan-400 font-bold">INFO:</span> This estimate uses the
                    Scherrer equation baseline considering crystallite size effects and angular
                    dispersion for CdSe nanocrystals.
                  </p>
                </div>

                {/* Apply Button */}
                <Button
                  onClick={handleApplyToPredictor}
                  disabled={isApplying}
                  className={`w-full h-12 font-mono font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                    isApplying
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                  }`}
                >
                  {isApplying ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 animate-in zoom-in duration-300" />
                      FWHM Applied!
                    </>
                  ) : (
                    <>
                      Apply Value to Predictor
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="bg-zinc-50 px-6 py-4 border-t border-zinc-200">
            <p className="text-xs text-zinc-600 text-center font-mono">
              Powered by Material Informatics AI • CdSe XRD Analysis v2.1
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

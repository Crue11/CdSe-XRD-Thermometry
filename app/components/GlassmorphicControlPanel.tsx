import React from 'react';
import { Slider } from './ui/slider';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Database, Zap, Lock } from 'lucide-react';

interface GlassmorphicControlPanelProps {
  peakPosition: number;
  peakWidth: number;
  peakHeight: number;
  currentTemp: number;
  onPeakPositionChange: (value: number) => void;
  onPeakWidthChange: (value: number) => void;
  onPeakHeightChange: (value: number) => void;
  onTemperatureChange: (value: number) => void;
  autoSyncEnabled: boolean;
  onAutoSyncToggle: (enabled: boolean) => void;
  highlightWidth?: boolean;
  // New Calibration Props
  isCalibrated: boolean;
  modelMode: 'base' | 'calibrated';
  onModelModeChange: (mode: 'base' | 'calibrated') => void;
}

export function GlassmorphicControlPanel({
  peakPosition, peakWidth, peakHeight, currentTemp,
  onPeakPositionChange, onPeakWidthChange, onPeakHeightChange, onTemperatureChange,
  autoSyncEnabled, onAutoSyncToggle, highlightWidth,
  isCalibrated, modelMode, onModelModeChange
}: GlassmorphicControlPanelProps) {

  const REF_TEMPS = [25, 100, 200, 300, 400];

  const handleInput = (val: string, setter: (n: number) => void, min: number, max: number) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setter(Math.min(max, Math.max(min, num)));
    }
  };

  return (
    <div className="w-80 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
      <div className="relative z-10">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-white font-mono tracking-wide">CONTROL PANEL</h3>
          <p className="text-zinc-400 text-xs font-mono mt-1">XRD Parameter Configuration</p>
        </div>

        {/* MODEL SELECTION TOGGLE */}
        <div className="mb-4 p-1 bg-black/40 rounded-xl border border-zinc-800 flex">
          <button
            onClick={() => onModelModeChange('base')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-mono text-[10px] font-bold transition-all ${
              modelMode === 'base'
                ? 'bg-zinc-800 text-cyan-400 shadow-inner'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Database className="w-3 h-3" />
            BASE
          </button>
          <button
            onClick={() => isCalibrated && onModelModeChange('calibrated')}
            disabled={!isCalibrated}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-mono text-[10px] font-bold transition-all relative ${
              modelMode === 'calibrated'
                ? 'bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : isCalibrated
                  ? 'text-zinc-500 hover:text-zinc-300'
                  : 'text-zinc-700 cursor-not-allowed'
            }`}
          >
            {isCalibrated ? <Zap className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            CALIBRATED
            {!isCalibrated && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-[8px] px-2 py-1 rounded opacity-0 hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-zinc-700">
                Requires Dataset Factory Run
              </span>
            )}
          </button>
        </div>

        {/* Mode Switch */}
        <div className="mb-6 p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
          <div className="flex items-center justify-between">
            <Label className="text-white font-mono text-sm">{autoSyncEnabled ? 'Inverse Mode' : 'Forward Mode'}</Label>
            <Switch checked={autoSyncEnabled} onCheckedChange={onAutoSyncToggle} className="data-[state=checked]:bg-cyan-500" />
          </div>
        </div>

        {/* Target Temp Input (Inverse Mode) */}
        {autoSyncEnabled && (
          <div className="mb-8 p-4 bg-cyan-500/10 rounded-xl border border-cyan-500/30 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider">Target Temp</Label>
              <div className="flex items-center gap-1 bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">
                <Input
                  type="number"
                  value={currentTemp}
                  onChange={(e) => handleInput(e.target.value, onTemperatureChange, 25, 400)}
                  className="w-14 h-5 p-0 bg-transparent border-none text-white font-mono text-[11px] text-right focus-visible:ring-0"
                />
                <span className="text-white font-mono text-[11px]">°C</span>
              </div>
            </div>

            <div className="relative h-6 mb-2">
              <div className="absolute inset-0 flex justify-between px-1">
                {REF_TEMPS.map(t => (
                  <div key={t} className="flex flex-col items-center">
                    <div className={`w-0.5 h-2 transition-all duration-300 ${Math.abs(currentTemp - t) < 5 ? 'bg-cyan-400 shadow-[0_0_8px_cyan]' : 'bg-zinc-700'}`} />
                    <span className={`text-[8px] font-mono mt-1 transition-colors duration-300 ${Math.abs(currentTemp - t) < 5 ? 'text-cyan-400 font-bold' : 'text-zinc-600'}`}>
                      {t === 25 ? 'RT' : `${t}°`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Slider value={[currentTemp]} onValueChange={(v) => onTemperatureChange(v[0])} min={25} max={400} step={1} />
          </div>
        )}

        <div className={`space-y-6 ${autoSyncEnabled ? 'opacity-40 pointer-events-none' : ''}`}>

          {/* Peak Position Section */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
            <div className="flex justify-between items-center mb-4">
              <Label className="text-cyan-400 font-mono text-[10px] uppercase tracking-wider">Position (2θ)</Label>
              <div className="flex items-center gap-1 bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">
                <Input
                  type="number" step="0.001" value={peakPosition}
                  onChange={(e) => handleInput(e.target.value, onPeakPositionChange, 24, 28)}
                  className="w-16 h-5 p-0 bg-transparent border-none text-white font-mono text-[11px] text-right focus-visible:ring-0"
                />
                <span className="text-white font-mono text-[11px]">°</span>
              </div>
            </div>
            <Slider value={[peakPosition]} onValueChange={(v) => onPeakPositionChange(v[0])} min={25.0} max={26.5} step={0.001} />
          </div>

          {/* Peak Width Section (FWHM) */}
          <div className={`p-4 rounded-xl transition-all duration-500 ${
            highlightWidth ? 'bg-emerald-500/20 ring-1 ring-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-zinc-800/30 border border-zinc-700/30'
          }`}>
            <div className="flex justify-between items-center mb-4">
              <Label className="text-zinc-400 font-mono text-[10px] uppercase tracking-wider">Width (FWHM)</Label>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors duration-500 ${
                highlightWidth ? 'bg-emerald-400 text-black border-emerald-400' : 'bg-emerald-500/20 text-white border-emerald-500/30'
              }`}>
                <Input
                  type="number" step="0.0001" value={peakWidth}
                  onChange={(e) => handleInput(e.target.value, onPeakWidthChange, 0.1, 0.6)}
                  className={`w-16 h-5 p-0 bg-transparent border-none font-mono text-[11px] text-right focus-visible:ring-0 ${highlightWidth ? 'text-black' : 'text-white'}`}
                />
                <span className="font-mono text-[11px]">°</span>
              </div>
            </div>
            <Slider value={[peakWidth]} onValueChange={(v) => onPeakWidthChange(v[0])} min={0.1} max={0.5} step={0.001} />
            {highlightWidth && <p className="text-[9px] text-emerald-400 font-mono mt-2 animate-pulse">Updated by AI</p>}
          </div>

          {/* Intensity Section */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
            <div className="flex justify-between items-center mb-4">
              <Label className="text-emerald-400 font-mono text-[10px] uppercase tracking-wider">Intensity</Label>
              <div className="bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                <Input
                  type="number" value={peakHeight}
                  onChange={(e) => handleInput(e.target.value, onPeakHeightChange, 0, 1500)}
                  className="w-16 h-5 p-0 bg-transparent border-none text-white font-mono text-[11px] text-center focus-visible:ring-0"
                />
              </div>
            </div>
            <Slider value={[peakHeight]} onValueChange={(v) => onPeakHeightChange(v[0])} min={100} max={1000} step={10} />
          </div>
        </div>
      </div>
    </div>
  );
}
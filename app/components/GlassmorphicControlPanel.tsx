import React from 'react';
import { Slider } from './ui/slider';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

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
}

export function GlassmorphicControlPanel({
  peakPosition,
  peakWidth,
  peakHeight,
  currentTemp,
  onPeakPositionChange,
  onPeakWidthChange,
  onPeakHeightChange,
  onTemperatureChange,
  autoSyncEnabled,
  onAutoSyncToggle,
}: GlassmorphicControlPanelProps) {
  return (
    <div className="w-80 bg-gradient-to-br from-zinc-900/80 to-zinc-950/80 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 pointer-events-none"></div>

      <div className="relative z-10">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-white font-mono tracking-wide">CONTROL PANEL</h3>
          <p className="text-zinc-400 text-xs font-mono mt-1">XRD Parameter Configuration</p>
        </div>

        {/* Mode Switch */}
        <div className="mb-6 p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-white font-mono text-sm">
                {autoSyncEnabled ? 'Inverse Mode' : 'Forward Mode'}
              </Label>
              <p className="text-zinc-500 text-xs mt-1">
                {autoSyncEnabled ? 'Simulate XRD from Temp' : 'Predict Temp from XRD'}
              </p>
            </div>
            <Switch
              checked={autoSyncEnabled}
              onCheckedChange={onAutoSyncToggle}
              className="data-[state=checked]:bg-cyan-500"
            />
          </div>
        </div>

        {/* Temperature Simulation Slider (Inverse Mode) */}
        {autoSyncEnabled && (
          <div className="mb-8 p-4 bg-cyan-500/10 rounded-xl border border-cyan-500/30 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-cyan-400 font-mono text-sm font-bold">Target Temp</Label>
              <span className="text-white font-mono text-xs bg-cyan-500/30 px-2 py-0.5 rounded border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                {currentTemp.toFixed(1)}°C
              </span>
            </div>
            <Slider
              value={[currentTemp]}
              onValueChange={(v) => onTemperatureChange(v[0])}
              min={25}
              max={400}
              step={1}
            />
          </div>
        )}

        {/* Physical Sliders (Disabled when Auto-Sync is ON) */}
        <div className={`space-y-6 ${autoSyncEnabled ? 'opacity-40 pointer-events-none' : ''}`}>

          {/* Peak Position */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
              <div className="flex justify-between items-center mb-3">
              <Label className="text-cyan-400 font-mono text-xs uppercase">Position (2θ)</Label>
              <span className="text-white font-mono text-[10px] bg-cyan-500/20 px-2 py-0.5 rounded border border-cyan-500/30">
                {peakPosition.toFixed(3)}°
              </span>
            </div>
            <Slider
              value={[peakPosition]}
              onValueChange={(v) => onPeakPositionChange(v[0])}
              min={25.0} max={26.5} step={0.001}
            />
          </div>

          {/* FWHM */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
            <div className="flex justify-between items-center mb-3">
              <Label className="text-purple-400 font-mono text-xs uppercase">FWHM (Width)</Label>
              <span className="text-white font-mono text-[10px] bg-purple-500/20 px-2 py-0.5 rounded border border-purple-500/30">
                {peakWidth.toFixed(3)}
              </span>
            </div>
            <Slider
              value={[peakWidth]}
              onValueChange={(v) => onPeakWidthChange(v[0])}
              min={0.1} max={0.5} step={0.005}
            />
          </div>

          {/* Intensity Badge & Slider */}
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
            <div className="flex justify-between items-center mb-3">
              <Label className="text-emerald-400 font-mono text-xs uppercase">Intensity</Label>
              <span className="text-white font-mono text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                {peakHeight.toFixed(0)}
              </span>
            </div>
            <Slider
              value={[peakHeight]}
              onValueChange={(v) => onPeakHeightChange(v[0])}
              min={100} max={1000} step={10}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
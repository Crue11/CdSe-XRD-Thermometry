import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from 'recharts';

interface InteractiveGraphProps {
  peakPosition: number;
  peakWidth: number;
  peakHeight: number;
  predictedTemp: number;
}

export function InteractiveGraph({ peakPosition, peakWidth, peakHeight, predictedTemp }: InteractiveGraphProps) {
  // 1. HYBRID X-AXIS: Snaps to nearest 0.5 for stability
  const xBuffer = 0.75;
  const xMin = Math.floor((peakPosition - xBuffer) * 2) / 2;
  const xMax = Math.ceil((peakPosition + xBuffer) * 2) / 2;

  // 2. STEPPED Y-AXIS LOGIC & INDICATOR
  let yMax = 300;
  let rangeStatus = "Low Range (0-300)";
  let statusColor = "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";

  if (peakHeight > 500) {
    yMax = 1000;
    rangeStatus = "Full Scale (0-1000)";
    statusColor = "text-red-400 border-red-500/30 bg-red-500/10";
  } else if (peakHeight > 300) {
    yMax = 500;
    rangeStatus = "Mid Range (0-500)";
    statusColor = "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  }

  const generateGaussianData = () => {
    const data = [];
    const numPoints = 200;
    const step = (xMax - xMin) / numPoints;

    for (let i = 0; i <= numPoints; i++) {
      const x = xMin + i * step;
      const sigma = peakWidth / 2.355;
      const intensity = peakHeight * Math.exp(-Math.pow(x - peakPosition, 2) / (2 * Math.pow(sigma, 2)));

      data.push({
        twoTheta: x,
        intensity: intensity,
        temperature: predictedTemp,
      });
    }
    return data;
  };

  const data = generateGaussianData();

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-900/95 border border-cyan-500/50 px-4 py-2 rounded-lg shadow-2xl backdrop-blur-sm">
          <p className="text-cyan-400 font-mono text-sm">
            Predicted Temp: <span className="text-white font-bold">{payload[0].payload.temperature}°C</span>
          </p>
          <p className="text-zinc-400 font-mono text-xs mt-1">
            2θ: {payload[0].payload.twoTheta.toFixed(2)}°
          </p>
          <p className="text-zinc-400 font-mono text-xs">
            Intensity: {payload[0].payload.intensity.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-6 relative overflow-hidden">
      {/* Oscilloscope-style background */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="w-full h-full" style={{
          backgroundImage: 'radial-gradient(circle, #22d3ee 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }}></div>
      </div>
      
      {/* Title */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-cyan-400 font-mono tracking-wider">
          X-RAY DIFFRACTION ANALYSIS
        </h2>
        <p className="text-zinc-500 text-sm font-mono mt-1">
          Interactive Scientific Coordinate System
        </p>
      </div>

      {/* RANGE INDICATOR BADGE */}
      <div className={`absolute top-10 right-6 z-20 px-3 py-1 rounded-full border text-[10px] font-mono uppercase tracking-tighter ${statusColor}`}>
        {rangeStatus}
      </div>

      {/* Graph */}
      <div className="h-[500px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 40 }}
          >
            {/* Oscilloscope-style grid */}
            <CartesianGrid
              strokeDasharray="0"
              stroke="#164e63"
              strokeWidth={1}
              strokeOpacity={0.5}
              horizontal={true}
              vertical={true}
            />
            
            {/* Axes */}
            <XAxis
              dataKey="twoTheta"
              type="number"
              domain={[xMin, xMax]}
              allowDataOverflow={true}
              stroke="#22d3ee"
              tick={{ fill: '#22d3ee', fontFamily: 'monospace', fontSize: 12 }}
              tickFormatter={(val) => val.toFixed(2)}
              label={{
                value: '2θ (degrees)',
                position: 'insideBottom',
                offset: -10,
                fill: '#22d3ee',
                fontFamily: 'monospace',
                fontSize: 14,
                fontWeight: 'bold',
              }}
            />
            <YAxis
              stroke="#22d3ee"
              domain={[0, yMax]}
              strokeWidth={2}
              tickFormatter={(val) => val.toFixed(0)}
              tick={{ fill: '#22d3ee', fontFamily: 'monospace', fontSize: 12 }}
              label={{
                value: 'Intensity (a.u.)',
                angle: -90,
                position: 'insideLeft',
                fill: '#22d3ee',
                fontFamily: 'monospace',
                fontSize: 14,
                fontWeight: 'bold',
              }}
            />
            
            {/* Semi-transparent interactive zone (area under curve) */}
            <Area
              type="monotone"
              dataKey="intensity"
              fill="url(#colorGradient)"
              stroke="none"
              fillOpacity={0.3}
            />
            
            {/* Main Gaussian peak line */}
            <Line
              type="monotone"
              dataKey="intensity"
              stroke="#06b6d4"
              strokeWidth={4}
              dot={false}
              isAnimationActive={false}
              activeDot={{
                r: 6,
                fill: '#22d3ee',
                stroke: '#fff',
                strokeWidth: 2,
                filter: 'drop-shadow(0 0 8px #22d3ee)',
              }}
            />
            
            {/* Custom tooltip */}
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: '#22d3ee',
                strokeWidth: 1,
                strokeDasharray: '5 5',
              }}
            />
            
            {/* Gradient definition */}
            <defs>
              <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Oscilloscope-style corner decorations */}
      <div className="absolute top-4 right-4 flex gap-2">
        <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" style={{ animationDelay: '0.5s' }}></div>
        <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>
    </div>
  );
}

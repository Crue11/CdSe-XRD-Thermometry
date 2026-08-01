import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ScanPoint, SignaturePeak } from '../lib/api';

/**
 * Pseudo-Voigt profile at unit height, matching the simulator's peak shape
 * (eta * Lorentzian + (1 - eta) * Gaussian).
 */
function pseudoVoigt(x: number, center: number, fwhm: number, eta = 0.5): number {
  const t = (x - center) / fwhm;
  const gaussian = Math.exp(-4 * Math.LN2 * t * t);
  const lorentzian = 1 / (1 + 4 * t * t);
  return eta * lorentzian + (1 - eta) * gaussian;
}

/**
 * Build a displayable pattern from the six target reflections.
 *
 * Heights arrive as relative intensity attenuated by the Debye-Waller factor,
 * so scaling by a constant 100 (rather than normalising per curve) keeps the
 * thermal intensity loss visible as the temperature changes.
 */
export function synthesizePattern(
  peaks: SignaturePeak[],
  range: [number, number],
  step = 0.04,
): ScanPoint[] {
  const points: ScanPoint[] = [];
  for (let x = range[0]; x <= range[1]; x += step) {
    let intensity = 0;
    for (const peak of peaks) {
      intensity += peak.height * 100 * pseudoVoigt(x, peak.position, peak.fwhm);
    }
    points.push({ twoTheta: x, intensity });
  }
  return points;
}

interface XRDPatternGraphProps {
  data: ScanPoint[];
  title: string;
  subtitle?: string;
  /** Vertical markers, e.g. the six fitted reflections. */
  markers?: { position: number; label: string }[];
  yLabel?: string;
  height?: number;
  /** Fix the y-domain so intensity changes are comparable across renders. */
  yMax?: number;
}

export function XRDPatternGraph({
  data,
  title,
  subtitle,
  markers = [],
  yLabel = 'Intensity (a.u.)',
  height = 460,
  yMax,
}: XRDPatternGraphProps) {
  const xMin = data.length ? data[0].twoTheta : 20;
  const xMax = data.length ? data[data.length - 1].twoTheta : 80;

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload as ScanPoint;
    return (
      <div className="bg-zinc-900/95 border border-cyan-500/50 px-4 py-2 rounded-lg shadow-2xl backdrop-blur-sm">
        <p className="text-cyan-400 font-mono text-xs">
          2θ: <span className="text-white font-bold">{point.twoTheta.toFixed(3)}°</span>
        </p>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          Intensity: {point.intensity.toFixed(1)}
        </p>
      </div>
    );
  };

  return (
    <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-3xl p-6 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #22d3ee 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      <div className="mb-4">
        <h2 className="text-xl font-bold text-cyan-400 font-mono tracking-wider uppercase">{title}</h2>
        {subtitle && <p className="text-zinc-500 text-xs font-mono mt-1">{subtitle}</p>}
      </div>

      <div style={{ height }} className="relative">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
            <CartesianGrid stroke="#164e63" strokeWidth={1} strokeOpacity={0.4} />
            <XAxis
              dataKey="twoTheta"
              type="number"
              domain={[xMin, xMax]}
              allowDataOverflow
              stroke="#22d3ee"
              tick={{ fill: '#22d3ee', fontFamily: 'monospace', fontSize: 11 }}
              tickFormatter={(v) => v.toFixed(0)}
              label={{
                value: '2θ (degrees)',
                position: 'insideBottom',
                offset: -10,
                fill: '#22d3ee',
                fontFamily: 'monospace',
                fontSize: 13,
                fontWeight: 'bold',
              }}
            />
            <YAxis
              stroke="#22d3ee"
              domain={yMax ? [0, yMax] : [0, 'auto']}
              tick={{ fill: '#22d3ee', fontFamily: 'monospace', fontSize: 11 }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0))}
              label={{
                value: yLabel,
                angle: -90,
                position: 'insideLeft',
                fill: '#22d3ee',
                fontFamily: 'monospace',
                fontSize: 13,
                fontWeight: 'bold',
              }}
            />

            {markers.map((marker) => (
              <ReferenceLine
                key={marker.label}
                x={marker.position}
                stroke="#a855f7"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{
                  value: marker.label,
                  position: 'top',
                  fill: '#c084fc',
                  fontFamily: 'monospace',
                  fontSize: 10,
                }}
              />
            ))}

            <Area type="monotone" dataKey="intensity" fill="url(#patternGradient)" stroke="none" fillOpacity={0.35} />
            <Line
              type="monotone"
              dataKey="intensity"
              stroke="#06b6d4"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#22d3ee', strokeWidth: 1, strokeDasharray: '5 5' }} />

            <defs>
              <linearGradient id="patternGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Thermometer } from 'lucide-react';
import { Slider } from './ui/slider';
import { XRDPatternGraph, synthesizePattern } from './XRDPatternGraph';
import { fetchSignature, type Health, type SignatureResponse } from '../lib/api';

const REF_TEMPS = [25, 100, 200, 300, 400];

interface SignatureExplorerProps {
  health: Health | null;
}

/**
 * The reverse direction of the bidirectional design (report Section 4.4.2):
 * temperature in, expected XRD signature out.
 *
 * Deliberately one-way. Dialling a peak position by hand and reading back a
 * temperature would bypass the out-of-distribution safeguard entirely — there
 * is no scan to check a hand-built signature against.
 */
export function SignatureExplorer({ health }: SignatureExplorerProps) {
  const [minTemp, maxTemp] = health?.temperature_range_c ?? [25, 400];
  const [temp, setTemp] = useState(200);
  const [sizeNm, setSizeNm] = useState(25);
  const [strain, setStrain] = useState(0.002);
  const [signature, setSignature] = useState<SignatureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSignature(temp, sizeNm, strain)
      .then((data) => { if (!cancelled) { setSignature(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [temp, sizeNm, strain]);

  const pattern = useMemo(
    () => (signature ? synthesizePattern(signature.peaks, signature.two_theta_range) : []),
    [signature],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-in fade-in duration-500">
      <div className="flex-1 space-y-6 min-w-0">
        {error && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 font-mono text-xs">
            {error}
          </div>
        )}

        <XRDPatternGraph
          data={pattern}
          title="Expected signature at temperature"
          subtitle="Six wurtzite reflections from the physics model — lattice expansion, Debye-Waller attenuation, Caglioti and Williamson-Hall broadening"
          yLabel="Relative intensity"
          yMax={110}
          markers={signature?.peaks.map((p) => ({ position: p.position, label: p.hkl })) ?? []}
        />

        {signature && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PeakTable signature={signature} />
            <BidirectionalCheck signature={signature} />
          </div>
        )}
      </div>

      <aside className="w-full lg:w-[380px] shrink-0 bg-zinc-900/50 backdrop-blur-xl border border-zinc-700/50 rounded-3xl p-6 shadow-2xl h-fit space-y-8">
        <div>
          <h2 className="text-white font-mono font-bold uppercase tracking-widest text-sm">Signature Explorer</h2>
          <p className="text-zinc-500 font-mono text-[10px] mt-1">
            Temperature → expected XRD signature
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <span className="text-zinc-400 font-mono text-[10px] uppercase tracking-widest flex items-center gap-1.5">
              <Thermometer className="w-3 h-3" /> Temperature
            </span>
            <span className="text-cyan-400 font-mono text-2xl font-bold">
              {temp} <span className="text-sm">°C</span>
              {loading && <Loader2 className="inline w-3 h-3 ml-2 animate-spin text-zinc-500" />}
            </span>
          </div>
          <Slider
            value={[temp]}
            min={minTemp}
            max={maxTemp}
            step={1}
            onValueChange={([v]) => setTemp(v)}
          />
          <div className="flex justify-between">
            {REF_TEMPS.map((t) => (
              <button
                key={t}
                onClick={() => setTemp(t)}
                className={`font-mono text-[9px] transition-colors ${
                  Math.abs(temp - t) < 5 ? 'text-cyan-400' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                {t === 25 ? 'RT' : `${t}°`}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-6 space-y-6">
          <p className="text-zinc-500 font-mono text-[9px] uppercase tracking-widest">
            Microstructure (augmentation axes)
          </p>

          <LabelledSlider
            label="Crystallite size"
            value={sizeNm}
            display={`${sizeNm.toFixed(0)} nm`}
            min={10}
            max={50}
            step={1}
            onChange={setSizeNm}
          />
          <LabelledSlider
            label="Microstrain"
            value={strain}
            display={strain.toFixed(4)}
            min={0.0005}
            max={0.005}
            step={0.0001}
            onChange={setStrain}
          />
        </div>

        {signature && (
          <div className="border-t border-zinc-800 pt-6 space-y-2">
            <p className="text-zinc-500 font-mono text-[9px] uppercase tracking-widest mb-3">
              Unit cell at {signature.temperature} °C
            </p>
            <Readout label="a" value={`${signature.lattice.a.toFixed(4)} Å`} />
            <Readout label="c" value={`${signature.lattice.c.toFixed(4)} Å`} />
            <Readout label="Volume" value={`${signature.lattice.volume.toFixed(3)} Å³`} />
          </div>
        )}

        <p className="text-zinc-600 font-mono text-[9px] leading-relaxed border-t border-zinc-800 pt-4">
          This tab predicts a signature from a temperature. To go the other way — a temperature from
          a real measurement — upload the scan in the Analyser, where the out-of-distribution
          safeguard applies.
        </p>
      </aside>
    </div>
  );
}

function LabelledSlider({
  label, value, display, min, max, step, onChange,
}: {
  label: string; value: number; display: string;
  min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 font-mono text-[10px] uppercase tracking-widest">{label}</span>
        <span className="text-zinc-200 font-mono text-xs">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500 font-mono text-[10px]">{label}</span>
      <span className="text-zinc-200 font-mono text-xs">{value}</span>
    </div>
  );
}

function PeakTable({ signature }: { signature: SignatureResponse }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6">
      <h3 className="text-cyan-400 font-mono text-[10px] uppercase tracking-widest font-bold mb-4">
        Target reflections
      </h3>
      <table className="w-full text-left font-mono text-xs">
        <thead className="text-zinc-500 text-[9px] uppercase tracking-widest">
          <tr>
            <th className="pb-2">hkl</th>
            <th className="pb-2">2θ (°)</th>
            <th className="pb-2">FWHM (°)</th>
            <th className="pb-2">Rel. I</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {signature.peaks.map((peak) => (
            <tr key={peak.hkl} className="border-t border-zinc-900">
              <td className="py-2 text-white">{peak.hkl}</td>
              <td className="py-2 text-emerald-400">{peak.position.toFixed(3)}</td>
              <td className="py-2">{peak.fwhm.toFixed(4)}</td>
              <td className="py-2 text-zinc-400">{(peak.height * 100).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Physics inverse vs ML inverse. The report's central validation claim is that
 * these two agree; showing them side by side makes that checkable rather than
 * asserted.
 */
function BidirectionalCheck({ signature }: { signature: SignatureResponse }) {
  const ml = signature.ml_features;
  if (!ml) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6">
        <h3 className="text-purple-400 font-mono text-[10px] uppercase tracking-widest font-bold mb-4">
          Bidirectional check
        </h3>
        <p className="text-zinc-500 font-mono text-[11px] leading-relaxed">
          Inverse_ML.joblib is not loaded, so only the physics inverse is available. Add the trained
          inverse model to compare the two directions.
        </p>
      </div>
    );
  }

  const rows = signature.peaks
    .map((peak) => {
      const key = `peak_pos_${peak.hkl.replace(/[()]/g, '')}`;
      const mlValue = ml[key];
      if (mlValue === undefined) return null;
      return { hkl: peak.hkl, physics: peak.position, ml: mlValue, delta: Math.abs(mlValue - peak.position) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6">
      <h3 className="text-purple-400 font-mono text-[10px] uppercase tracking-widest font-bold mb-1">
        Bidirectional check
      </h3>
      <p className="text-zinc-600 font-mono text-[9px] mb-4">
        Physics inverse vs trained ML inverse, peak position in degrees 2θ
      </p>
      <table className="w-full text-left font-mono text-xs">
        <thead className="text-zinc-500 text-[9px] uppercase tracking-widest">
          <tr>
            <th className="pb-2">hkl</th>
            <th className="pb-2">Physics</th>
            <th className="pb-2">ML</th>
            <th className="pb-2">Δ</th>
          </tr>
        </thead>
        <tbody className="text-zinc-300">
          {rows.map((row) => (
            <tr key={row.hkl} className="border-t border-zinc-900">
              <td className="py-2 text-white">{row.hkl}</td>
              <td className="py-2">{row.physics.toFixed(4)}</td>
              <td className="py-2">{row.ml.toFixed(4)}</td>
              <td className={`py-2 ${row.delta < 0.01 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {row.delta.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

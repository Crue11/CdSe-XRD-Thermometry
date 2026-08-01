import React, { useRef, useState } from 'react';
import {
  FileCode, Info, Loader2, Play, Search, Upload, X,
} from 'lucide-react';
import { Button } from './ui/button';
import { STATUS_STYLE, StatusBadge } from './StatusBadge';
import { XRDPatternGraph } from './XRDPatternGraph';
import { analyzeScans, type AnalysisResult, type Health } from '../lib/api';

interface ScanAnalyzerProps {
  health: Health | null;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  results: AnalysisResult[];
  setResults: React.Dispatch<React.SetStateAction<AnalysisResult[]>>;
  consoleLog: string[];
  setConsoleLog: React.Dispatch<React.SetStateAction<string[]>>;
  modelName: string;
  setModelName: (name: string) => void;
  onInspect: (result: AnalysisResult) => void;
}

export function ScanAnalyzer({
  health, files, setFiles, results, setResults,
  consoleLog, setConsoleLog, modelName, setModelName, onInspect,
}: ScanAnalyzerProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const log = (message: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setConsoleLog((prev) => [...prev, `[${stamp}] ${message}`]);
  };

  const addFiles = (incoming: File[]) => {
    const accepted = incoming.filter((f) => /\.(txt|csv|xy|dat|asc)$/i.test(f.name));
    const rejected = incoming.length - accepted.length;
    if (accepted.length) {
      setFiles((prev) => [...prev, ...accepted]);
      log(`> Queued ${accepted.length} scan${accepted.length === 1 ? '' : 's'}.`);
    }
    if (rejected) log(`> Ignored ${rejected} file(s): unsupported extension.`);
  };

  const runAnalysis = async () => {
    if (!files.length) return;
    setIsAnalyzing(true);
    setSelected(null);
    log(`> Extracting 13-feature signatures from ${files.length} scan(s) using ${modelName}...`);
    try {
      const data = await analyzeScans(files, modelName);
      setResults(data.results);
      const refused = data.results.filter((r) => r.status === 'out_of_distribution').length;
      const failed = data.results.filter((r) => r.status === 'error').length;
      log(`> Complete. ${data.results.length - refused - failed} predicted, ` +
          `${refused} withheld as out-of-distribution, ${failed} unreadable.`);
      if (refused) {
        log('> Withheld scans are outside the training manifold. Open the Inspector for details.');
      }
    } catch (err) {
      log(`> ERROR: ${err instanceof Error ? err.message : 'analysis failed'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const preview = selected !== null ? results[selected] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Stage 1 — upload */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 text-cyan-400 font-mono font-bold text-sm">1</div>
          <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">Upload scans</h2>
        </div>
        <p className="text-zinc-500 font-mono text-xs mb-6 ml-11">
          The 2-column export from your diffractometer — 2θ in degrees, intensity in counts.
          Header blocks are skipped automatically.
        </p>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            className={`xl:col-span-1 border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-zinc-800 hover:border-cyan-500/50'
            }`}
          >
            <Upload className="w-8 h-8 text-cyan-400 mb-2" />
            <p className="text-white font-mono text-[10px] font-bold text-center">DROP XRD FILES</p>
            <p className="text-zinc-600 font-mono text-[9px] mt-1">.txt .csv .xy .dat</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.csv,.xy,.dat,.asc"
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                e.target.value = '';
              }}
            />
          </div>

          <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 content-start">
            {files.length === 0 && (
              <p className="text-zinc-600 font-mono text-xs col-span-full self-center">
                No scans queued.
              </p>
            )}
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3 truncate">
                  <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-zinc-300 font-mono text-xs truncate">{file.name}</span>
                </div>
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-zinc-600 hover:text-red-400 shrink-0"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <ExampleScans
          onLoad={(loaded) => {
            setFiles((prev) => [...prev, ...loaded]);
            log(`> Loaded ${loaded.length} simulated example scan(s).`);
          }}
          onError={(message) => log(`> ERROR: ${message}`)}
        />

        <OperatingEnvelope health={health} />
      </section>

      {/* Stage 2 — run */}
      <section className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 text-emerald-400 font-mono font-bold text-sm">2</div>
            <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">Predict temperature</h2>
          </div>

          <label className="block">
            <span className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest">Model</span>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="mt-2 w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:border-cyan-500/50 outline-none"
            >
              {(health?.models ?? ['RandomForest']).map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === health?.default_model ? ' — recommended' : ''}
                  {m === health?.uncertainty_model
                    ? health?.uncertainty_validated === false
                      ? ' — uncertainty (unvalidated)'
                      : ' — reports uncertainty'
                    : ''}
                </option>
              ))}
            </select>
          </label>

          <Button
            onClick={runAnalysis}
            disabled={isAnalyzing || files.length === 0 || !health?.ready}
            className="w-full h-20 bg-gradient-to-r from-cyan-600 to-emerald-600 text-white font-mono font-bold text-base rounded-2xl disabled:opacity-40"
          >
            {isAnalyzing ? <Loader2 className="animate-spin mr-2" /> : <Play className="mr-2" />}
            {isAnalyzing ? 'ANALYSING...' : 'ANALYSE SCANS'}
          </Button>
        </div>

        <div className="bg-black border border-zinc-800 rounded-2xl p-4 h-64 overflow-y-auto font-mono text-[10px] text-emerald-500">
          {consoleLog.map((line, i) => (
            <div key={i} className="mb-1 break-words">{line}</div>
          ))}
        </div>
      </section>

      {/* Stage 3 — results */}
      {results.length > 0 && (
        <section className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6 animate-in fade-in duration-500">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/30 text-purple-400 font-mono font-bold text-sm">3</div>
            <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">Results</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-sm border-t border-zinc-900">
              <thead className="text-cyan-400 text-[10px] uppercase tracking-widest">
                <tr>
                  <th className="p-3">File</th>
                  <th className="p-3">Temperature</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Peaks</th>
                  <th className="p-3">Mahalanobis d</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {results.map((row, i) => {
                  const style = STATUS_STYLE[row.status];
                  return (
                    <tr
                      key={`${row.filename}-${i}`}
                      onClick={() => setSelected(i)}
                      className={`border-b border-zinc-900 cursor-pointer transition-colors ${
                        selected === i ? 'bg-zinc-900' : 'hover:bg-zinc-900/50'
                      }`}
                    >
                      <td className="p-3 text-white truncate max-w-[220px]">{row.filename}</td>
                      <td className="p-3">
                        {style.showsTemperature && row.T_predicted !== null ? (
                          <span className={`font-bold ${style.text}`}>
                            {row.T_predicted.toFixed(1)} °C
                            {row.T_uncertainty !== null && (
                              <span className="text-zinc-500 font-normal"> ± {row.T_uncertainty.toFixed(1)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-zinc-600 italic">withheld</span>
                        )}
                      </td>
                      <td className="p-3"><StatusBadge status={row.status} /></td>
                      <td className="p-3 text-zinc-400">
                        {row.quality_report ? `${row.quality_report.n_peaks_fitted}/6` : '—'}
                      </td>
                      <td className="p-3 text-zinc-400">
                        {row.ood_distance !== null ? row.ood_distance.toFixed(2) : '—'}
                      </td>
                      <td className="p-3">
                        {row.features && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onInspect(row); }}
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[10px] uppercase tracking-widest"
                          >
                            <Search className="w-3 h-3" /> Inspect
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {results.some((r) => r.status !== 'ok') && (
            <div className="space-y-3">
              {results
                .filter((r) => r.status !== 'ok')
                .map((row, i) => {
                  const style = STATUS_STYLE[row.status];
                  return (
                    <div
                      key={`${row.filename}-detail-${i}`}
                      className={`rounded-2xl border p-4 ${style.border} ${style.bg}`}
                    >
                      <p className={`font-mono text-xs font-bold ${style.text}`}>{row.filename}</p>
                      <p className="text-zinc-300 font-mono text-[11px] mt-1 leading-relaxed">
                        {row.status_detail}
                      </p>
                    </div>
                  );
                })}
            </div>
          )}

          {preview?.scan && (
            <XRDPatternGraph
              data={preview.scan.preview}
              title={`Scan — ${preview.filename}`}
              subtitle={`${preview.scan.n_points} points, ${preview.scan.two_theta_min}–${preview.scan.two_theta_max}° 2θ, step ${preview.scan.step}°`}
              markers={
                preview.features
                  ? (['100', '002', '101', '110', '103', '112'] as const)
                      .map((tag) => ({
                        position: preview.features?.[`peak_pos_${tag}`] ?? NaN,
                        label: `(${tag})`,
                      }))
                      .filter((m) => Number.isFinite(m.position))
                  : []
              }
              height={360}
            />
          )}
        </section>
      )}
    </div>
  );
}

const EXAMPLE_SCANS = [
  { file: 'simulated_CdSe_150C.txt', label: '150 °C' },
  { file: 'simulated_CdSe_320C.txt', label: '320 °C' },
];

/**
 * Lets someone without a diffractometer see the tool work. These are patterns
 * from the forward simulator at two of the report's held-out test
 * temperatures, not laboratory measurements — the labelling says so, because a
 * simulated scan mistaken for real data would misrepresent what the system has
 * actually been validated against.
 */
function ExampleScans({
  onLoad, onError,
}: { onLoad: (files: File[]) => void; onError: (message: string) => void }) {
  const [loading, setLoading] = useState(false);

  const load = async (name: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      if (!response.ok) throw new Error(`could not load ${name}`);
      const text = await response.text();
      onLoad([new File([text], name, { type: 'text/plain' })]);
    } catch (err) {
      onError(err instanceof Error ? err.message : `could not load ${name}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <span className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest">
        No scan to hand?
      </span>
      {EXAMPLE_SCANS.map(({ file, label }) => (
        <button
          key={file}
          onClick={() => load(file)}
          disabled={loading}
          className="px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-cyan-500/50 hover:text-cyan-400 font-mono text-[10px] transition-colors disabled:opacity-40"
        >
          Simulated {label}
        </button>
      ))}
      <span className="text-zinc-600 font-mono text-[9px]">
        Generated by the forward physics model — not laboratory data.
      </span>
    </div>
  );
}

function OperatingEnvelope({ health }: { health: Health | null }) {
  const [min, max] = health?.temperature_range_c ?? [25, 400];
  return (
    <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Info className="w-4 h-4 text-cyan-400" />
        <h3 className="text-cyan-400 font-mono text-[10px] uppercase tracking-widest font-bold">
          When this system can return a temperature
        </h3>
      </div>
      <ul className="space-y-1.5 text-zinc-400 font-mono text-[11px] leading-relaxed list-disc list-inside">
        <li>
          The film must be crystallised enough to resolve at least three wurtzite reflections above
          the noise floor — the (100)/(002)/(101) triplet at 23–28° is sufficient.
        </li>
        <li>
          The scan must be taken <span className="text-zinc-200">in-situ, at the target temperature</span> —
          not ex-situ after the sample has cooled.
        </li>
        <li>
          Scan geometry must match the training simulator: {health?.scan_geometry ?? 'Cu-K-alpha, 20–80° 2θ, step 0.02°'}.
        </li>
        <li>
          Valid only over {min}–{max} °C. Anything outside that is extrapolation.
        </li>
      </ul>
      <p className="text-zinc-600 font-mono text-[10px] mt-3 leading-relaxed">
        Scans that fail these conditions are flagged out-of-distribution and no temperature is
        returned. That is the safeguard working, not a failure of the upload.
      </p>
    </div>
  );
}

import { AlertTriangle, FileSearch } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { AnalysisResult, TrainingStats } from '../lib/api';

interface SignatureInspectorProps {
  result: AnalysisResult | null;
  stats: TrainingStats | null;
}

/**
 * What the deployment README asks for on an out-of-distribution row: a way to
 * see the extracted signature and judge it by eye, instead of a bare refusal.
 */
export function SignatureInspector({ result, stats }: SignatureInspectorProps) {
  if (!result || !result.features) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-16 text-center animate-in fade-in duration-500">
        <FileSearch className="w-10 h-10 text-zinc-700 mx-auto mb-4" />
        <h2 className="text-white font-mono font-bold uppercase tracking-widest text-sm">
          No scan selected
        </h2>
        <p className="text-zinc-500 font-mono text-xs mt-2 max-w-md mx-auto leading-relaxed">
          Analyse a scan, then choose <span className="text-cyan-400">Inspect</span> on any result
          row to see its 13-feature signature against the training distribution.
        </p>
      </div>
    );
  }

  const threshold = stats?.ood_threshold ?? result.ood_distance ?? 0;
  const distance = result.ood_distance ?? 0;
  const ratio = threshold > 0 ? distance / threshold : 0;
  const quality = result.quality_report;

  const rows = (stats?.features ?? []).map((feature) => {
    const value = result.features?.[feature.name] ?? null;
    const z = value !== null && feature.std > 0 ? (value - feature.mean) / feature.std : null;
    return { ...feature, value, z };
  });
  const maxAbsZ = Math.max(1, ...rows.map((r) => Math.abs(r.z ?? 0)));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white font-mono tracking-wider truncate">
              {result.filename}
            </h2>
            <p className="text-zinc-500 font-mono text-xs mt-1">Extracted XRD signature</p>
          </div>
          <StatusBadge status={result.status} />
        </div>

        <p className="text-zinc-300 font-mono text-[11px] leading-relaxed mt-4 border-l-2 border-zinc-800 pl-4">
          {result.status_detail}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <Metric
            label="Mahalanobis distance"
            value={distance.toFixed(2)}
            detail={`threshold ${threshold.toFixed(2)} · ${ratio.toFixed(1)}× ${ratio > 1 ? 'over' : 'under'}`}
            tone={distance > threshold ? 'bad' : 'good'}
          />
          <Metric
            label="Peaks fitted"
            value={quality ? `${quality.n_peaks_fitted} / 6` : '—'}
            detail={quality?.degraded_fits.length ? `${quality.degraded_fits.length} degraded` : 'all clean'}
            tone={quality && quality.n_peaks_fitted >= 5 ? 'good' : 'warn'}
          />
          <Metric
            label="Williamson-Hall R²"
            value={quality?.wh_r2 !== null && quality?.wh_r2 !== undefined ? quality.wh_r2.toFixed(3) : '—'}
            detail="size/strain fit quality"
            tone="neutral"
          />
        </div>

        {quality && quality.degraded_fits.length > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <p className="text-yellow-400 font-mono text-[10px] uppercase tracking-widest font-bold flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> Degraded fits
            </p>
            <p className="text-zinc-400 font-mono text-[11px] mt-2">
              {quality.degraded_fits.join(' · ')}
            </p>
          </div>
        )}

        {result.any_feature_imputed && (
          <p className="text-zinc-500 font-mono text-[10px] mt-4">
            At least one feature could not be extracted and was filled with the training mean before
            scoring.
          </p>
        )}
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
        <h3 className="text-cyan-400 font-mono text-[10px] uppercase tracking-widest font-bold">
          Signature vs training distribution
        </h3>
        <p className="text-zinc-600 font-mono text-[10px] mt-1 mb-6 leading-relaxed">
          Deviation is a per-feature z-score against the training mean. The safeguard scores the
          full 13-dimensional covariance, so these bars indicate where a scan looks unusual — they
          are not an exact decomposition of the Mahalanobis distance.
        </p>

        {rows.length === 0 ? (
          <p className="text-zinc-500 font-mono text-xs">Training statistics unavailable.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead className="text-zinc-500 text-[9px] uppercase tracking-widest">
                <tr>
                  <th className="pb-3">Feature</th>
                  <th className="pb-3">This scan</th>
                  <th className="pb-3">Training mean</th>
                  <th className="pb-3 w-1/3">Deviation (σ)</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {rows.map((row) => {
                  const z = row.z;
                  const extreme = z !== null && Math.abs(z) > 3;
                  return (
                    <tr key={row.name} className="border-t border-zinc-900">
                      <td className="py-2.5 text-white whitespace-nowrap">{row.name}</td>
                      <td className={`py-2.5 ${extreme ? 'text-red-400' : 'text-emerald-400'}`}>
                        {row.value !== null ? row.value.toFixed(4) : '—'}
                      </td>
                      <td className="py-2.5 text-zinc-500">
                        {row.mean.toFixed(4)} <span className="text-zinc-700">± {row.std.toFixed(4)}</span>
                      </td>
                      <td className="py-2.5">
                        {z === null ? (
                          '—'
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-zinc-900 rounded-full overflow-hidden min-w-[60px]">
                              <div
                                className={`h-full rounded-full ${extreme ? 'bg-red-500' : 'bg-cyan-500'}`}
                                style={{ width: `${Math.min(100, (Math.abs(z) / maxAbsZ) * 100)}%` }}
                              />
                            </div>
                            <span className={`w-14 text-right ${extreme ? 'text-red-400' : 'text-zinc-400'}`}>
                              {z > 0 ? '+' : ''}{z.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label, value, detail, tone,
}: {
  label: string; value: string; detail: string; tone: 'good' | 'bad' | 'warn' | 'neutral';
}) {
  const toneClass = {
    good: 'text-emerald-400 border-emerald-500/30',
    bad: 'text-red-400 border-red-500/30',
    warn: 'text-yellow-400 border-yellow-500/30',
    neutral: 'text-zinc-300 border-zinc-800',
  }[tone];

  return (
    <div className={`rounded-2xl border bg-zinc-900/40 p-4 ${toneClass.split(' ')[1]}`}>
      <p className="text-zinc-500 font-mono text-[9px] uppercase tracking-widest">{label}</p>
      <p className={`font-mono text-2xl font-bold mt-1 ${toneClass.split(' ')[0]}`}>{value}</p>
      <p className="text-zinc-600 font-mono text-[10px] mt-1">{detail}</p>
    </div>
  );
}

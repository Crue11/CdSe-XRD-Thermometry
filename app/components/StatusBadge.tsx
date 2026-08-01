import { AlertTriangle, CheckCircle, ShieldAlert, XCircle } from 'lucide-react';
import type { AnalysisStatus } from '../lib/api';

/**
 * Presentation rules for the four service statuses. `out_of_distribution` and
 * `error` deliberately have no temperature to show — the service withheld it.
 */
export const STATUS_STYLE: Record<
  AnalysisStatus,
  { label: string; text: string; border: string; bg: string; showsTemperature: boolean }
> = {
  ok: {
    label: 'In distribution',
    text: 'text-emerald-400',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/10',
    showsTemperature: true,
  },
  degraded: {
    label: 'Degraded fit',
    text: 'text-yellow-400',
    border: 'border-yellow-500/40',
    bg: 'bg-yellow-500/10',
    showsTemperature: true,
  },
  out_of_distribution: {
    label: 'Out of distribution',
    text: 'text-red-400',
    border: 'border-red-500/40',
    bg: 'bg-red-500/10',
    showsTemperature: false,
  },
  error: {
    label: 'Unreadable file',
    text: 'text-zinc-400',
    border: 'border-zinc-700',
    bg: 'bg-zinc-800/50',
    showsTemperature: false,
  },
};

const ICON: Record<AnalysisStatus, typeof CheckCircle> = {
  ok: CheckCircle,
  degraded: AlertTriangle,
  out_of_distribution: ShieldAlert,
  error: XCircle,
};

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const style = STATUS_STYLE[status];
  const Icon = ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono uppercase tracking-tighter whitespace-nowrap ${style.text} ${style.border} ${style.bg}`}
    >
      <Icon className="w-3 h-3" />
      {style.label}
    </span>
  );
}

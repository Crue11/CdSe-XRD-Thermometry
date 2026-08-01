import { useEffect, useState } from 'react';
import { ScanAnalyzer } from './components/ScanAnalyzer';
import { SignatureExplorer } from './components/SignatureExplorer';
import { SignatureInspector } from './components/SignatureInspector';
import { TabNavigation, type TabId } from './components/TabNavigation';
import {
  fetchHealth, fetchTrainingStats,
  type AnalysisResult, type Health, type TrainingStats,
} from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('analyzer');
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [modelName, setModelName] = useState('RandomForest');

  // Analyser state lives here so it survives tab switches — the Inspector
  // reads the row the Analyser selected.
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [inspected, setInspected] = useState<AnalysisResult | null>(null);
  const [consoleLog, setConsoleLog] = useState<string[]>([
    '> System initialised.',
    '> Awaiting XRD scan upload...',
  ]);

  useEffect(() => {
    fetchHealth()
      .then((data) => {
        setHealth(data);
        if (data.ready && data.default_model) setModelName(data.default_model);
        if (data.ready) fetchTrainingStats().then(setStats).catch(() => setStats(null));
      })
      .catch(() =>
        setHealth({ ready: false, models: [], error: 'Backend unreachable.' }),
      );
  }, []);

  const inspect = (result: AnalysisResult) => {
    setInspected(result);
    setActiveTab('inspector');
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-bold text-white font-mono tracking-wider">
              CdSe X-Ray Diffraction Thermometry
            </h1>
            <p className="text-zinc-400 font-mono text-xs md:text-sm">
              Physics-informed temperature prediction with an out-of-distribution safeguard
            </p>
          </div>
          <ServiceStatus health={health} />
        </header>

        {health && !health.ready && (
          <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-5">
            <p className="text-red-400 font-mono text-xs font-bold uppercase tracking-widest">
              Thermometry service unavailable
            </p>
            <p className="text-zinc-300 font-mono text-[11px] mt-2">{health.error}</p>
            {health.hint && (
              <p className="text-zinc-500 font-mono text-[11px] mt-2">{health.hint}</p>
            )}
          </div>
        )}

        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="mt-8">
          {activeTab === 'analyzer' && (
            <ScanAnalyzer
              health={health}
              files={files}
              setFiles={setFiles}
              results={results}
              setResults={setResults}
              consoleLog={consoleLog}
              setConsoleLog={setConsoleLog}
              modelName={modelName}
              setModelName={setModelName}
              onInspect={inspect}
            />
          )}
          {activeTab === 'explorer' && <SignatureExplorer health={health} />}
          {activeTab === 'inspector' && <SignatureInspector result={inspected} stats={stats} />}
        </main>
      </div>
    </div>
  );
}

function ServiceStatus({ health }: { health: Health | null }) {
  if (!health) {
    return <span className="text-zinc-600 font-mono text-[10px]">connecting…</span>;
  }
  if (!health.ready) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 font-mono text-[10px] uppercase tracking-widest">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Offline
      </span>
    );
  }
  return (
    <div className="text-right">
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-mono text-[10px] uppercase tracking-widest">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {health.models.length} models
      </span>
      <p className="text-zinc-600 font-mono text-[9px] mt-1.5">
        {health.n_features} features · OOD threshold {health.ood_threshold}
      </p>
    </div>
  );
}

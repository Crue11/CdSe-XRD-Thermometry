import { FileSearch, LineChart, Upload } from 'lucide-react';

export type TabId = 'analyzer' | 'explorer' | 'inspector';

const TABS: { id: TabId; label: string; icon: typeof Upload; active: string }[] = [
  {
    id: 'analyzer',
    label: 'Analyser',
    icon: Upload,
    active: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/30',
  },
  {
    id: 'explorer',
    label: 'Signature Explorer',
    icon: LineChart,
    active: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30',
  },
  {
    id: 'inspector',
    label: 'Inspector',
    icon: FileSearch,
    active: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30',
  },
];

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex gap-2 bg-zinc-900/50 backdrop-blur-sm p-2 rounded-2xl border border-zinc-700/50 shadow-xl">
      {TABS.map(({ id, label, icon: Icon, active }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-mono font-bold text-sm transition-all duration-300 ${
            activeTab === id ? active : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

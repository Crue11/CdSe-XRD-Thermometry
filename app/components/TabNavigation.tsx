import React from 'react';
import { LineChart, Calculator } from 'lucide-react';

interface TabNavigationProps {
  activeTab: 'predictor' | 'fwhm';
  onTabChange: (tab: 'predictor' | 'fwhm') => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex gap-2 bg-zinc-900/50 backdrop-blur-sm p-2 rounded-2xl border border-zinc-700/50 shadow-xl">
      {/* Temperature Predictor Tab */}
      <button
        onClick={() => onTabChange('predictor')}
        className={`
          flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-mono font-bold text-sm transition-all duration-300
          ${
            activeTab === 'predictor'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }
        `}
      >
        <LineChart className="w-4 h-4" />
        <span>Temperature Predictor</span>
      </button>

      {/* FWHM Estimator Tab */}
      <button
        onClick={() => onTabChange('fwhm')}
        className={`
          flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-mono font-bold text-sm transition-all duration-300
          ${
            activeTab === 'fwhm'
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }
        `}
      >
        <Calculator className="w-4 h-4" />
        <span>FWHM Estimator</span>
      </button>
    </div>
  );
}

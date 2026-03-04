import React, { useState, useRef } from 'react';
import {
  Upload, FileText, CheckCircle, Play, ArrowRight,
  Database, Cpu, Zap, Terminal as TerminalIcon, Loader2,
  Download, X, FileCode, FlaskConical
} from 'lucide-react';
import { Button } from './ui/button';

interface DatasetFactoryProps {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  consoleLog: string[];
  setConsoleLog: React.Dispatch<React.SetStateAction<string[]>>;
  extractedData: ExtractedData[];
  setExtractedData: React.Dispatch<React.SetStateAction<ExtractedData[]>>;
  onCalibrationComplete: () => void;
}

interface ExtractedData {
  sampleTemp: string;
  peakPosition: string;
  intensity: string;
  fwhm: string;
  raw?: any;
}

export function DatasetFactory({
  files,
  setFiles,
  consoleLog,
  setConsoleLog,
  extractedData,
  setExtractedData,
  onCalibrationComplete
}: DatasetFactoryProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false); // New state to track if training is done
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addConsoleLog = (message: string) => {
    setConsoleLog(prev => [...prev, `[${new Date().toLocaleTimeString([], { hour12: false })}] ${message}`]);
  };

  const handleFiles = (incomingFiles: File[]) => {
    const validFiles = incomingFiles.filter(f => f.name.endsWith('.txt') || f.name.endsWith('.csv'));
    setFiles(prev => [...prev, ...validFiles]);
    addConsoleLog(`> DNA Intake: Added ${validFiles.length} files.`);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    addConsoleLog(`> DNA Intake: Removed file index ${index}`);
  };

  const startExtraction = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    addConsoleLog('> INITIALIZING PHENO-ENGINE...');

    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    try {
      const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${BASE_URL}/process-batch`, { method: 'POST', body: formData });
      if (!response.ok) throw new Error();
      const data = await response.json();

      const formattedData = data.results.map((res: any) => ({
        sampleTemp: res.Temperature === 25 ? 'RT' : `${res.Temperature}°C`,
        peakPosition: `${res.Peak_Position.toFixed(4)}°`,
        intensity: `${res.Peak_Intensity.toFixed(1)}`,
        fwhm: `${res.FWHM.toFixed(4)}°`,
        raw: res
      }));

      addConsoleLog('> Extraction complete. Dataset generated.');
      setExtractedData(formattedData);
    } catch (err) {
      addConsoleLog('> ERROR: Extraction failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Stage 3 Button 1: Perform the Math
  const handleAugmentOnly = async () => {
    setIsCalibrating(true);
    addConsoleLog('> STARTING AUGMENTATION...');

    try {
      const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${BASE_URL}/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedData.map(d => d.raw)),
      });

      if (!response.ok) throw new Error();
      addConsoleLog('> 500 Samples generated. Random Forest calibrated.');
      setIsCalibrated(true);
    } catch (err) {
      addConsoleLog('> ERROR: Calibration failed.');
    } finally {
      setIsCalibrating(false);
    }
  };

  // FIXED: Changed endpoints to match your backend routes
  const handleDownload = (type: 'phenotypes' | 'augmented') => {
    const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
    const endpoint = type === 'phenotypes' ? '/download-phenotypes' : '/download-augmented';
    window.open(`${BASE_URL}${endpoint}`, '_blank');
  };

  return (
    <div className="min-h-screen w-full bg-[#09090b] p-6 pb-20">
      <div className="max-w-[1400px] mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white font-mono tracking-wider">DATASET FACTORY</h1>
            <p className="text-zinc-500 font-mono text-sm mt-2">Automated Peak Extraction & Dataset Generation</p>
          </div>
          <Database className="w-12 h-12 text-cyan-500 opacity-50" />
        </div>

        {/* Stage 1: DNA Intake */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 text-cyan-400 font-mono font-bold text-sm">1</div>
            <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">DNA Intake</h2>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="xl:col-span-1 border-2 border-dashed border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center hover:border-cyan-500/50 cursor-pointer transition-all"
            >
              <Upload className="w-8 h-8 text-cyan-400 mb-2" />
              <p className="text-white font-mono text-[10px] font-bold">DRAG XRD FILES</p>
              <input ref={fileInputRef} type="file" multiple accept=".txt,.csv" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
            </div>

            <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {files.map((file, i) => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center justify-between group">
                  <div className="flex items-center gap-3 truncate">
                    <FileCode className="w-4 h-4 text-cyan-400" />
                    <span className="text-zinc-300 font-mono text-xs truncate">{file.name}</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-zinc-600 hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stage 2: Pheno Engine */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl grid grid-cols-1 lg:grid-cols-2 gap-8">
           <div className="space-y-6">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 text-emerald-400 font-mono font-bold text-sm">2</div>
               <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">Pheno Engine</h2>
             </div>
             <Button
               onClick={startExtraction}
               disabled={isProcessing || files.length === 0}
               className="w-full h-24 bg-gradient-to-r from-cyan-600 to-emerald-600 text-white font-mono font-bold text-lg rounded-2xl"
             >
               {isProcessing ? <Loader2 className="animate-spin" /> : <Play className="mr-2" />}
               {isProcessing ? 'PROCESSING...' : 'ENGAGE EXTRACTION ENGINE'}
             </Button>
           </div>
           <div className="bg-black border border-zinc-800 rounded-2xl p-4 h-64 overflow-y-auto font-mono text-[10px] text-emerald-500 custom-scrollbar">
             {consoleLog.map((log, i) => <div key={i} className="mb-1">{log}</div>)}
           </div>
        </div>

        {/* Stage 3: Output & Deployment */}
        {extractedData.length > 0 && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/30 text-purple-400 font-mono font-bold text-sm">3</div>
                <h2 className="text-xl font-bold text-white font-mono uppercase tracking-widest">Output Refinery</h2>
              </div>
              <div className="flex gap-4">
                <Button
                  onClick={() => handleDownload('phenotypes')}
                  variant="outline"
                  className="border-zinc-700 text-zinc-400 text-xs font-mono hover:bg-zinc-800"
                >
                  <Download className="w-4 h-4 mr-2"/> PHENOTYPES.CSV
                </Button>

                <Button
                  onClick={() => handleDownload('augmented')}
                  disabled={!isCalibrated} // LOCKED until augmentation is done
                  variant="outline"
                  className={`text-xs font-mono transition-all ${
                    isCalibrated
                    ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
                    : 'border-zinc-800 text-zinc-700 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Download className="w-4 h-4 mr-2"/>
                  {isCalibrated ? 'AUGMENTED_ML.CSV' : 'AUGMENTED (LOCKED)'}
                </Button>
              </div>
            </div>

            <table className="w-full text-left font-mono text-sm border-t border-zinc-900">
              <thead className="text-cyan-400">
                <tr><th className="p-4">SAMPLE</th><th className="p-4">POSITION</th><th className="p-4">INTENSITY</th><th className="p-4">FWHM</th></tr>
              </thead>
              <tbody className="text-zinc-300">
                {extractedData.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                    <td className="p-4 font-bold text-white">{row.sampleTemp}</td>
                    <td className="p-4 text-emerald-400">{row.peakPosition}</td>
                    <td className="p-4">{row.intensity}</td>
                    <td className="p-4 text-cyan-400">{row.fwhm}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Separate Button 1: Calibrate */}
              <Button
                onClick={handleAugmentOnly}
                disabled={isCalibrating || isCalibrated}
                className={`h-16 font-mono font-bold rounded-2xl transition-all ${
                  isCalibrated
                  ? 'bg-zinc-800 text-emerald-500 border border-emerald-500/50 cursor-default'
                  : 'bg-zinc-900 border border-purple-500/50 hover:bg-purple-500/10 text-white'
                }`}
              >
                {isCalibrating ? <Loader2 className="animate-spin mr-2" /> : isCalibrated ? <CheckCircle className="mr-2" /> : <FlaskConical className="mr-2" />}
                {isCalibrating ? 'TRAINING...' : isCalibrated ? 'MODEL CALIBRATED' : '1. RUN AUGMENTATION & TRAINING'}
              </Button>

              {/* Separate Button 2: Activate Predictor */}
              <Button
                onClick={() => onCalibrationComplete()}
                disabled={!isCalibrated}
                className={`h-16 font-mono font-bold rounded-2xl transition-all ${
                  isCalibrated
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                  : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                }`}
              >
                <Zap className="mr-2" />
                2. ACTIVATE CALIBRATED PREDICTOR
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
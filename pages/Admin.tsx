import React from 'react';
import { AlertTriangle, PauseCircle, PlayCircle, Save } from 'lucide-react';

export const Admin: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold text-white border-l-4 border-red-500 pl-4">Restricted Access: Admin Console</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* System Status */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h2 className="text-lg font-bold text-white mb-4">Protocol Safety</h2>
          <div className="flex items-center justify-between bg-slate-950 p-4 rounded-lg border border-slate-800 mb-4">
            <span className="text-slate-400 text-sm">Emergency Stop</span>
            <div className="flex items-center gap-2">
              <span className="text-green-500 text-xs font-bold uppercase tracking-wider">Active</span>
              <button className="text-red-500 hover:text-red-400">
                <PauseCircle size={24} />
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">Pausing the protocol will suspend new entries and hold the treasury vault.</p>
        </div>

        {/* Fee Configuration */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h2 className="text-lg font-bold text-white mb-4">Fee Configuration</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase font-bold mb-1">Prize Pool Allocation (%)</label>
              <input type="number" defaultValue={80} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase font-bold mb-1">Treasury Allocation (%)</label>
              <input type="number" defaultValue={20} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white" />
            </div>
            <button className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded flex items-center justify-center gap-2">
              <Save size={16} /> Update Config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
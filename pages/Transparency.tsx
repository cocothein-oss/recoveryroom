import React, { useState, useEffect } from 'react';
import { ShieldCheck, ExternalLink, Database, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { dataService } from '../services/dataService';

interface RoundHistoryItem {
  roundId: number;
  winnerTicker: string;
  prizePoolSol: number;
  totalWinners: number;
  totalHoldings: number;
  completedAt: number;
  vrfResult: string | null;
  txSignature: string | null;
  participantCount: number;
  tokenCount: number;
}

export const Transparency: React.FC = () => {
  const [rounds, setRounds] = useState<RoundHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await dataService.getRoundHistory(50);
        setRounds(history);

        // Calculate winning token distribution for chart
        const tokenWins: Record<string, number> = {};
        history.forEach((round) => {
          if (round.winnerTicker) {
            tokenWins[round.winnerTicker] = (tokenWins[round.winnerTicker] || 0) + 1;
          }
        });

        // Convert to chart data and sort by wins
        const chartItems = Object.entries(tokenWins)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);

        setChartData(chartItems);
      } catch (error) {
        console.error('Error fetching round history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, []);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateSignature = (sig: string | null) => {
    if (!sig) return 'Pending...';
    return `${sig.slice(0, 4)}...${sig.slice(-4)}`;
  };

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">

      {/* Left Column: Proof Info */}
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-rehab-green/5 border border-rehab-green/20 p-6 rounded-xl">
          <div className="flex items-center space-x-3 mb-4 text-rehab-green">
            <ShieldCheck size={28} />
            <h2 className="text-xl font-bold">Provably Fair</h2>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            Our selection algorithm utilizes <span className="text-white font-bold">Switchboard VRF</span> (Verifiable Random Function) on the Solana blockchain.
          </p>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            This ensures that neither the developers nor the whales can influence the outcome of the hourly spin.
          </p>
          <a href="#" className="text-xs text-rehab-green hover:underline flex items-center gap-1">
            View Smart Contract <ExternalLink size={10} />
          </a>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Database size={16} /> Winning Token Distribution
          </h3>
          {chartData.length > 0 ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }}
                    itemStyle={{ color: '#10b981' }}
                    cursor={{fill: 'transparent'}}
                    formatter={(value: number) => [`${value} wins`, 'Count']}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                     {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill="#10b981" fillOpacity={0.8 - (index * 0.1)} />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
              {loading ? 'Loading...' : 'No data yet'}
            </div>
          )}
        </div>

        {/* Stats Summary */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-white font-bold mb-4">Statistics</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Total Rounds Completed</span>
              <span className="text-white font-mono">{rounds.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total SOL Distributed</span>
              <span className="text-rehab-green font-mono">
                {rounds.reduce((sum, r) => sum + r.prizePoolSol, 0).toFixed(4)} SOL
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Winners</span>
              <span className="text-white font-mono">
                {rounds.reduce((sum, r) => sum + r.totalWinners, 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: History Table */}
      <div className="lg:col-span-2">
        <h2 className="text-2xl font-bold text-white mb-6">Round History Log</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-rehab-green" size={32} />
            </div>
          ) : rounds.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Database size={48} className="mx-auto mb-4 opacity-50" />
              <p>No completed rounds yet</p>
              <p className="text-sm mt-2">Round history will appear here after the first spin</p>
            </div>
          ) : (
            <table className="w-full text-left">
               <thead className="bg-slate-950 text-slate-500 font-mono text-xs uppercase">
                <tr>
                  <th className="px-6 py-4">Round ID</th>
                  <th className="px-6 py-4">Winning Token</th>
                  <th className="px-6 py-4">Prize Pool</th>
                  <th className="px-6 py-4">Winners</th>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4 text-right">Proof</th>
                </tr>
              </thead>
               <tbody className="divide-y divide-slate-800 text-sm">
                 {rounds.map((round) => (
                   <tr key={round.roundId} className="hover:bg-slate-800/30 transition-colors">
                     <td className="px-6 py-4 font-mono text-slate-400">#{round.roundId}</td>
                     <td className="px-6 py-4 font-bold text-red-400">{round.winnerTicker}</td>
                     <td className="px-6 py-4 text-rehab-green font-mono font-bold">
                       {round.prizePoolSol > 0 ? `${round.prizePoolSol.toFixed(4)} SOL` : '-'}
                     </td>
                     <td className="px-6 py-4 text-white">{round.totalWinners}</td>
                     <td className="px-6 py-4 text-slate-400 text-xs">
                       {formatDate(round.completedAt)}
                     </td>
                     <td className="px-6 py-4 text-right">
                       {round.txSignature ? (
                         <a
                           href={`https://solscan.io/tx/${round.txSignature}`}
                           target="_blank"
                           rel="noopener noreferrer"
                           className="text-slate-500 hover:text-rehab-green inline-flex items-center gap-1 text-xs font-mono"
                         >
                           {truncateSignature(round.txSignature)} <ExternalLink size={10} />
                         </a>
                       ) : round.vrfResult ? (
                         <span className="text-slate-600 text-xs font-mono" title={round.vrfResult}>
                           VRF: {round.vrfResult.slice(0, 8)}...
                         </span>
                       ) : (
                         <span className="text-slate-600 text-xs">No transfer</span>
                       )}
                     </td>
                   </tr>
                 ))}
               </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
};

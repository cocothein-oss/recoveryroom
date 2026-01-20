import React, { useState, useEffect } from 'react';
import { Trophy, TrendingUp, Share2, Loader2, Users } from 'lucide-react';
import { dataService } from '../services/dataService';

interface LeaderboardEntry {
  walletAddress: string;
  totalWinningsSol: number;
  winCount: number;
  winStreak: number;
  lastWinTimestamp: number;
}

export const Leaderboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'comeback' | 'god'>('comeback');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      try {
        const data = await dataService.getLeaderboard(activeTab, 20);
        setEntries(data);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [activeTab]);

  const truncateWallet = (wallet: string) => {
    return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  };

  const getBadge = (rank: number, type: 'comeback' | 'god') => {
    if (rank === 1) {
      return type === 'comeback' ? 'RECOVERY KING' : 'LUCK GOD';
    } else if (rank <= 3) {
      return type === 'comeback' ? 'SURVIVOR' : 'BLESSED';
    }
    return 'PATIENT';
  };

  const getBadgeStyle = (rank: number) => {
    if (rank === 1) {
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    } else if (rank === 2) {
      return 'bg-slate-400/20 text-slate-300 border-slate-400/30';
    } else if (rank === 3) {
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    }
    return 'bg-slate-800 text-slate-300 border-slate-700';
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Patient Records</h1>
          <p className="text-slate-400 text-sm">Recognizing the most recovered and the luckiest.</p>
        </div>
        <button className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded font-bold text-sm hover:bg-slate-200 transition-colors">
          <Share2 size={16} /> Share Rank
        </button>
      </div>

      {/* Tabs - Only Comeback and God */}
      <div className="flex space-x-2 border-b border-slate-800">
        <TabButton
          active={activeTab === 'comeback'}
          onClick={() => setActiveTab('comeback')}
          icon={TrendingUp}
          label="Biggest Comeback"
        />
        <TabButton
          active={activeTab === 'god'}
          onClick={() => setActiveTab('god')}
          icon={Trophy}
          label="Luckiest God"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-rehab-green" size={32} />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <Users size={48} className="mx-auto mb-4 opacity-50" />
            <p>No winners yet</p>
            <p className="text-sm mt-2">Leaderboard will populate after rounds are completed</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-950 text-slate-500 font-mono text-xs uppercase">
              <tr>
                <th className="px-6 py-4">Rank</th>
                <th className="px-6 py-4">Patient ID</th>
                <th className="px-6 py-4">
                  {activeTab === 'comeback' ? 'Total Recovered' : 'Win Count'}
                </th>
                <th className="px-6 py-4 text-right">Badge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {entries.map((entry, index) => {
                const rank = index + 1;
                return (
                  <tr key={entry.walletAddress} className="hover:bg-slate-800/30 transition-colors group">
                    <td className="px-6 py-4 font-mono font-bold text-slate-400 group-hover:text-white">
                      {rank === 1 ? (
                        <span className="text-2xl">🥇</span>
                      ) : rank === 2 ? (
                        <span className="text-2xl">🥈</span>
                      ) : rank === 3 ? (
                        <span className="text-2xl">🥉</span>
                      ) : (
                        `#${rank}`
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-rehab-green">
                      {truncateWallet(entry.walletAddress)}
                    </td>
                    <td className="px-6 py-4 font-bold text-white">
                      {activeTab === 'comeback'
                        ? `${entry.totalWinningsSol.toFixed(4)} SOL`
                        : `${entry.winCount} Win${entry.winCount !== 1 ? 's' : ''}`
                      }
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold border ${getBadgeStyle(rank)}`}>
                        {getBadge(rank, activeTab)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const TabButton = ({ active, onClick, icon: Icon, label }: any) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-2 px-6 py-3 border-b-2 transition-colors ${
      active
        ? 'border-rehab-green text-rehab-green'
        : 'border-transparent text-slate-500 hover:text-slate-300'
    }`}
  >
    <Icon size={16} />
    <span className="font-bold text-sm uppercase tracking-wide">{label}</span>
  </button>
);

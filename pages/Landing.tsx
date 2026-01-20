// RFND v1.0.0 - Loss Recovery Protocol
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, TrendingUp, Users, Coins } from 'lucide-react';
import { AppRoute } from '../types';
import { Link } from 'react-router-dom';
import { dataService } from '../services/dataService';

interface PlatformStats {
  totalParticipants: number;
  totalWinners: number;
  totalSolDistributed: number;
  completedRounds: number;
  currentPotSol: number;
}

export const Landing: React.FC = () => {
  const [stats, setStats] = useState<PlatformStats>({
    totalParticipants: 0,
    totalWinners: 0,
    totalSolDistributed: 0,
    completedRounds: 0,
    currentPotSol: 0,
  });
  const [currentRound, setCurrentRound] = useState<number>(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const platformStats = await dataService.getPlatformStats();
        setStats(platformStats);

        // Also get current round
        const roundInfo = await dataService.getCurrentRound();
        if (roundInfo) {
          setCurrentRound(roundInfo.roundId);
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };

    fetchStats();

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center space-y-16 py-12">

      {/* Hero Section */}
      <section className="text-center space-y-6 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center space-x-2 bg-rehab-green/10 border border-rehab-green/30 rounded-full px-4 py-1 text-rehab-green text-xs font-mono uppercase tracking-wider mb-4"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rehab-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rehab-green"></span>
          </span>
          <span>Protocol Live • Round #{currentRound || '...'} Open</span>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500 tracking-tight"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.8 }}
        >
          Turn Your Red PnL <br />
          <span className="text-rehab-green drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]">Into Green Paydays</span>
        </motion.h1>

        <motion.p
          className="text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          RFND is the first loss recovery protocol for Solana degens.
          Scan your wallet for rugged tokens, submit your losses, and enter the hourly lottery pool.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <Link
            to={AppRoute.DASHBOARD}
            className="w-full sm:w-auto px-8 py-4 bg-rehab-green text-rehab-900 font-bold rounded-lg hover:bg-rehab-neon hover:shadow-[0_0_20px_rgba(52,211,153,0.4)] transition-all flex items-center justify-center space-x-2 text-lg uppercase tracking-wide"
          >
            <span>Connect to Recover</span>
            <ArrowRight size={20} />
          </Link>
          <button className="w-full sm:w-auto px-8 py-4 bg-slate-800 text-slate-200 font-bold rounded-lg border border-slate-700 hover:bg-slate-700 transition-all uppercase tracking-wide text-sm">
            Read Whitepaper
          </button>
        </motion.div>
      </section>

      {/* Live Stats Ticker */}
      <section className="w-full max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            label="Total SOL Distributed"
            value={`${stats.totalSolDistributed.toFixed(4)} SOL`}
            icon={Coins}
            color="text-yellow-400"
          />
          <StatCard
            label="Current Hourly Pot"
            value={`${stats.currentPotSol.toFixed(4)} SOL`}
            icon={TrendingUp}
            color="text-rehab-green"
            animate
          />
          <StatCard
            label="Total Users Participated"
            value={stats.totalParticipants.toLocaleString()}
            icon={Users}
            color="text-blue-400"
          />
        </div>
      </section>

      {/* Marquee - Recent Winners */}
      <div className="w-full bg-slate-950/50 border-y border-slate-800 py-3 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-24 h-full bg-gradient-to-r from-rehab-900 to-transparent z-10"></div>
        <div className="absolute top-0 right-0 w-24 h-full bg-gradient-to-l from-rehab-900 to-transparent z-10"></div>

        <div className="flex animate-marquee whitespace-nowrap space-x-12">
          {stats.completedRounds > 0 ? (
            <>
              <div className="flex items-center space-x-2 text-sm font-mono text-slate-400">
                <span className="text-rehab-green">{stats.completedRounds}</span>
                <span>rounds completed •</span>
                <span className="text-white font-bold">{stats.totalWinners}</span>
                <span>total winners •</span>
                <span className="text-rehab-green font-bold">{stats.totalSolDistributed.toFixed(4)} SOL</span>
                <span>distributed</span>
              </div>
              <div className="flex items-center space-x-2 text-sm font-mono text-slate-400">
                <span className="text-rehab-green">{stats.completedRounds}</span>
                <span>rounds completed •</span>
                <span className="text-white font-bold">{stats.totalWinners}</span>
                <span>total winners •</span>
                <span className="text-rehab-green font-bold">{stats.totalSolDistributed.toFixed(4)} SOL</span>
                <span>distributed</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center space-x-2 text-sm font-mono text-slate-400">
                <span className="text-rehab-green">Recovery Room</span>
                <span>is live! Connect your wallet to participate in the next round</span>
              </div>
              <div className="flex items-center space-x-2 text-sm font-mono text-slate-400">
                <span className="text-rehab-green">Recovery Room</span>
                <span>is live! Connect your wallet to participate in the next round</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* How it works */}
      <section className="max-w-5xl w-full pt-12">
        <h2 className="text-3xl font-bold text-center mb-12 text-white">How Treatment Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <StepCard
            step="01"
            title="Scan Diagnosis"
            desc="Plug in your wallet. The protocol scans your on-chain history to identify legit financial trauma, not skill issues."
          />
          <StepCard
            step="02"
            title="Submit Trauma"
            desc="Cast your bags into the pool. We use Square Root Weighting (Weight = √Entries) so whales can't bully the odds. It's math-based justice for your PTSD."
          />
          <StepCard
            step="03"
            title="Group Therapy Payout"
            desc="If the randomizer picks your ticker, the SOL pot is split among all victims. It's like group therapy, but you leave with cash instead of closure."
          />
        </div>
      </section>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color, animate }: any) => (
  <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl flex items-center space-x-4 hover:border-slate-700 transition-colors">
    <div className={`p-3 rounded-lg bg-slate-950 ${color}`}>
      <Icon size={24} className={animate ? 'animate-pulse' : ''} />
    </div>
    <div>
      <p className="text-slate-500 text-xs uppercase font-mono tracking-widest">{label}</p>
      <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
    </div>
  </div>
);

const StepCard = ({ step, title, desc }: any) => (
  <div className="relative group p-8 bg-slate-900/30 border border-slate-800 rounded-2xl hover:bg-slate-800/50 hover:border-rehab-green/30 transition-all duration-300">
    <div className="absolute top-4 right-4 text-4xl font-black text-slate-800 group-hover:text-rehab-green/10 transition-colors select-none">
      {step}
    </div>
    <h3 className="text-xl font-bold text-white mb-4 group-hover:text-rehab-green transition-colors">{title}</h3>
    <p className="text-slate-400 leading-relaxed text-sm">
      {desc}
    </p>
  </div>
);

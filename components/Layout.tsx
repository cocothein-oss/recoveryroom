import React from 'react';
import { Activity, Skull, Trophy, Lock, BarChart3, Menu, X, ExternalLink, LogOut, PieChart } from 'lucide-react';
import { AppRoute } from '../types';
import { Link, useLocation } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
  onConnect: () => void;
  onDisconnect: () => void;
  walletAddress: string | null;
}

const NavItem = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active: boolean }) => (
  <Link 
    to={to} 
    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-200 ${
      active 
        ? 'bg-rehab-green/10 text-rehab-green border border-rehab-green/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
        : 'text-slate-400 hover:text-white hover:bg-white/5'
    }`}
  >
    <Icon size={18} />
    <span className="font-mono text-sm tracking-wide uppercase">{label}</span>
  </Link>
);

export const Layout: React.FC<LayoutProps> = ({ children, onConnect, onDisconnect, walletAddress }) => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-rehab-900 grid-bg relative">
      {/* Decorative background pulse */}
      <div className="fixed top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-rehab-green to-transparent opacity-50 z-50"></div>
      
      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-rehab-green/20 bg-rehab-900/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo */}
            <div className="flex-shrink-0 flex items-center space-x-3 cursor-pointer">
              <div className="bg-rehab-green/20 p-2 rounded-full border border-rehab-green">
                <Activity className="text-rehab-green h-6 w-6 animate-pulse-slow" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg tracking-wider">RECOVERY<span className="text-rehab-green">ROOM</span></h1>
                <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">Solana Trauma Center</p>
              </div>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center space-x-2">
              <NavItem to={AppRoute.LANDING} icon={Activity} label="Home" active={location.pathname === AppRoute.LANDING} />
              <NavItem to={AppRoute.DASHBOARD} icon={Skull} label="Treatment" active={location.pathname === AppRoute.DASHBOARD} />
              <NavItem to={AppRoute.PORTFOLIO} icon={PieChart} label="Portfolio" active={location.pathname === AppRoute.PORTFOLIO} />
              <NavItem to={AppRoute.LEADERBOARD} icon={Trophy} label="Rankings" active={location.pathname === AppRoute.LEADERBOARD} />
              <NavItem to={AppRoute.TRANSPARENCY} icon={BarChart3} label="Proof" active={location.pathname === AppRoute.TRANSPARENCY} />
            </div>

            {/* Wallet / Action */}
            <div className="hidden md:flex items-center space-x-4">
              {walletAddress ? (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 rounded-full px-4 py-2">
                    <span className="text-sm text-slate-300 font-mono">{walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}</span>
                    <div className="h-2 w-2 rounded-full bg-rehab-green animate-pulse"></div>
                  </div>
                  <button
                    onClick={onDisconnect}
                    className="p-2 rounded-full bg-slate-950 border border-slate-800 text-slate-400 hover:text-rehab-alert hover:border-rehab-alert/50 transition-all duration-200"
                    title="Disconnect wallet"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={onConnect}
                  className="bg-rehab-green text-rehab-900 font-bold px-6 py-2 rounded-md hover:bg-rehab-neon hover:shadow-[0_0_15px_rgba(52,211,153,0.5)] transition-all duration-200 flex items-center space-x-2 text-sm uppercase tracking-wide"
                >
                  <span>Connect</span>
                  <ExternalLink size={14} />
                </button>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-slate-300 hover:text-white">
                {mobileMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-rehab-900 border-b border-rehab-green/20">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              <NavItem to={AppRoute.LANDING} icon={Activity} label="Home" active={location.pathname === AppRoute.LANDING} />
              <NavItem to={AppRoute.DASHBOARD} icon={Skull} label="Treatment Area" active={location.pathname === AppRoute.DASHBOARD} />
              <NavItem to={AppRoute.PORTFOLIO} icon={PieChart} label="Portfolio" active={location.pathname === AppRoute.PORTFOLIO} />
              <NavItem to={AppRoute.LEADERBOARD} icon={Trophy} label="Rankings" active={location.pathname === AppRoute.LEADERBOARD} />
              <div className="pt-4 px-4">
                {walletAddress ? (
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-slate-950 border border-slate-800 text-slate-300 font-mono py-3 px-4 rounded-md text-sm text-center">
                      {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                    </div>
                    <button
                      onClick={() => { onDisconnect(); setMobileMenuOpen(false); }}
                      className="bg-slate-950 border border-slate-800 text-slate-400 hover:text-rehab-alert p-3 rounded-md"
                    >
                      <LogOut size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { onConnect(); setMobileMenuOpen(false); }}
                    className="w-full bg-rehab-green/10 border border-rehab-green text-rehab-green font-bold py-3 rounded-md uppercase text-sm"
                  >
                    Connect Wallet
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-rehab-900 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-600 text-xs font-mono uppercase tracking-widest">
            The Recovery Room &copy; 2024. Not financial advice. Just vibes & healing.
          </p>
          <div className="mt-2 flex justify-center space-x-4 text-slate-700 text-xs">
            <Link to={AppRoute.ADMIN} className="hover:text-rehab-green flex items-center space-x-1">
              <Lock size={10} /> <span>Admin Access</span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
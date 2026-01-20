import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Leaderboard } from './pages/Leaderboard';
import { Transparency } from './pages/Transparency';
import { Admin } from './pages/Admin';
import { Portfolio } from './pages/Portfolio';
import { solanaService } from './services/solanaService';
import { UserProfile, AppRoute } from './types';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);

  const handleConnect = async () => {
    console.log('Connect button clicked!');
    try {
      console.log('Attempting to connect wallet...');
      const userProfile = await solanaService.connectWallet();
      console.log('Connected:', userProfile);
      setUser(userProfile);
    } catch (e) {
      console.error("Connection failed", e);
      alert('Connection failed: ' + (e as Error).message);
    }
  };

  const handleDisconnect = async () => {
    try {
      await solanaService.disconnect();
      setUser(null);
    } catch (e) {
      console.error("Disconnect failed", e);
    }
  };

  return (
    <HashRouter>
      <Layout
        walletAddress={user?.walletAddress || null}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      >
        <Routes>
          <Route path={AppRoute.LANDING} element={<Landing />} />
          <Route path={AppRoute.DASHBOARD} element={<Dashboard user={user} />} />
          <Route path={AppRoute.PORTFOLIO} element={<Portfolio user={user} />} />
          <Route path={AppRoute.LEADERBOARD} element={<Leaderboard />} />
          <Route path={AppRoute.TRANSPARENCY} element={<Transparency />} />
          <Route path={AppRoute.ADMIN} element={<Admin />} />
          <Route path="*" element={<Navigate to={AppRoute.LANDING} replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
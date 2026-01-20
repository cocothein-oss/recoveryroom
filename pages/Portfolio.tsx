import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, TrendingUp, TrendingDown, Wallet, BarChart3, AlertCircle, CheckCircle2, XCircle, Search } from 'lucide-react';
import { UserProfile } from '../types';
import { apiService, MoralisTokenBalance } from '../services/apiService';
import { rpcService, ParsedSwap } from '../services/rpcService';
import { TOKEN_ELIGIBILITY_CONFIG } from '../constants';

interface PortfolioProps {
  user: UserProfile | null;
}

interface TokenAnalysis {
  tokenAddress: string;
  symbol: string;
  name: string;
  logo?: string;
  // Buy data
  totalBought: number;
  totalBoughtUsd: number;
  avgEntryPrice: number;
  // Sell data
  totalSold: number;
  totalSoldUsd: number;
  // Current state
  currentHoldings: number;
  currentPrice: number;
  currentValueUsd: number;
  // PnL
  pnlUsd: number;
  pnlPercentage: number;
  isProfit: boolean;
  // Market data
  volume24h: number;
  // Eligibility
  isEligible: boolean;
  ineligibleReasons: string[];
}

export const Portfolio: React.FC<PortfolioProps> = ({ user }) => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'holdings' | 'losses' | 'profits'>('all');
  const [tokens, setTokens] = useState<TokenAnalysis[]>([]);
  const [rawData, setRawData] = useState<{
    swaps: ParsedSwap[];
    holdings: MoralisTokenBalance[];
  } | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // Custom wallet scanner
  const [customWallet, setCustomWallet] = useState('');
  const [scanningWallet, setScanningWallet] = useState<string | null>(null);

  const analyzePortfolio = async (walletToScan?: string) => {
    const targetWallet = walletToScan || user?.walletAddress;
    if (!targetWallet) return;

    setLoading(true);
    setProgress(null);
    setScanningWallet(targetWallet);
    try {
      // Fetch swaps from RPC and holdings from Moralis in parallel
      console.log('Starting portfolio analysis for:', targetWallet);

      // First get holdings (fast)
      const holdings = await apiService.fetchTokenBalances(targetWallet);
      console.log(`Found ${holdings.length} token holdings`);

      // Then get swaps from RPC (slower, with progress)
      const swaps = await rpcService.fetchAllSwaps(
        targetWallet,
        90,
        (current, total) => setProgress({ current, total })
      );

      setRawData({ swaps, holdings });

      // Create holdings map
      const holdingsMap = new Map<string, MoralisTokenBalance>();
      for (const h of holdings) {
        holdingsMap.set(h.mint, h);
      }

      // Aggregate swaps using RPC service
      const positions = rpcService.aggregateSwaps(swaps);
      console.log(`Aggregated ${positions.size} token positions`);

      // Get all unique token addresses (from swaps + holdings)
      const allTokenAddresses = new Set<string>();
      positions.forEach((_, addr) => allTokenAddresses.add(addr));
      holdingsMap.forEach((_, addr) => allTokenAddresses.add(addr));

      // Filter out common stablecoins/SOL for market data fetch
      const excludedTokens = [
        'So11111111111111111111111111111111111111112', // Wrapped SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // USD1
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
      ];

      const tokensToFetch = Array.from(allTokenAddresses).filter(
        addr => !excludedTokens.includes(addr)
      );

      // Fetch market data from DexScreener
      console.log(`Fetching market data for ${tokensToFetch.length} tokens...`);
      const marketData = await apiService.fetchMultipleTokenData(tokensToFetch);
      console.log(`Got market data for ${marketData.size} tokens`);

      // Fetch SOL price for USD conversion
      let solPriceUsd = 200; // Default fallback
      try {
        const solResponse = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
        const solData = await solResponse.json();
        if (solData.pairs && solData.pairs.length > 0) {
          // Find a USDC pair for accurate price
          const usdcPair = solData.pairs.find((p: any) =>
            p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT'
          ) || solData.pairs[0];
          solPriceUsd = parseFloat(usdcPair.priceUsd) || 200;
        }
        console.log(`SOL price: $${solPriceUsd}`);
      } catch (e) {
        console.warn('Failed to fetch SOL price, using fallback');
      }

      // Build token analysis
      const analysis: TokenAnalysis[] = [];

      for (const tokenAddress of allTokenAddresses) {
        if (excludedTokens.includes(tokenAddress)) continue;

        const position = positions.get(tokenAddress);
        const holding = holdingsMap.get(tokenAddress);
        const market = marketData.get(tokenAddress);

        const currentHoldings = holding ? parseFloat(holding.amount) : 0;
        const currentPrice = market ? parseFloat(market.priceUsd) : 0;
        const currentValueUsd = currentHoldings * currentPrice;
        const volume24h = market?.volume?.h24 || 0;

        const totalBought = position?.totalBought || 0;
        const totalSold = position?.totalSold || 0;

        // Calculate total bought USD (SOL converted to USD + stablecoins)
        const totalBuyCostSol = position?.totalBuyCostSol || 0;
        const totalBuyCostStable = position?.totalBuyCostStable || 0;
        const totalBoughtUsd = (totalBuyCostSol * solPriceUsd) + totalBuyCostStable;
        const avgEntryPrice = totalBought > 0 ? totalBoughtUsd / totalBought : 0;

        // Calculate total sold USD (SOL converted to USD + stablecoins)
        const totalSellRevenueSol = position?.totalSellRevenueSol || 0;
        const totalSellRevenueStable = position?.totalSellRevenueStable || 0;
        const totalSoldUsd = (totalSellRevenueSol * solPriceUsd) + totalSellRevenueStable;

        // Calculate PnL
        const realizedPnl = totalSoldUsd;
        const unrealizedPnl = currentValueUsd;
        const totalCost = totalBoughtUsd;
        const pnlUsd = (realizedPnl + unrealizedPnl) - totalCost;

        let pnlPercentage = 0;
        if (totalCost > 0) {
          pnlPercentage = (pnlUsd / totalCost) * 100;
        }

        // Check eligibility for Recovery Room (using config)
        const config = TOKEN_ELIGIBILITY_CONFIG;
        const ineligibleReasons: string[] = [];
        const lossPercentage = avgEntryPrice > 0 && currentPrice > 0
          ? ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100
          : (avgEntryPrice > 0 ? 100 : 0);

        if (config.requireHoldings && currentHoldings <= 0) {
          ineligibleReasons.push('No holdings');
        }
        if (lossPercentage < config.minLossPercentage) {
          ineligibleReasons.push(`Loss < ${config.minLossPercentage}%`);
        }
        if (volume24h > config.maxVolume24h) {
          ineligibleReasons.push(`Volume > $${config.maxVolume24h.toLocaleString()}`);
        }
        if (config.requirePurchaseHistory && totalBought <= 0) {
          ineligibleReasons.push('No buy history');
        }

        const symbol = holding?.symbol || market?.baseToken?.symbol || '???';
        const name = holding?.name || market?.baseToken?.name || 'Unknown';
        const logo = holding?.logo || market?.info?.imageUrl;

        analysis.push({
          tokenAddress,
          symbol,
          name,
          logo: logo || undefined,
          totalBought,
          totalBoughtUsd,
          avgEntryPrice,
          totalSold,
          totalSoldUsd,
          currentHoldings,
          currentPrice,
          currentValueUsd,
          pnlUsd,
          pnlPercentage,
          isProfit: pnlUsd >= 0,
          volume24h,
          isEligible: ineligibleReasons.length === 0,
          ineligibleReasons,
        });
      }

      // Sort by absolute PnL
      analysis.sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd));

      setTokens(analysis);
      console.log(`Analysis complete: ${analysis.length} tokens`);
    } catch (error) {
      console.error('Portfolio analysis error:', error);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  useEffect(() => {
    if (user?.walletAddress && !customWallet) {
      analyzePortfolio();
    }
  }, [user?.walletAddress]);

  const handleScanCustomWallet = () => {
    if (!customWallet.trim()) return;
    // Basic Solana address validation (32-44 chars, base58)
    if (customWallet.length < 32 || customWallet.length > 44) {
      alert('Invalid Solana wallet address');
      return;
    }
    analyzePortfolio(customWallet.trim());
  };

  const filteredTokens = tokens.filter(t => {
    if (activeTab === 'holdings') return t.currentHoldings > 0;
    if (activeTab === 'losses') return t.pnlUsd < 0;
    if (activeTab === 'profits') return t.pnlUsd >= 0;
    return true;
  });

  const formatNumber = (num: number, decimals = 2) => {
    if (Math.abs(num) >= 1000000) return `${(num / 1000000).toFixed(decimals)}M`;
    if (Math.abs(num) >= 1000) return `${(num / 1000).toFixed(decimals)}K`;
    if (Math.abs(num) < 0.0001 && num !== 0) return num.toExponential(2);
    return num.toFixed(decimals);
  };

  const formatPrice = (price: number) => {
    if (price === 0) return '$0';
    if (price < 0.000001) return `$${price.toExponential(2)}`;
    if (price < 0.01) return `$${price.toFixed(6)}`;
    return `$${price.toFixed(4)}`;
  };

  const isConnected = !!user?.walletAddress;

  const stats = {
    totalTokens: tokens.length,
    holdingTokens: tokens.filter(t => t.currentHoldings > 0).length,
    inProfit: tokens.filter(t => t.pnlUsd > 0).length,
    inLoss: tokens.filter(t => t.pnlUsd < 0).length,
    eligible: tokens.filter(t => t.isEligible).length,
    totalPnl: tokens.reduce((sum, t) => sum + t.pnlUsd, 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolio Analysis</h1>
          <p className="text-slate-400 text-sm">
            {isConnected ? 'Last 90 days trading activity' : 'Connect wallet to analyze your portfolio'}
          </p>
        </div>
        {isConnected && (
          <button
            onClick={() => analyzePortfolio()}
            disabled={loading}
            className="px-4 py-2 bg-rehab-green/10 border border-rehab-green text-rehab-green rounded-lg hover:bg-rehab-green/20 transition-all flex items-center gap-2"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Analyzing...' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Custom Wallet Scanner - Only visible when connected */}
      {isConnected ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={18} className="text-rehab-green" />
            <h3 className="text-white font-bold">Scan Any Wallet</h3>
          </div>
          <p className="text-slate-500 text-xs mb-3">
            Enter a Solana wallet address to check eligibility. Conditions: Loss ≥{TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}%, Volume ≤${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}, Must Hold Tokens
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customWallet}
              onChange={(e) => setCustomWallet(e.target.value)}
              placeholder="Enter Solana wallet address..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-rehab-green transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleScanCustomWallet()}
            />
            <button
              onClick={handleScanCustomWallet}
              disabled={loading || !customWallet.trim()}
              className="px-6 py-2.5 bg-rehab-green text-black font-bold rounded-lg hover:bg-rehab-green/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Search size={16} />
              Scan
            </button>
          </div>
          {scanningWallet && (
            <p className="text-xs text-slate-400 mt-2 font-mono">
              Scanning: {scanningWallet.slice(0, 8)}...{scanningWallet.slice(-6)}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-slate-900/50 border border-rehab-green/30 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-rehab-green/10 flex items-center justify-center">
                <Wallet size={24} className="text-rehab-green" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Connect Wallet to Scan</h3>
                <p className="text-slate-400 text-sm">
                  Connect your wallet to scan portfolios and check token eligibility
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-2">
                Eligibility: Loss ≥{TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}% • Volume ≤${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">Total Tokens</p>
          <p className="text-2xl font-bold text-white">{stats.totalTokens}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">Currently Holding</p>
          <p className="text-2xl font-bold text-white">{stats.holdingTokens}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">In Profit</p>
          <p className="text-2xl font-bold text-green-400">{stats.inProfit}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">In Loss</p>
          <p className="text-2xl font-bold text-red-400">{stats.inLoss}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">Eligible for Recovery</p>
          <p className="text-2xl font-bold text-rehab-green">{stats.eligible}</p>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-xs uppercase">Total PnL</p>
          <p className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {stats.totalPnl >= 0 ? '+' : ''}{formatNumber(stats.totalPnl)}
          </p>
        </div>
      </div>

      {/* Raw Data Debug */}
      {rawData && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
          <p className="text-slate-400 text-sm mb-2">
            Raw Data: {rawData.swaps.length} swaps, {rawData.holdings.length} token holdings
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 pb-2">
        {(['all', 'holdings', 'losses', 'profits'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg font-mono text-sm uppercase transition-all ${
              activeTab === tab
                ? 'bg-rehab-green/10 text-rehab-green border-b-2 border-rehab-green'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab} ({tab === 'all' ? tokens.length :
              tab === 'holdings' ? stats.holdingTokens :
              tab === 'losses' ? stats.inLoss : stats.inProfit})
          </button>
        ))}
      </div>

      {/* Token List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <RefreshCw size={32} className="animate-spin text-rehab-green" />
          {progress && (
            <div className="text-center">
              <p className="text-slate-400 text-sm">
                Parsing transactions: {progress.current} / {progress.total}
              </p>
              <div className="w-64 h-2 bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-rehab-green transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTokens.map((token, idx) => (
            <motion.div
              key={token.tokenAddress}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.02 }}
              className={`bg-slate-900/50 border rounded-lg p-4 ${
                token.isEligible
                  ? 'border-rehab-green/50'
                  : 'border-slate-800'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {token.logo ? (
                    <img src={token.logo} alt={token.symbol} className="w-10 h-10 rounded-full" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
                      ?
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-white flex items-center gap-2">
                      {token.symbol}
                      {token.isEligible && (
                        <span className="text-[10px] bg-rehab-green/20 text-rehab-green px-2 py-0.5 rounded border border-rehab-green/30">
                          ELIGIBLE
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{token.name}</p>
                    <p className="text-[10px] text-slate-600 font-mono">{token.tokenAddress.slice(0, 8)}...{token.tokenAddress.slice(-6)}</p>
                  </div>
                </div>

                {/* PnL */}
                <div className="text-right">
                  <div className={`flex items-center gap-1 ${token.isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {token.isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span className="font-bold text-lg">
                      {token.isProfit ? '+' : ''}{formatNumber(token.pnlUsd)}
                    </span>
                  </div>
                  <p className={`text-sm ${token.isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {token.isProfit ? '+' : ''}{token.pnlPercentage.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-black/30 p-2 rounded">
                  <p className="text-slate-500 text-[10px] uppercase">Bought</p>
                  <p className="text-white font-mono">{formatNumber(token.totalBought)} tokens</p>
                  <p className="text-slate-400 text-xs">${formatNumber(token.totalBoughtUsd)}</p>
                </div>
                <div className="bg-black/30 p-2 rounded">
                  <p className="text-slate-500 text-[10px] uppercase">Sold</p>
                  <p className="text-white font-mono">{formatNumber(token.totalSold)} tokens</p>
                  <p className="text-slate-400 text-xs">${formatNumber(token.totalSoldUsd)}</p>
                </div>
                <div className="bg-black/30 p-2 rounded">
                  <p className="text-slate-500 text-[10px] uppercase">Current Holdings</p>
                  <p className="text-white font-mono">{formatNumber(token.currentHoldings)}</p>
                  <p className="text-slate-400 text-xs">${formatNumber(token.currentValueUsd)}</p>
                </div>
                <div className="bg-black/30 p-2 rounded">
                  <p className="text-slate-500 text-[10px] uppercase">24h Volume</p>
                  <p className="text-white font-mono">${formatNumber(token.volume24h)}</p>
                </div>
              </div>

              {/* Price Info */}
              <div className="mt-3 flex justify-between text-xs text-slate-500 border-t border-slate-800 pt-2">
                <span>Entry: {formatPrice(token.avgEntryPrice)}</span>
                <span>Current: {formatPrice(token.currentPrice)}</span>
              </div>

              {/* Eligibility Status */}
              {token.ineligibleReasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {token.ineligibleReasons.map((reason, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-red-900/20 text-red-400 px-2 py-0.5 rounded border border-red-900/30 flex items-center gap-1"
                    >
                      <XCircle size={10} /> {reason}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          ))}

          {filteredTokens.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              {isConnected ? (
                <>
                  <AlertCircle size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No tokens found in this category</p>
                </>
              ) : (
                <>
                  <Wallet size={48} className="mx-auto mb-4 opacity-50" />
                  <p className="text-lg mb-2">Connect your wallet to view portfolio</p>
                  <p className="text-sm text-slate-600">Your token holdings and PnL will appear here</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scan, RefreshCw, Zap, Clock, Trophy, AlertTriangle, CheckCircle2, XCircle, Info, Users, Wallet, X, Calculator, Activity, Lock, ExternalLink, Shield, Cpu, Gift, Coins } from 'lucide-react';
import { solanaService } from '../services/solanaService';
import { rpcService } from '../services/rpcService';
import { apiService } from '../services/apiService';
import { dataService, StoredTokenData, StoredLiveEntry, ParticipationToken } from '../services/dataService';
import { wsService, SpinStartEvent, SpinResultEvent, NewRoundEvent } from '../services/websocketService';
import { LossCard, UserProfile, GlobalPoolToken, RoundEntry } from '../types';
import { TOKEN_ELIGIBILITY_CONFIG } from '../constants';
import { SpinWheel, WheelItem } from '../components/SpinWheel';

// VRF Status Types
type VrfStatus = 'idle' | 'active' | 'requesting' | 'processing' | 'complete';

interface DashboardProps {
  user: UserProfile | null;
}

// Scanner progress state interface
interface ScanProgress {
  phase: 'signatures' | 'parsing' | 'market' | 'analyzing' | 'complete';
  current: number;
  total: number;
  tokensFound: number;
  validTokens: number;
}

// Generate unique color for a token address
const generateTokenColor = (tokenAddress: string): string => {
  let hash = 0;
  for (let i = 0; i < tokenAddress.length; i++) {
    hash = tokenAddress.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 55%)`;
};

// Token color cache
const tokenColorMap = new Map<string, string>();
const getTokenColor = (tokenAddress: string, ticker: string): string => {
  const key = tokenAddress || ticker;
  if (!tokenColorMap.has(key)) {
    tokenColorMap.set(key, generateTokenColor(key));
  }
  return tokenColorMap.get(key)!;
};

export const Dashboard: React.FC<DashboardProps> = ({ user }) => {
  const [scanning, setScanning] = useState(false);
  const [losses, setLosses] = useState<LossCard[]>([]);
  const [selectedLosses, setSelectedLosses] = useState<string[]>([]); // Changed to array for multi-select
  const [timeLeft, setTimeLeft] = useState(() => dataService.getTimeRemainingSync());
  const [prizePoolSol, setPrizePoolSol] = useState(0); // Prize pool in SOL (real treasury balance)
  const [treasuryAddress, setTreasuryAddress] = useState<string | null>(null);

  // PumpFun creator fees state
  const [pumpFunFees, setPumpFunFees] = useState<{
    estimatedFees1h: number;
    volume1h: number;
    volume24h: number;
    priceUsd: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // User Winnings State
  const [totalWinningsSol, setTotalWinningsSol] = useState(0);
  const [userPayoutSol, setUserPayoutSol] = useState<number | null>(null); // Payout from current spin
  const [showWinNotification, setShowWinNotification] = useState(false);
  const [roundPayouts, setRoundPayouts] = useState<Array<{
    walletAddress: string;
    ticker: string;
    holdings: number;
    proportion: number;
    payoutSol: number;
  }>>([]);

  // Pool & Live Feed State - Start empty, load from database
  const [poolStats, setPoolStats] = useState<GlobalPoolToken[]>([]);
  const [liveFeed, setLiveFeed] = useState<RoundEntry[]>([]);

  // Track if user has participated in current round
  const [hasParticipated, setHasParticipated] = useState(false);
  const [participatedTokensList, setParticipatedTokensList] = useState<string[]>([]);

  // Cache status
  const [hasCachedData, setHasCachedData] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{ tokens: number; age: string } | null>(null);
  const [noValidTokens, setNoValidTokens] = useState(false); // Track if scan found no valid tokens

  // Wheel Data
  const [wheelItems, setWheelItems] = useState<WheelItem[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [showWinModal, setShowWinModal] = useState(false);
  
  // UI State
  const [showAlgoInfo, setShowAlgoInfo] = useState(false);

  // VRF State
  const [vrfStatus, setVrfStatus] = useState<VrfStatus>('active');
  const [vrfResult, setVrfResult] = useState<string | null>(null);
  const [vrfTxHash, setVrfTxHash] = useState<string | null>(null);
  const [transferSignature, setTransferSignature] = useState<string | null>(null);
  const [onChainRoundId, setOnChainRoundId] = useState<number | null>(null);

  // New Round Transition State
  const [showNewRoundTransition, setShowNewRoundTransition] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<'fadeOut' | 'message' | 'fadeIn'>('fadeOut');

  // Timer logic - synced with real round timing
  useEffect(() => {
    const updateTimer = async () => {
      const remaining = dataService.getTimeRemainingSync();
      setTimeLeft(remaining);

      // Check if new round started (timer was at 0 and now reset)
      if (remaining > 3590 && user?.walletAddress && hasParticipated) {
        // New round started - check participation status from server
        const stillParticipated = await dataService.hasParticipatedInRound(user.walletAddress);
        if (!stillParticipated) {
          setHasParticipated(false);
          setParticipatedTokensList([]);
          setSelectedLosses([]);
        }
      }

      // Pot is now fetched from server, no need to simulate growth
    };

    // Initial update and fetch round info
    dataService.getCurrentRound().then(() => updateTimer());

    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [user?.walletAddress, hasParticipated]);

  // Initialize Data from server
  useEffect(() => {
    const initData = async () => {
      // Load pool stats from server
      const storedPool = await dataService.getPoolStats();
      if (storedPool.length > 0) {
        setPoolStats(storedPool.map(p => ({
          ticker: p.ticker,
          subCount: p.subCount,
          color: p.color,
        })));
      }

      // Load live entries from server
      const storedEntries = await dataService.getLiveEntries();
      if (storedEntries.length > 0) {
        setLiveFeed(storedEntries.map(e => ({
          id: e.id,
          walletAddress: e.walletAddress,
          lossTicker: e.lossTicker,
          lossAmount: e.lossAmount,
          timestamp: e.timestamp,
          heldAmount: e.heldAmount,
        })));
      }

      // Check if current user has cached data and participation status
      if (user?.walletAddress) {
        const cached = await dataService.getUserCache(user.walletAddress);
        if (cached) {
          setHasCachedData(true);
          const ageMinutes = Math.floor((Date.now() - cached.lastAnalyzedAt) / 60000);
          setCacheInfo({
            tokens: cached.tokens.length,
            age: ageMinutes < 1 ? 'Just now' : `${ageMinutes}m ago`,
          });
          // Restore noValidTokens state from cache
          if (cached.noValidTokens) {
            setNoValidTokens(true);
          }
        }

        // Check participation status for current round
        const participated = await dataService.hasParticipatedInRound(user.walletAddress);
        setHasParticipated(participated);
        if (participated) {
          const tokens = await dataService.getParticipatedTokens(user.walletAddress);
          setParticipatedTokensList(tokens);
        }
      }
    };
    initData();
  }, [user?.walletAddress]);

  // Fetch prize pool (PumpFun fees + treasury) and user winnings - polls every 10 seconds
  useEffect(() => {
    const fetchPrizeData = async () => {
      try {
        // Fetch PumpFun trading data for display
        const pumpFunData = await dataService.getPumpFunFees();
        if (pumpFunData) {
          setPumpFunFees({
            estimatedFees1h: pumpFunData.estimatedFees1h,
            volume1h: pumpFunData.volume1h,
            volume24h: pumpFunData.volume24h,
            priceUsd: pumpFunData.priceUsd,
          });
        }

        // Fetch actual unclaimed fees from on-chain creator vault PDA
        // This is the REAL prize pool - actual SOL waiting to be claimed
        const pool = await dataService.getPrizePool();
        if (pool.configured && pool.amountSol >= 0) {
          setPrizePoolSol(pool.amountSol);
        }
        if (pool.address) {
          setTreasuryAddress(pool.address);
        }

        // Fetch user winnings if connected
        if (user?.walletAddress) {
          const winnings = await dataService.getUserWinnings(user.walletAddress);
          setTotalWinningsSol(winnings.totalWinningsSol);
        }
      } catch (error) {
        console.error('Error fetching prize data:', error);
      }
    };

    fetchPrizeData();

    // Poll every 30 seconds (PumpFun has 30s cache)
    const interval = setInterval(fetchPrizeData, 30000);
    return () => clearInterval(interval);
  }, [user?.walletAddress]);

  // Calculate Wheel Probabilities whenever Pool Stats change
  useEffect(() => {
    if (poolStats.length > 0) {
      setWheelItems(calculateWheelProbabilities(poolStats));
    }
  }, [poolStats]);

  // Poll for live feed and pool stats updates (real-time sync across users)
  useEffect(() => {
    const pollData = async () => {
      try {
        // Fetch latest live entries
        const entries = await dataService.getLiveEntries();
        if (entries.length > 0) {
          setLiveFeed(entries.map(e => ({
            id: e.id,
            walletAddress: e.walletAddress,
            lossTicker: e.lossTicker,
            lossAmount: e.lossAmount,
            timestamp: e.timestamp,
            heldAmount: e.heldAmount,
            color: e.color,
          })));
        }

        // Fetch latest pool stats
        const pool = await dataService.getPoolStats();
        if (pool.length > 0) {
          setPoolStats(pool.map(p => ({
            ticker: p.ticker,
            subCount: p.subCount,
            color: p.color,
          })));
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    // Poll every 3 seconds for real-time updates
    const pollInterval = setInterval(pollData, 3000);

    return () => clearInterval(pollInterval);
  }, []);

  // WebSocket connection for real-time sync across all users
  useEffect(() => {
    // Connect to WebSocket
    wsService.connect();

    // Listen for spin start - triggers wheel animation for all users
    const unsubSpinStart = wsService.on('SPIN_START', (data: SpinStartEvent) => {
      console.log('Received SPIN_START:', data);

      // Update pool stats from broadcast
      if (data.poolStats && data.poolStats.length > 0) {
        setPoolStats(data.poolStats.map(p => ({
          ticker: p.ticker,
          subCount: p.subCount,
          color: p.color,
        })));
      }

      // Start VRF animation sequence
      setVrfStatus('requesting');
      setVrfResult(null);
      setVrfTxHash(null);
    });

    // Listen for spin result - shows winner for all users
    const unsubSpinResult = wsService.on('SPIN_RESULT', (data: SpinResultEvent) => {
      console.log('Received SPIN_RESULT:', data);

      // Generate simulated VRF display values
      const simulatedVrfBytes = new Uint8Array(32);
      crypto.getRandomValues(simulatedVrfBytes);
      const vrfHex = '0x' + Array.from(simulatedVrfBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
      const simulatedTxHash = Array.from(simulatedVrfBytes.slice(8, 40)).map(b => b.toString(16).padStart(2, '0')).join('');

      setVrfResult(vrfHex);
      setVrfTxHash(simulatedTxHash);
      setVrfStatus('complete');
      setWinnerId(data.winner);
      setIsSpinning(true);
    });

    // Listen for new round - resets UI for all users
    const unsubNewRound = wsService.on('NEW_ROUND', (data: NewRoundEvent) => {
      console.log('Received NEW_ROUND:', data);

      // Update timer from server
      setTimeLeft(data.round.timeRemaining);

      // Reset participation and UI state
      setHasParticipated(false);
      setParticipatedTokensList([]);
      setSelectedLosses([]);
      setLosses([]);
      setHasCachedData(false);
      setCacheInfo(null);
      setNoValidTokens(false);
      setScanProgress(null);
      setPoolStats([]);
      setLiveFeed([]);
      setWheelItems([]);
      setShowWinModal(false);
      setWinnerId(null);
      setRoundPayouts([]);
      setTransferSignature(null);
      setUserPayoutSol(null);
      setVrfStatus('active');
      setVrfResult(null);
      setVrfTxHash(null);
    });

    // Cleanup on unmount
    return () => {
      unsubSpinStart();
      unsubSpinResult();
      unsubNewRound();
      wsService.disconnect();
    };
  }, []);

  /**
   * SQRT WEIGHTED ALGORITHM
   * Weight = Sqrt(Submissions)
   * Probability = Weight / TotalWeight
   */
  const calculateWheelProbabilities = (pool: GlobalPoolToken[]): WheelItem[] => {
    // 1. Calculate Weights
    const poolWithWeights = pool.map(t => ({
      ...t,
      weight: Math.sqrt(t.subCount)
    }));

    // 2. Total Weight
    const totalWeight = poolWithWeights.reduce((sum, t) => sum + t.weight, 0);

    // 3. Convert to Percentages
    return poolWithWeights.map(t => ({
      id: t.ticker,
      label: `${t.ticker}`,
      percentage: (t.weight / totalWeight) * 100,
      color: t.color
    }));
  };

  const getTokenInfo = (ticker: string) => {
    const item = wheelItems.find(i => i.id === ticker);
    const poolToken = poolStats.find(p => p.ticker === ticker);
    const color = poolToken?.color || getTokenColor(ticker, ticker);
    return item ? { pct: item.percentage.toFixed(1), color } : { pct: '0.0', color };
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleScan = async (forceRefresh = false) => {
    if (!user?.walletAddress) return;
    setScanning(true);
    setErrorMsg(null);
    setLosses([]);
    setNoValidTokens(false);
    setScanProgress({ phase: 'signatures', current: 0, total: 0, tokensFound: 0, validTokens: 0 });

    try {
      // Check for cached data first (unless force refresh)
      const cachedData = !forceRefresh ? await dataService.getUserCache(user.walletAddress) : null;
      let tokensToProcess: StoredTokenData[] = [];
      let holdingsMap = new Map<string, { amount: number; symbol: string; name: string; logo?: string }>();

      if (cachedData && cachedData.tokens.length > 0) {
        // Use cached data
        console.log('Using cached wallet data:', cachedData.tokens.length, 'tokens');
        tokensToProcess = cachedData.tokens;
        setScanProgress({ phase: 'analyzing', current: 50, total: 100, tokensFound: tokensToProcess.length, validTokens: 0 });
      } else {
        // Fresh scan
        // Step 1: Fetch token holdings
        setScanProgress(p => ({ ...p!, phase: 'signatures', current: 0, total: 100 }));
        const holdings = await apiService.fetchTokenBalances(user.walletAddress);

        // Create holdings map
        for (const h of holdings) {
          holdingsMap.set(h.mint, {
            amount: parseFloat(h.amount),
            symbol: h.symbol || '???',
            name: h.name || 'Unknown',
            logo: h.logo
          });
        }

        // Step 2: Fetch swaps from RPC with progress
        const swaps = await rpcService.fetchAllSwaps(
          user.walletAddress,
          90,
          (current, total) => {
            setScanProgress(p => ({ ...p!, phase: 'parsing', current, total }));
          }
        );

        // Step 3: Aggregate swaps
        setScanProgress(p => ({ ...p!, phase: 'analyzing', current: 50, total: 100 }));
        const positions = rpcService.aggregateSwaps(swaps);

        // Get unique tokens to analyze
        const allTokenAddresses = new Set<string>();
        positions.forEach((_, addr) => allTokenAddresses.add(addr));
        holdingsMap.forEach((_, addr) => allTokenAddresses.add(addr));

        // Exclude payment tokens
        const excludedTokens = [
          'So11111111111111111111111111111111111111112',
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
          'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
          'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
          'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
        ];

        const tokensToAnalyze = Array.from(allTokenAddresses).filter(
          addr => !excludedTokens.includes(addr)
        );

        setScanProgress(p => ({ ...p!, tokensFound: tokensToAnalyze.length }));

        // Build stored token data for caching
        for (const tokenAddress of tokensToAnalyze) {
          const position = positions.get(tokenAddress);
          const holding = holdingsMap.get(tokenAddress);

          tokensToProcess.push({
            tokenAddress,
            ticker: holding?.symbol || '???',
            name: holding?.name || 'Unknown',
            imageUrl: holding?.logo,
            totalBought: position?.totalBought || 0,
            totalSold: position?.totalSold || 0,
            totalBuyCostSol: position?.totalBuyCostSol || 0,
            totalBuyCostStable: position?.totalBuyCostStable || 0,
            totalSellRevenueSol: position?.totalSellRevenueSol || 0,
            totalSellRevenueStable: position?.totalSellRevenueStable || 0,
            firstBuyTime: position?.firstBuyTime || 0,
            lastBuyTime: position?.lastBuyTime || 0,
          });
        }

        // Note: Don't save cache here yet - we'll save after determining valid tokens
        setHasCachedData(true);
        setCacheInfo({ tokens: tokensToProcess.length, age: 'Just now' });
      }

      // Step 4: Fetch current market data (always fresh for accurate prices)
      // Parallel fetch: market data, holdings, and SOL price together for speed
      setScanProgress(p => ({ ...p!, phase: 'market', current: 0, total: tokensToProcess.length }));
      const tokenAddresses = tokensToProcess.map(t => t.tokenAddress);

      const [marketData, freshHoldings, solPriceUsd] = await Promise.all([
        apiService.fetchMultipleTokenData(tokenAddresses),
        apiService.fetchTokenBalances(user.walletAddress),
        fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112')
          .then(r => r.json())
          .then(data => {
            if (data.pairs && data.pairs.length > 0) {
              const usdcPair = data.pairs.find((p: any) =>
                p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT'
              ) || data.pairs[0];
              return parseFloat(usdcPair.priceUsd) || 200;
            }
            return 200;
          })
          .catch(() => 200),
      ]);

      // Update holdings map with fresh data
      holdingsMap = new Map();
      for (const h of freshHoldings) {
        holdingsMap.set(h.mint, {
          amount: parseFloat(h.amount),
          symbol: h.symbol || '???',
          name: h.name || 'Unknown',
          logo: h.logo
        });
      }

      // Step 5: Build loss cards - only VALID tokens
      setScanProgress(p => ({ ...p!, phase: 'analyzing', current: 75, total: 100 }));
      const validLosses: LossCard[] = [];

      for (const token of tokensToProcess) {
        const holding = holdingsMap.get(token.tokenAddress);
        const market = marketData.get(token.tokenAddress);

        const currentHoldings = holding?.amount || 0;
        const currentPrice = market ? parseFloat(market.priceUsd) : 0;
        const volume24h = market?.volume?.h24 || 0;

        // Calculate buy cost in USD
        const totalBoughtUsd = (token.totalBuyCostSol * solPriceUsd) + token.totalBuyCostStable;
        const avgEntryPrice = token.totalBought > 0 ? totalBoughtUsd / token.totalBought : 0;

        // Calculate sell revenue
        const totalSoldUsd = (token.totalSellRevenueSol * solPriceUsd) + token.totalSellRevenueStable;

        // Calculate loss percentage
        let lossPercentage = 0;
        if (avgEntryPrice > 0 && currentPrice > 0) {
          lossPercentage = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
        } else if (avgEntryPrice > 0 && currentPrice === 0) {
          lossPercentage = 100;
        }

        // Calculate USD loss
        const currentValueUsd = currentHoldings * currentPrice;
        const lossAmount = Math.max(0, totalBoughtUsd - totalSoldUsd - currentValueUsd);

        // CHECK ELIGIBILITY CONDITIONS (using config)
        const config = TOKEN_ELIGIBILITY_CONFIG;
        const isLossSafe = lossPercentage >= config.minLossPercentage;
        const isHeld = !config.requireHoldings || currentHoldings > 0;
        const isVolSafe = volume24h <= config.maxVolume24h;
        const hasPurchaseHistory = !config.requirePurchaseHistory || token.totalBought > 0;
        const meetsMinHoldingsUsd = currentValueUsd >= config.minHoldingsUsd;

        // Only include VALID tokens (all conditions met)
        if (isLossSafe && isHeld && isVolSafe && hasPurchaseHistory && meetsMinHoldingsUsd) {
          const symbol = holding?.symbol || market?.baseToken?.symbol || token.ticker;
          const name = holding?.name || market?.baseToken?.name || token.name;
          const logo = holding?.logo || market?.info?.imageUrl || token.imageUrl;

          validLosses.push({
            id: token.tokenAddress,
            tokenAddress: token.tokenAddress,
            ticker: symbol,
            name,
            imageUrl: logo,
            lossAmount,
            lossPercentage: Math.min(lossPercentage, 100),
            date: token.firstBuyTime ? new Date(token.firstBuyTime * 1000).toISOString().split('T')[0] : '',
            txHash: '',
            status: 'ELIGIBLE',
            entryPrice: avgEntryPrice,
            currentPrice,
            volume24h,
            holdings: currentHoldings,
            holdingsUsd: currentValueUsd,
            totalBought: token.totalBought,
            totalSold: token.totalSold,
          });
        }
      }

      // Sort by loss amount
      validLosses.sort((a, b) => b.lossAmount - a.lossAmount);

      setScanProgress(p => ({ ...p!, phase: 'complete', current: 100, total: 100, validTokens: validLosses.length }));
      setLosses(validLosses);

      // Track if no valid tokens found
      const hasNoValidTokens = validLosses.length === 0;
      setNoValidTokens(hasNoValidTokens);

      // Save to cache on server (with noValidTokens status to prevent spam re-scanning)
      // Always save when doing fresh scan, or update noValidTokens status if it changed
      if (!cachedData || hasNoValidTokens) {
        await dataService.saveUserCache(user.walletAddress, tokensToProcess, tokensToProcess.length, hasNoValidTokens);
      }

      // Small delay before hiding progress
      await new Promise(r => setTimeout(r, 500));
    } catch (e: any) {
      console.error('Scan error:', e);
      setErrorMsg(e.message || 'Scan failed');
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleEnter = async () => {
    if (selectedLosses.length === 0 || !user || hasParticipated) return;

    // Double-check participation status to prevent spam
    const alreadyParticipated = await dataService.hasParticipatedInRound(user.walletAddress);
    if (alreadyParticipated) {
      setHasParticipated(true);
      return;
    }

    // Get all selected loss details and prepare tokens for API
    const selectedLossDetails = losses.filter(l => selectedLosses.includes(l.id));
    const tokensToSubmit: ParticipationToken[] = selectedLossDetails.map(loss => ({
      id: loss.id,
      ticker: loss.ticker,
      tokenAddress: loss.tokenAddress,
      lossAmount: loss.lossAmount,
      holdings: loss.holdings,
      color: getTokenColor(loss.tokenAddress, loss.ticker),
    }));

    // Submit to server
    const result = await dataService.participate(user.walletAddress, tokensToSubmit);

    if (result.success && result.entries) {
      // Update local state with server response
      const participatedIds = selectedLossDetails.map(l => l.id);
      setHasParticipated(true);
      setParticipatedTokensList(participatedIds);

      // Add entries to live feed
      const newEntries: RoundEntry[] = result.entries.map(e => ({
        id: e.id,
        walletAddress: e.walletAddress,
        lossTicker: e.lossTicker,
        lossAmount: e.lossAmount,
        timestamp: e.timestamp,
        heldAmount: e.heldAmount,
        color: e.color,
      }));
      setLiveFeed(prev => [...newEntries, ...prev].slice(0, 100));

      // Update pool stats locally
      for (const token of tokensToSubmit) {
        const existingIndex = poolStats.findIndex(p => p.ticker === token.ticker);
        if (existingIndex >= 0) {
          const newStats = [...poolStats];
          newStats[existingIndex].subCount += 1;
          setPoolStats(newStats);
        } else {
          setPoolStats(prev => [...prev, {
            ticker: token.ticker,
            subCount: 1,
            color: token.color
          }]);
        }
      }

      // Update loss statuses
      setLosses(prev => prev.map(l =>
        selectedLosses.includes(l.id) ? { ...l, status: 'USED' as const } : l
      ));
    } else if (result.alreadyParticipated) {
      setHasParticipated(true);
    } else {
      setErrorMsg(result.error || 'Failed to submit participation');
    }

    setSelectedLosses([]);
  };

  // Handle token selection (max 3) - blocked if already participated
  const handleSelectToken = (tokenId: string) => {
    // Prevent selection if already participated in this round
    if (hasParticipated) return;

    const loss = losses.find(l => l.id === tokenId);
    if (!loss || loss.status !== 'ELIGIBLE') return;

    setSelectedLosses(prev => {
      if (prev.includes(tokenId)) {
        // Deselect
        return prev.filter(id => id !== tokenId);
      } else if (prev.length < TOKEN_ELIGIBILITY_CONFIG.maxTokensPerRound) {
        // Select (max from config)
        return [...prev, tokenId];
      }
      return prev; // Already at max
    });
  };

  const handleTriggerSpin = async () => {
    if (isSpinning || wheelItems.length === 0) return;

    // Check if prize pool has value (either treasury SOL or PumpFun fees)
    const hasPumpFunFees = pumpFunFees && pumpFunFees.estimatedFees1h > 0;
    if (prizePoolSol < 0.001 && !hasPumpFunFees) {
      alert('Cannot start round: No prize pool available!\n\nPrize pool fills from token trading volume creator fees.');
      return;
    }

    // Broadcast spin start to all clients via API
    try {
      await dataService.broadcastSpinStart(10000);
    } catch (error) {
      console.error('Failed to broadcast spin start:', error);
    }

    // Simulate VRF request flow (will be shown to all clients via WebSocket)
    setVrfStatus('requesting');
    setVrfResult(null);
    setVrfTxHash(null);

    // Simulate VRF request delay (in production, this waits for on-chain)
    await new Promise(r => setTimeout(r, 1500));
    setVrfStatus('processing');

    // Generate simulated VRF result (in production, comes from Switchboard)
    const simulatedVrfBytes = new Uint8Array(32);
    crypto.getRandomValues(simulatedVrfBytes);
    const vrfHex = '0x' + Array.from(simulatedVrfBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
    const simulatedTxHash = Array.from(simulatedVrfBytes.slice(8, 40)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Wait for "VRF fulfillment"
    await new Promise(r => setTimeout(r, 1000));

    // Calculate winner using VRF result (sqrt-weighted)
    // Convert first 8 bytes to number for weighted selection
    const vrfNumber = simulatedVrfBytes.slice(0, 8).reduce((acc, byte, i) => acc + byte * Math.pow(256, i), 0);
    const normalizedVrf = vrfNumber / Number.MAX_SAFE_INTEGER;

    // Calculate sqrt weights
    let totalWeight = 0;
    const weights = poolStats.map(t => {
      const weight = Math.sqrt(t.subCount);
      totalWeight += weight;
      return { ticker: t.ticker, weight };
    });

    // Find winner
    const target = normalizedVrf * totalWeight;
    let accumulated = 0;
    let selectedId = wheelItems[0].id;

    for (const { ticker, weight } of weights) {
      accumulated += weight;
      if (target <= accumulated) {
        selectedId = ticker;
        break;
      }
    }

    // Broadcast spin result to all clients
    try {
      await dataService.broadcastSpinResult(selectedId, prizePoolSol);
    } catch (error) {
      console.error('Failed to broadcast spin result:', error);
    }

    setVrfResult(vrfHex);
    setVrfTxHash(simulatedTxHash);
    setVrfStatus('complete');
    setWinnerId(selectedId);
    setIsSpinning(true);
    setShowWinModal(false);
  };

  // Start a new round with cool transition animation
  const startNewRound = async () => {
    // Phase 1: Fade out current content
    setShowNewRoundTransition(true);
    setTransitionPhase('fadeOut');

    await new Promise(resolve => setTimeout(resolve, 800));

    // Phase 2: Show new round message
    setTransitionPhase('message');

    // Reset all state during message display
    setShowWinModal(false);
    setWinnerId(null);
    setRoundPayouts([]);
    setTransferSignature(null);
    setUserPayoutSol(null);
    setVrfStatus('active');
    setVrfResult(null);
    setVrfTxHash(null);

    // Reset participation and scanner state
    setHasParticipated(false);
    setParticipatedTokensList([]);
    setSelectedLosses([]);
    setLosses([]);
    setHasCachedData(false);
    setCacheInfo(null);
    setNoValidTokens(false);
    setScanProgress(null);

    // Clear pool and live feed
    setPoolStats([]);
    setLiveFeed([]);
    setWheelItems([]);

    // Clear data on server and get new round info
    try {
      const result = await dataService.clearAll();
      if (result.round) {
        // Calculate time remaining from server's new round
        const timeRemaining = Math.max(0, Math.floor((result.round.endTime - Date.now()) / 1000));
        setTimeLeft(timeRemaining);
        console.log(`New round ${result.round.roundId} started, ${timeRemaining}s remaining`);
      } else {
        // Fallback to 1 hour if no round info
        setTimeLeft(3600);
      }
    } catch (error) {
      console.error('Error clearing data:', error);
      setTimeLeft(3600); // Fallback
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Phase 3: Fade in fresh UI
    setTransitionPhase('fadeIn');

    await new Promise(resolve => setTimeout(resolve, 800));

    // Hide transition overlay
    setShowNewRoundTransition(false);
  };

  const handleSpinComplete = async () => {
    setIsSpinning(false);

    // Complete the round on the server and get payouts
    if (winnerId) {
      try {
        const result = await dataService.completeRound(winnerId, vrfResult || undefined);

        if (result.success && result.payouts) {
          // Store all payouts for display in modal
          setRoundPayouts(result.payouts);

          // Update prize pool to actual distributed amount
          if (result.prizePoolSol !== undefined) {
            setPrizePoolSol(result.prizePoolSol);
          }

          // Store transfer signature for Solscan link
          if (result.transfer?.signature) {
            setTransferSignature(result.transfer.signature);
          }

          // Check if current user won
          const userPayout = result.payouts.find(p => p.walletAddress === user?.walletAddress);
          if (userPayout) {
            setUserPayoutSol(userPayout.payoutSol);
            setShowWinNotification(true);
            // Update total winnings
            setTotalWinningsSol(prev => prev + userPayout.payoutSol);

            // Hide win notification after 8 seconds
            setTimeout(() => setShowWinNotification(false), 8000);
          }
        }
      } catch (error) {
        console.error('Error completing round:', error);
      }
    }

    // Show winner modal
    setTimeout(() => {
        setShowWinModal(true);
    }, 500);
  };

  // Handle closing the winner modal and starting new round
  const handleCloseWinModal = () => {
    setShowWinModal(false);
    // Start new round with transition animation
    startNewRound();
  };

  if (!user) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
        <div className="bg-rehab-green/5 p-8 rounded-full border border-rehab-green/20 animate-pulse">
          <Scan size={64} className="text-rehab-green" />
        </div>
        <h2 className="text-2xl font-bold text-white">Patient Identification Required</h2>
        <p className="text-slate-400 max-w-md">Please connect your wallet to access the Trauma Scanner and treatment facilities.</p>
      </div>
    );
  }

  // Format large numbers
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(2);
  };

  return (
    // Fixed Height Container based on viewport minus nav to force internal scrolling
    // "last 5 positions can be fixed and the rest through scroll" -> ensured by overflow-y-auto on col-span-3
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-7rem)] relative">
      
      {/* LEFT: Scanner Panel */}
      <div className="lg:col-span-3 flex flex-col space-y-4 bg-slate-900/50 rounded-xl border border-slate-800 p-4 h-full overflow-hidden">
        <div className="flex flex-col pb-4 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-rehab-green font-mono uppercase tracking-widest text-sm flex items-center gap-2">
              <Scan size={16} /> Rug Scanner
            </h3>
            <span className="text-xs text-slate-500 font-mono">Deep Scan</span>
          </div>
          {/* Qualification Legend */}
          <div className="text-[10px] text-slate-500 flex flex-wrap gap-2">
             <span className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">Loss &gt; {TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}%</span>
             <span className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">Vol &lt; ${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}</span>
             <span className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">Must Hold</span>
          </div>
        </div>

        <div className="flex-grow overflow-y-auto space-y-3 custom-scrollbar relative pr-1 min-h-0">
          {/* LOCKED STATE - User already participated in this round */}
          {hasParticipated && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-sm rounded-lg"
            >
              {/* Animated lock ring */}
              <div className="relative mb-6">
                <div className="w-28 h-28 rounded-full border-4 border-slate-700 relative overflow-hidden">
                  {/* Rotating gradient border */}
                  <div
                    className="absolute inset-[-4px] rounded-full animate-spin"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent, #10b981, transparent)',
                      animationDuration: `${timeLeft}s`,
                      animationTimingFunction: 'linear',
                    }}
                  />
                  {/* Inner circle */}
                  <div className="absolute inset-1 rounded-full bg-slate-900 flex items-center justify-center">
                    <div className="text-center">
                      <Clock className="text-rehab-green mx-auto mb-1" size={24} />
                      <p className="text-2xl font-mono font-black text-white">{formatTime(timeLeft)}</p>
                    </div>
                  </div>
                </div>
                {/* Pulse rings */}
                <div className="absolute inset-0 rounded-full border-2 border-rehab-green/30 animate-ping" style={{ animationDuration: '2s' }} />
                <div className="absolute inset-[-8px] rounded-full border border-rehab-green/20 animate-pulse" />
              </div>

              <div className="text-center px-4 space-y-3">
                <h3 className="text-lg font-bold text-white">Entry Submitted</h3>
                <p className="text-sm text-slate-400 max-w-[220px]">
                  You've entered this round. Wait for the spin to see if you win!
                </p>

                {/* Participated tokens */}
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {participatedTokensList.map((tokenId, idx) => {
                    const loss = losses.find(l => l.id === tokenId);
                    if (!loss) return null;
                    const tokenColor = getTokenColor(loss.tokenAddress, loss.ticker);
                    return (
                      <div
                        key={tokenId}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border"
                        style={{
                          backgroundColor: `${tokenColor}15`,
                          borderColor: `${tokenColor}40`,
                        }}
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{ backgroundColor: tokenColor, color: '#000' }}
                        >
                          {idx + 1}
                        </span>
                        <span className="text-xs font-mono font-bold" style={{ color: tokenColor }}>
                          {loss.ticker}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Next round info */}
                <div className="mt-6 pt-4 border-t border-slate-800">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Next Round In</p>
                  <div className="flex items-center justify-center gap-2">
                    <div className="bg-slate-800 px-3 py-2 rounded-lg">
                      <span className="text-xl font-mono font-black text-rehab-green">
                        {Math.floor(timeLeft / 60).toString().padStart(2, '0')}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-1">min</span>
                    </div>
                    <span className="text-slate-600 text-xl">:</span>
                    <div className="bg-slate-800 px-3 py-2 rounded-lg">
                      <span className="text-xl font-mono font-black text-rehab-green">
                        {(timeLeft % 60).toString().padStart(2, '0')}
                      </span>
                      <span className="text-[10px] text-slate-500 ml-1">sec</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative elements */}
              <div className="absolute top-4 left-4 w-2 h-2 bg-rehab-green rounded-full animate-pulse" />
              <div className="absolute top-4 right-4 w-2 h-2 bg-rehab-green rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
              <div className="absolute bottom-4 left-4 w-2 h-2 bg-rehab-green rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
              <div className="absolute bottom-4 right-4 w-2 h-2 bg-rehab-green rounded-full animate-pulse" style={{ animationDelay: '1.5s' }} />
            </motion.div>
          )}

          {errorMsg && (
             <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs text-center">
                <AlertTriangle size={24} className="mx-auto mb-2" />
                {errorMsg}
             </div>
          )}

          {/* NO VALID TOKENS STATE - User scanned but no tokens met requirements */}
          {noValidTokens && !scanning && !hasParticipated && losses.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-6 px-4"
            >
              <div className="w-20 h-20 rounded-full bg-yellow-500/10 border-2 border-yellow-500/30 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={36} className="text-yellow-500" />
              </div>

              <h3 className="text-lg font-bold text-white mb-2">No Eligible Tokens Found</h3>
              <p className="text-sm text-slate-400 mb-6 max-w-[250px] mx-auto">
                Your wallet was scanned but no tokens meet the minimum requirements for recovery.
              </p>

              {/* Requirements Box */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 text-left space-y-3 mb-6">
                <h4 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">Requirements</h4>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <XCircle size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">Loss &gt; {TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}%</p>
                    <p className="text-[10px] text-slate-500">Token must have lost more than {TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}% from your entry price</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <XCircle size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">24h Volume &lt; ${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-500">Token must be "dead" with volume under ${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <XCircle size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">Still Holding</p>
                    <p className="text-[10px] text-slate-500">You must still hold some amount of the token</p>
                  </div>
                </div>
              </div>

              {/* Cache Info */}
              {cacheInfo && (
                <p className="text-[10px] text-slate-600 mb-4">
                  Scanned {cacheInfo.age} • {cacheInfo.tokens} tokens analyzed
                </p>
              )}

              <button
                onClick={() => handleScan(true)}
                className="text-xs text-slate-400 hover:text-rehab-green transition-colors flex items-center justify-center gap-1 mx-auto"
              >
                <RefreshCw size={12} /> Re-scan wallet
              </button>
            </motion.div>
          )}

          {/* READY TO SCAN STATE */}
          {losses.length === 0 && !scanning && !errorMsg && !hasParticipated && !noValidTokens && (
            <div className="text-center py-8 text-slate-500 text-sm flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
                <Scan size={28} className="text-slate-600" />
              </div>
              <p className="font-bold text-slate-400">Ready to Scan</p>
              <p className="text-xs mt-2 text-slate-600 max-w-[200px] mx-auto">
                Analyze your wallet for rugged tokens from the last 90 days
              </p>

              {/* Cache Status */}
              {hasCachedData && cacheInfo && (
                <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-blue-400 font-mono">
                    <span className="font-bold">{cacheInfo.tokens}</span> tokens cached • {cacheInfo.age}
                  </p>
                </div>
              )}

              <div className="mt-4 space-y-2 text-[10px] text-slate-600">
                <p className="flex items-center gap-2"><CheckCircle2 size={10} className="text-rehab-green" /> Loss &gt; {TOKEN_ELIGIBILITY_CONFIG.minLossPercentage}%</p>
                <p className="flex items-center gap-2"><CheckCircle2 size={10} className="text-rehab-green" /> Volume &lt; ${TOKEN_ELIGIBILITY_CONFIG.maxVolume24h.toLocaleString()}</p>
                <p className="flex items-center gap-2"><CheckCircle2 size={10} className="text-rehab-green" /> Still holding tokens</p>
              </div>

              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={() => handleScan(false)}
                  className="px-8 py-3 bg-rehab-green text-rehab-900 font-bold text-sm uppercase rounded-lg hover:bg-rehab-neon transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center gap-2"
                >
                  <Scan size={16} />
                  {hasCachedData ? 'Quick Scan' : 'Start Scan'}
                </button>
                {hasCachedData && (
                  <button
                    onClick={() => handleScan(true)}
                    className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                  >
                    <RefreshCw size={10} /> Force refresh (re-analyze wallet)
                  </button>
                )}
              </div>
            </div>
          )}
          
          {scanning && scanProgress && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              {/* Animated Scanner Ring */}
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-slate-800 relative">
                  {/* Spinning ring */}
                  <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-rehab-green animate-spin"></div>
                  {/* Inner pulse */}
                  <div className="absolute inset-2 rounded-full bg-rehab-green/10 animate-pulse flex items-center justify-center">
                    <Activity className="text-rehab-green" size={28} />
                  </div>
                </div>
                {/* Orbiting dots */}
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-rehab-green rounded-full shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                </div>
                <div className="absolute inset-0 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-1.5 bg-yellow-400 rounded-full shadow-[0_0_8px_rgba(250,204,21,0.8)]"></div>
                </div>
              </div>

              {/* Phase Text */}
              <div className="text-center space-y-1">
                <p className="text-rehab-green font-mono text-sm font-bold uppercase tracking-wider">
                  {scanProgress.phase === 'signatures' && 'Fetching Wallet Data...'}
                  {scanProgress.phase === 'parsing' && 'Parsing Transactions...'}
                  {scanProgress.phase === 'market' && 'Fetching Market Data...'}
                  {scanProgress.phase === 'analyzing' && 'Analyzing Tokens...'}
                  {scanProgress.phase === 'complete' && 'Scan Complete!'}
                </p>

                {/* Progress Counter */}
                {scanProgress.phase === 'parsing' && scanProgress.total > 0 && (
                  <div className="space-y-2">
                    <p className="text-2xl font-mono font-black text-white">
                      {scanProgress.current.toLocaleString()} <span className="text-slate-500 text-sm">/ {scanProgress.total.toLocaleString()}</span>
                    </p>
                    <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden mx-auto">
                      <motion.div
                        className="h-full bg-gradient-to-r from-rehab-green to-emerald-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                )}

                {scanProgress.tokensFound > 0 && (
                  <p className="text-xs text-slate-400 mt-2">
                    Found <span className="text-white font-bold">{scanProgress.tokensFound}</span> tokens to analyze
                  </p>
                )}
              </div>

              {/* Status Lines */}
              <div className="space-y-1.5 text-center">
                <div className={`flex items-center justify-center gap-2 text-[10px] font-mono ${scanProgress.phase === 'signatures' ? 'text-rehab-green' : 'text-slate-600'}`}>
                  {scanProgress.phase === 'signatures' ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                  <span>Wallet scan</span>
                </div>
                <div className={`flex items-center justify-center gap-2 text-[10px] font-mono ${scanProgress.phase === 'parsing' ? 'text-rehab-green' : scanProgress.phase === 'signatures' ? 'text-slate-600' : 'text-slate-600'}`}>
                  {scanProgress.phase === 'parsing' ? <RefreshCw size={10} className="animate-spin" /> : scanProgress.phase !== 'signatures' ? <CheckCircle2 size={10} /> : <div className="w-2.5 h-2.5 rounded-full border border-slate-700" />}
                  <span>Transaction history (90 days)</span>
                </div>
                <div className={`flex items-center justify-center gap-2 text-[10px] font-mono ${scanProgress.phase === 'market' ? 'text-rehab-green' : ['analyzing', 'complete'].includes(scanProgress.phase) ? 'text-slate-600' : 'text-slate-600'}`}>
                  {scanProgress.phase === 'market' ? <RefreshCw size={10} className="animate-spin" /> : ['analyzing', 'complete'].includes(scanProgress.phase) ? <CheckCircle2 size={10} /> : <div className="w-2.5 h-2.5 rounded-full border border-slate-700" />}
                  <span>Market data & prices</span>
                </div>
                <div className={`flex items-center justify-center gap-2 text-[10px] font-mono ${scanProgress.phase === 'analyzing' ? 'text-rehab-green' : scanProgress.phase === 'complete' ? 'text-slate-600' : 'text-slate-600'}`}>
                  {scanProgress.phase === 'analyzing' ? <RefreshCw size={10} className="animate-spin" /> : scanProgress.phase === 'complete' ? <CheckCircle2 size={10} /> : <div className="w-2.5 h-2.5 rounded-full border border-slate-700" />}
                  <span>Eligibility check</span>
                </div>
              </div>

              {/* Valid Tokens Found */}
              {scanProgress.phase === 'complete' && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-rehab-green/10 border border-rehab-green/30 rounded-lg px-4 py-2"
                >
                  <p className="text-rehab-green font-mono text-sm">
                    <span className="font-black text-lg">{scanProgress.validTokens}</span> valid rugs found
                  </p>
                </motion.div>
              )}
            </div>
          )}

          {/* Results Header with Re-scan */}
          {losses.length > 0 && !scanning && (
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
              <p className="text-xs text-slate-400">
                <span className="text-rehab-green font-bold">{losses.length}</span> valid rug{losses.length !== 1 ? 's' : ''} found
                {hasCachedData && <span className="text-blue-400 ml-1">(cached)</span>}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleScan(false)}
                  className="text-[10px] text-slate-400 hover:text-rehab-green transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={10} /> Quick
                </button>
                <button
                  onClick={() => handleScan(true)}
                  className="text-[10px] text-slate-500 hover:text-yellow-400 transition-colors flex items-center gap-1"
                  title="Force re-analyze wallet"
                >
                  <Zap size={10} /> Full
                </button>
              </div>
            </div>
          )}

          <AnimatePresence>
            {losses.map((loss, index) => {
                const isSelected = selectedLosses.includes(loss.id);
                const selectionIndex = selectedLosses.indexOf(loss.id);
                const tokenColor = getTokenColor(loss.tokenAddress, loss.ticker);
                const canSelect = loss.status === 'ELIGIBLE' && (isSelected || selectedLosses.length < TOKEN_ELIGIBILITY_CONFIG.maxTokensPerRound);

                return (
                <motion.div
                    key={loss.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => canSelect && handleSelectToken(loss.id)}
                    className={`p-3 rounded-lg border transition-all relative overflow-hidden group ${
                    isSelected
                        ? 'bg-rehab-green/10 border-rehab-green shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                        : loss.status === 'USED'
                        ? 'bg-slate-900 border-slate-800 opacity-50 cursor-not-allowed'
                        : canSelect
                        ? 'bg-slate-950/80 border-slate-800 hover:border-rehab-green/50 hover:bg-slate-900/50 cursor-pointer'
                        : 'bg-slate-950/80 border-slate-800 opacity-60 cursor-not-allowed'
                    }`}
                >
                    {/* Color accent bar */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1 transition-all"
                      style={{ backgroundColor: isSelected ? tokenColor : 'transparent' }}
                    />

                    {/* Header with Token Info */}
                    <div className="flex justify-between items-start mb-2 pl-2">
                        <div className="flex items-center gap-2">
                            {loss.imageUrl ? (
                              <img
                                src={loss.imageUrl}
                                alt={loss.ticker}
                                className={`w-8 h-8 rounded-full border-2 transition-all ${isSelected ? 'border-rehab-green' : 'border-slate-700'}`}
                              />
                            ) : (
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${isSelected ? 'border-rehab-green' : 'border-slate-700'}`}
                                style={{ backgroundColor: `${tokenColor}20`, color: tokenColor }}
                              >
                                {loss.ticker.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <h4 className="font-bold text-white flex items-center gap-2 text-sm">
                                {loss.ticker}
                                {loss.status === 'USED' ? (
                                  <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">SUBMITTED</span>
                                ) : (
                                  <span className="text-[10px] bg-rehab-green/20 text-rehab-green px-1.5 py-0.5 rounded border border-rehab-green/30 font-mono">VALID</span>
                                )}
                              </h4>
                              <p className="text-[10px] text-slate-500 truncate max-w-[100px]">{loss.name}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-red-400 font-mono font-bold text-lg">-{loss.lossPercentage.toFixed(0)}%</p>
                            <p className="text-[10px] text-slate-400">-${formatNumber(loss.lossAmount)}</p>
                        </div>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-3 gap-2 text-[10px] font-mono bg-black/30 p-2 rounded border border-white/5 ml-2">
                         <div className="text-center">
                            <p className="text-slate-500 uppercase text-[8px]">Holding</p>
                            <p className="text-white font-bold">{formatNumber(loss.holdings)}</p>
                         </div>
                         <div className="text-center border-x border-white/5">
                            <p className="text-slate-500 uppercase text-[8px]">24h Vol</p>
                            <p className="text-emerald-400 font-bold">${formatNumber(loss.volume24h)}</p>
                         </div>
                         <div className="text-center">
                            <p className="text-slate-500 uppercase text-[8px]">Value</p>
                            <p className="text-white font-bold">${formatNumber(loss.holdingsUsd)}</p>
                         </div>
                    </div>

                    {/* Price Info */}
                    <div className="mt-2 flex justify-between text-[9px] text-slate-500 font-mono pl-2">
                      <span>Entry: <span className="text-slate-400">${loss.entryPrice < 0.0001 ? loss.entryPrice.toExponential(2) : loss.entryPrice.toFixed(6)}</span></span>
                      <span>Now: <span className="text-red-400">${loss.currentPrice < 0.0001 ? loss.currentPrice.toExponential(2) : loss.currentPrice.toFixed(6)}</span></span>
                    </div>

                    {/* Selection indicator with number */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-black"
                          style={{ backgroundColor: tokenColor }}
                        >
                          {selectionIndex + 1}
                        </span>
                        <CheckCircle2 size={16} className="text-rehab-green" />
                      </div>
                    )}

                    {/* Hover glow effect */}
                    <div className="absolute inset-0 border-2 border-rehab-green/0 group-hover:border-rehab-green/20 rounded-lg transition-all pointer-events-none"></div>
                </motion.div>
            )})}
          </AnimatePresence>
        </div>

        <div className="pt-4 border-t border-slate-800 space-y-3">
          {/* Locked state for bottom bar */}
          {hasParticipated ? (
            <div className="text-center py-2">
              <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
                <Lock size={14} className="text-rehab-green" />
                <span>Entry locked until next round</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 font-mono">
                {formatTime(timeLeft)} remaining
              </p>
            </div>
          ) : (
            <>
              {/* Selection Summary */}
              {selectedLosses.length > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Selected: <span className="text-rehab-green font-bold">{selectedLosses.length}/{TOKEN_ELIGIBILITY_CONFIG.maxTokensPerRound}</span>
                  </span>
                  <button
                    onClick={() => setSelectedLosses([])}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Selected tokens preview */}
              {selectedLosses.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {selectedLosses.map((id, idx) => {
                    const loss = losses.find(l => l.id === id);
                    if (!loss) return null;
                    const tokenColor = getTokenColor(loss.tokenAddress, loss.ticker);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-full border border-white/10"
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-black"
                          style={{ backgroundColor: tokenColor }}
                        >
                          {idx + 1}
                        </span>
                        <span className="text-[10px] font-mono text-white">{loss.ticker}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectToken(id); }}
                          className="text-slate-500 hover:text-red-400 ml-1"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                disabled={selectedLosses.length === 0}
                onClick={handleEnter}
                className={`w-full py-3 rounded-lg font-bold font-mono uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
                  selectedLosses.length > 0
                    ? 'bg-rehab-green text-rehab-900 hover:bg-rehab-neon shadow-lg shadow-rehab-green/20'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {selectedLosses.length > 0 ? (
                  <>
                    <Zap size={16} />
                    Participate ({selectedLosses.length})
                  </>
                ) : (
                  'Select up to 3 tokens'
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* CENTER: The Arena / Wheel */}
      <div className="lg:col-span-6 flex flex-col relative bg-black/40 rounded-xl border border-slate-800 overflow-hidden h-full">
        {/* Background Grid */}
        <div className="absolute inset-0 grid-bg opacity-30 z-0"></div>
        
        {/* Top Bar Stats */}
        <div className="relative z-10 flex justify-between items-center p-6 border-b border-slate-800/50 bg-slate-900/20 backdrop-blur-sm">
          <div>
            <p className="text-slate-400 text-xs font-mono uppercase">Current Hourly Pot</p>
            <h2 className="text-4xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
              {prizePoolSol.toFixed(4)} <span className="text-lg text-slate-500 font-normal">SOL</span>
            </h2>
            {pumpFunFees && pumpFunFees.estimatedFees1h > 0 && (
              <div className="mt-1 flex items-center gap-2">
                <Coins size={12} className="text-rehab-green/70" />
                <span className="text-xs text-slate-400">
                  ~${pumpFunFees.estimatedFees1h.toFixed(2)} from ${pumpFunFees.volume1h.toLocaleString()} volume
                </span>
              </div>
            )}
            {treasuryAddress && prizePoolSol < 0.01 && !pumpFunFees?.estimatedFees1h && (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-amber-400/80">Deposit:</span>
                <code
                  className="text-xs text-amber-300/60 bg-amber-500/10 px-1.5 py-0.5 rounded cursor-pointer hover:bg-amber-500/20 transition-colors"
                  onClick={() => {
                    navigator.clipboard.writeText(treasuryAddress);
                  }}
                  title="Click to copy"
                >
                  {treasuryAddress.slice(0, 8)}...{treasuryAddress.slice(-6)}
                </code>
              </div>
            )}
          </div>
          {/* User Winnings Display */}
          {totalWinningsSol > 0 && (
            <div className="absolute top-6 right-1/2 translate-x-1/2 flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 px-3 py-1.5 rounded-full">
              <Trophy size={14} className="text-yellow-400" />
              <span className="text-yellow-400 font-mono font-bold text-sm">
                {totalWinningsSol.toFixed(3)} SOL
              </span>
              <span className="text-yellow-400/60 text-xs">won</span>
            </div>
          )}
          <div className="text-right">
            <p className="text-slate-400 text-xs font-mono uppercase">Next Spin</p>
            <div className="text-2xl font-mono font-bold text-rehab-green flex items-center gap-2">
              <Clock size={20} className="animate-pulse" />
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>

        {/* Wheel Container - Flexible to fit remaining height */}
        <div className="relative flex-grow flex flex-col items-center justify-center p-8 overflow-hidden min-h-0">
          
          <div className="scale-75 md:scale-100 transform transition-transform">
             <SpinWheel 
                items={wheelItems} 
                winnerId={winnerId}
                isSpinning={isSpinning}
                onSpinComplete={handleSpinComplete}
            />
          </div>

           {/* Algorithm Info Button */}
           <div className="mt-4 relative">
              <button 
                onClick={() => setShowAlgoInfo(!showAlgoInfo)}
                className="flex items-center gap-2 text-[10px] text-slate-500 bg-slate-900/80 px-3 py-1.5 rounded-full border border-slate-800 hover:border-rehab-green/50 hover:text-white transition-all z-30 relative"
              >
                  <Info size={12} className="text-rehab-green" />
                  <span>Odds = √(Entries) weighted</span>
              </button>

              {/* Algorithm Explainer Tooltip - UPDATED DESIGN */}
              <AnimatePresence>
                {showAlgoInfo && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-[26rem] p-0 bg-slate-900 border border-slate-700 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.6)] z-50 text-left backdrop-blur-md overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950/30">
                       <h4 className="text-rehab-green font-bold text-xs uppercase flex items-center gap-2 tracking-wider">
                          <Calculator size={14} /> Fairness Algorithm
                       </h4>
                       <button onClick={() => setShowAlgoInfo(false)} className="text-slate-500 hover:text-white transition-colors"><X size={14}/></button>
                    </div>
                    
                    <div className="p-5 space-y-4">
                        {/* Formula Section */}
                        <div className="bg-black/40 p-3 rounded-lg border border-white/5 font-mono text-[10px] text-slate-300 space-y-2">
                           <div className="flex flex-col border-b border-white/5 pb-2">
                              <span className="text-slate-500 mb-0.5 uppercase text-[9px]">Step 1: Calculate Weight</span>
                              <span className="text-white">Token Weight = √(Number of Submissions)</span>
                           </div>
                           <div className="flex flex-col pt-1">
                              <span className="text-slate-500 mb-0.5 uppercase text-[9px]">Step 2: Calculate Probability</span>
                              <span className="text-white">Probability = (Token Weight / Total Weight) × 100%</span>
                           </div>
                        </div>
                        
                        {/* Example Section Table */}
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-wider flex items-center gap-2">
                                <span className="w-1 h-1 bg-rehab-green rounded-full"></span> Live Example
                            </p>
                            <div className="bg-slate-950/50 rounded-lg border border-slate-800 overflow-hidden">
                                {/* Table Header */}
                                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 text-[9px] text-slate-500 uppercase font-bold">
                                    <span className="col-span-1">Token</span>
                                    <span className="col-span-1 text-center">Submissions</span>
                                    <span className="col-span-1 text-center">Sqrt Calc</span>
                                    <span className="col-span-1 text-right">Final Weight</span>
                                </div>
                                {/* Table Rows */}
                                <div className="px-3 py-2 space-y-2 text-[10px] font-mono">
                                    <div className="grid grid-cols-4 gap-2 items-center">
                                        <span className="text-white font-bold">TOKEN_A</span>
                                        <span className="text-center text-slate-400">16 users</span>
                                        <span className="text-center text-slate-500">√16</span>
                                        <span className="text-right text-rehab-green font-bold">4.0</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 items-center">
                                        <span className="text-white font-bold">TOKEN_B</span>
                                        <span className="text-center text-slate-400">9 users</span>
                                        <span className="text-center text-slate-500">√9</span>
                                        <span className="text-right text-yellow-500 font-bold">3.0</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 items-center">
                                        <span className="text-white font-bold">TOKEN_C</span>
                                        <span className="text-center text-slate-400">4 users</span>
                                        <span className="text-center text-slate-500">√4</span>
                                        <span className="text-right text-blue-400 font-bold">2.0</span>
                                    </div>
                                     <div className="grid grid-cols-4 gap-2 items-center">
                                        <span className="text-white font-bold">TOKEN_D</span>
                                        <span className="text-center text-slate-400">1 user</span>
                                        <span className="text-center text-slate-500">√1</span>
                                        <span className="text-right text-purple-400 font-bold">1.0</span>
                                    </div>
                                </div>
                                
                                <div className="px-3 py-2 border-t border-slate-800 bg-rehab-green/5 flex justify-between items-center text-[10px] font-mono">
                                    <span className="text-slate-400">Total Weight: <span className="text-white">10.0</span></span>
                                    <span className="text-slate-400">Token_A Prob: <span className="text-rehab-green font-bold">40.0%</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-b border-r border-slate-700 transform rotate-45"></div>
                  </motion.div>
                )}
              </AnimatePresence>
           </div>
          
          {/* Spin Trigger (Admin/Demo Button - usually automated) */}
          <div className="mt-4 z-20">
            <button
                onClick={handleTriggerSpin}
                disabled={isSpinning || (prizePoolSol < 0.001 && (!pumpFunFees || pumpFunFees.estimatedFees1h <= 0))}
                className={`px-8 py-3 rounded-full font-black text-lg uppercase tracking-widest border-2 transition-all ${
                    isSpinning || (prizePoolSol < 0.001 && (!pumpFunFees || pumpFunFees.estimatedFees1h <= 0))
                        ? 'border-slate-700 text-slate-700 bg-slate-900 cursor-not-allowed'
                        : 'border-rehab-green bg-rehab-green/10 text-rehab-green hover:bg-rehab-green hover:text-black shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                }`}
            >
                {isSpinning ? 'Spinning...' : (prizePoolSol < 0.001 && (!pumpFunFees || pumpFunFees.estimatedFees1h <= 0)) ? 'No Prize Pool' : 'Test Spin'}
            </button>
            <p className="text-[10px] text-slate-600 text-center mt-2">
              {(prizePoolSol < 0.001 && (!pumpFunFees || pumpFunFees.estimatedFees1h <= 0))
                ? 'Waiting for trading volume'
                : 'Simulates Hourly VRF Trigger'}
            </p>
          </div>
        </div>

        {/* VRF Status Line */}
        <div className="bg-slate-950 border-t border-slate-800 p-3 z-10">
          <div className="flex justify-between items-center text-xs font-mono">
            {/* VRF Status Indicator */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {vrfStatus === 'active' && (
                  <>
                    <span className="w-2 h-2 bg-rehab-green rounded-full animate-pulse"></span>
                    <span className="text-rehab-green">ROUND ACTIVE</span>
                  </>
                )}
                {vrfStatus === 'requesting' && (
                  <>
                    <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
                    <span className="text-yellow-500">REQUESTING VRF...</span>
                  </>
                )}
                {vrfStatus === 'processing' && (
                  <>
                    <Cpu size={12} className="text-blue-400 animate-spin" />
                    <span className="text-blue-400">SWITCHBOARD PROCESSING</span>
                  </>
                )}
                {vrfStatus === 'complete' && (
                  <>
                    <Shield size={12} className="text-rehab-green" />
                    <span className="text-rehab-green">VRF VERIFIED</span>
                  </>
                )}
              </div>

              {/* VRF Result Hash */}
              {vrfResult && (
                <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded border border-white/10">
                  <span className="text-slate-500">VRF:</span>
                  <span className="text-slate-300">{vrfResult}</span>
                </div>
              )}
            </div>

            {/* Verification Link */}
            <div className="flex items-center gap-3">
              {transferSignature && (
                <a
                  href={`https://solscan.io/tx/${transferSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-slate-400 hover:text-rehab-green transition-colors"
                >
                  <ExternalLink size={10} />
                  <span>View TX on Solscan</span>
                </a>
              )}
              <span className="text-slate-600 flex items-center gap-1">
                <Shield size={10} />
                SWITCHBOARD VRF
              </span>
            </div>
          </div>

          {/* VRF Progress Bar (when requesting/processing) */}
          {(vrfStatus === 'requesting' || vrfStatus === 'processing') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-2 pt-2 border-t border-slate-800"
            >
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className={vrfStatus === 'requesting' ? 'text-yellow-400' : 'text-slate-500'}>
                  1. Request Randomness
                </span>
                <span className={vrfStatus === 'processing' ? 'text-blue-400' : 'text-slate-600'}>
                  2. Oracle Processing
                </span>
                <span className="text-slate-600">
                  3. Verify & Select
                </span>
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-yellow-500 via-blue-500 to-rehab-green"
                  initial={{ width: '0%' }}
                  animate={{ width: vrfStatus === 'requesting' ? '33%' : '66%' }}
                  transition={{ duration: 0.5 }}
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* RIGHT: Live Feed */}
      <div className="lg:col-span-3 bg-slate-900/50 rounded-xl border border-slate-800 p-4 h-full flex flex-col overflow-hidden">
         <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-2">
          <h3 className="text-white font-mono uppercase tracking-widest text-sm flex items-center gap-2">
            <Zap size={16} className="text-yellow-400" /> Live Admissions
          </h3>
          <div className="flex gap-2">
             <span className="text-[10px] text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800 flex items-center gap-1">
                 <Users size={10} /> {liveFeed.length} Patients
             </span>
          </div>
        </div>
        
        {/* Scrollable Container with min-h-0 for flex fix */}
        <div className="space-y-2 flex-grow overflow-y-auto custom-scrollbar pr-1 min-h-0">
          <AnimatePresence mode="popLayout">
          {liveFeed.map((entry, index) => {
            const { pct } = getTokenInfo(entry.lossTicker);
            const color = entry.color; // Use color stored with the entry
            const isUserEntry = entry.walletAddress === user?.walletAddress;
            const isNew = Date.now() - entry.timestamp < 3000; // Less than 3 seconds old

            return (
            <motion.div
              key={entry.id}
              layout
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -50, opacity: 0, height: 0, marginBottom: 0 }}
              transition={{
                layout: { duration: 0.3, ease: "easeOut" },
                opacity: { duration: 0.2 },
                x: { duration: 0.3, ease: "easeOut" }
              }}
              className={`flex flex-col gap-2 p-3 rounded-lg border relative overflow-hidden flex-shrink-0 ${
                isUserEntry
                  ? 'bg-rehab-green/5 border-rehab-green/30'
                  : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
              }`}
              style={{
                boxShadow: isNew ? `0 0 20px ${color}40` : 'none'
              }}
            >
               {/* Left accent border matching the token color */}
               <div
                 className="absolute left-0 top-0 bottom-0 w-1.5 transition-all"
                 style={{ backgroundColor: color }}
               />

               {/* Glow effect for new entries */}
               {isNew && (
                 <motion.div
                   initial={{ opacity: 1 }}
                   animate={{ opacity: 0 }}
                   transition={{ duration: 2 }}
                   className="absolute inset-0 rounded-lg pointer-events-none"
                   style={{
                     background: `linear-gradient(90deg, ${color}20, transparent)`,
                   }}
                 />
               )}

               {/* Header: Wallet & Time */}
              <div className="flex items-center justify-between pl-3">
                <div className="flex items-center gap-2">
                   <div
                     className="w-6 h-6 rounded flex items-center justify-center"
                     style={{ backgroundColor: `${color}20` }}
                   >
                      <Wallet size={12} style={{ color }} />
                   </div>
                   <span className={`text-xs font-mono ${isUserEntry ? 'text-rehab-green font-bold' : 'text-slate-300'}`}>
                     {isUserEntry ? 'You' : entry.walletAddress.slice(0, 4) + '...' + entry.walletAddress.slice(-4)}
                   </span>
                   {isUserEntry && (
                     <span className="text-[8px] bg-rehab-green/20 text-rehab-green px-1.5 py-0.5 rounded-full border border-rehab-green/30">
                       YOUR ENTRY
                     </span>
                   )}
                </div>
                <span className="text-[10px] text-slate-600 font-mono">
                    {Math.floor((Date.now() - entry.timestamp) / 60000) < 1 ? 'Just now' : `${Math.floor((Date.now() - entry.timestamp) / 60000)}m ago`}
                </span>
              </div>

              {/* Data Grid: Ticker, Held, Pool% */}
              <div className="grid grid-cols-2 gap-2 bg-black/20 p-2 rounded border border-white/5 ml-3">
                 {/* Left: Ticker & Loss */}
                 <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 uppercase">Diagnosis</span>
                    <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-bold px-1.5 py-0.5 rounded"
                          style={{ color: color, backgroundColor: `${color}15` }}
                        >
                          {entry.lossTicker}
                        </span>
                    </div>
                 </div>

                 {/* Right: Holdings & Pool % */}
                 <div className="flex flex-col text-right">
                    <span className="text-[10px] text-slate-500 uppercase">Pool %</span>
                    <div className="flex items-center justify-end gap-2">
                        <span
                          className="text-sm font-mono font-bold px-2 py-0.5 rounded"
                          style={{ backgroundColor: `${color}20`, color: color }}
                        >
                            {pct}%
                        </span>
                    </div>
                 </div>
              </div>

              {/* Loss amount bar */}
              <div className="ml-3 flex items-center gap-2 text-[10px]">
                <span className="text-slate-500">Loss:</span>
                <span className="text-red-400 font-mono font-bold">-${formatNumber(entry.lossAmount)}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-500">Held:</span>
                <span className="text-white font-mono">{formatNumber(entry.heldAmount)}</span>
              </div>
            </motion.div>
          )})}
          </AnimatePresence>
        </div>
      </div>

      {/* User Win Notification - Shows when current user wins */}
      <AnimatePresence>
        {showWinNotification && userPayoutSol !== null && (
          <motion.div
            initial={{ opacity: 0, y: -100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[60]"
          >
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-yellow-500/30 rounded-2xl blur-xl animate-pulse" />

              <div className="relative bg-gradient-to-r from-yellow-500/20 via-yellow-400/20 to-yellow-500/20 border-2 border-yellow-400 rounded-2xl px-8 py-6 backdrop-blur-md">
                {/* Confetti particles */}
                <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                  {[...Array(15)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: ['#fbbf24', '#10b981', '#3b82f6', '#ec4899'][i % 4],
                        left: `${Math.random() * 100}%`,
                        top: `${Math.random() * 100}%`,
                      }}
                      animate={{
                        y: [0, -20, 0],
                        x: [0, (Math.random() - 0.5) * 20, 0],
                        opacity: [0, 1, 0],
                        scale: [0, 1, 0],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        delay: Math.random() * 2,
                      }}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-6">
                  {/* Trophy icon with glow */}
                  <motion.div
                    animate={{ rotate: [0, -10, 10, -10, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
                    className="relative"
                  >
                    <div className="absolute inset-0 bg-yellow-400/50 rounded-full blur-lg animate-pulse" />
                    <Gift size={48} className="text-yellow-400 relative drop-shadow-[0_0_15px_rgba(250,204,21,0.8)]" />
                  </motion.div>

                  <div className="text-left">
                    <p className="text-yellow-400/80 text-sm font-mono uppercase tracking-wider mb-1">
                      You Won!
                    </p>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', delay: 0.2 }}
                      className="flex items-baseline gap-2"
                    >
                      <span className="text-4xl font-black text-white">
                        +{userPayoutSol.toFixed(4)}
                      </span>
                      <span className="text-2xl font-bold text-yellow-400">SOL</span>
                    </motion.div>
                    <p className="text-xs text-slate-400 mt-1">
                      Distributed proportionally to your holdings
                    </p>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={() => setShowWinNotification(false)}
                    className="absolute top-2 right-2 text-slate-400 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Bottom progress bar showing time until auto-hide */}
                <motion.div
                  className="absolute bottom-0 left-0 h-1 bg-yellow-400/50 rounded-b-2xl"
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 8, ease: 'linear' }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Win Modal Overlay */}
      <AnimatePresence>
        {showWinModal && winnerId && (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                onClick={handleCloseWinModal}
            >
                <motion.div 
                    initial={{ scale: 0.5, y: 50 }}
                    animate={{ scale: 1, y: 0 }}
                    className="bg-slate-900 border-2 border-rehab-green p-8 rounded-2xl max-w-md w-full text-center relative overflow-hidden shadow-[0_0_50px_rgba(16,185,129,0.4)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-rehab-green to-transparent animate-pulse"></div>
                    
                    <Trophy size={64} className="text-yellow-400 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]" />
                    
                    <h2 className="text-3xl font-black text-white italic mb-2">WINNER SELECTED</h2>
                    <div className="text-5xl font-mono font-bold text-rehab-green mb-6 animate-pulse">
                        {winnerId}
                    </div>
                    
                    <p className="text-slate-400 mb-4">
                        The protocol has spoken. Payouts distributed to all {winnerId} holders.
                    </p>

                    {/* Prize Pool Distribution */}
                    <div className="bg-rehab-green/10 border border-rehab-green/30 rounded-lg p-4 mb-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-slate-400 text-sm">Prize Pool</span>
                        <span className="text-rehab-green font-mono font-bold text-xl">{prizePoolSol} SOL</span>
                      </div>

                      {/* Winners List */}
                      {roundPayouts.length > 0 && (
                        <div className="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
                          {roundPayouts.map((payout, idx) => {
                            const isUser = payout.walletAddress === user?.walletAddress;
                            return (
                              <div
                                key={idx}
                                className={`flex justify-between items-center text-xs p-2 rounded ${
                                  isUser ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-black/20'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={isUser ? 'text-yellow-400 font-bold' : 'text-slate-300'}>
                                    {isUser ? 'You' : `${payout.walletAddress.slice(0, 4)}...${payout.walletAddress.slice(-4)}`}
                                  </span>
                                  <span className="text-slate-500">({(payout.proportion * 100).toFixed(1)}%)</span>
                                </div>
                                <span className={`font-mono font-bold ${isUser ? 'text-yellow-400' : 'text-rehab-green'}`}>
                                  +{payout.payoutSol.toFixed(4)} SOL
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Transfer & VRF Verification Info */}
                    <div className="bg-black/40 border border-white/10 rounded-lg p-3 mb-6 text-left">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Shield size={10} className="text-rehab-green" /> Verification
                      </p>
                      <div className="space-y-2 font-mono text-xs">
                        {/* Transfer Transaction Link */}
                        {transferSignature && (
                          <div>
                            <div className="flex justify-between mb-1">
                              <span className="text-slate-500">Transfer TX:</span>
                              <span className="text-slate-300 text-[10px]">{transferSignature.slice(0, 16)}...</span>
                            </div>
                            <a
                              href={`https://solscan.io/tx/${transferSignature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-end gap-1 text-rehab-green hover:text-rehab-neon transition-colors"
                            >
                              <ExternalLink size={12} />
                              <span>View on Solscan</span>
                            </a>
                          </div>
                        )}
                        {/* VRF Result */}
                        {vrfResult && (
                          <div className="pt-2 border-t border-white/5">
                            <div className="flex justify-between">
                              <span className="text-slate-500">VRF Result:</span>
                              <span className="text-slate-300">{vrfResult}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <button
                        onClick={handleCloseWinModal}
                        className="w-full py-3 bg-rehab-green hover:bg-rehab-neon text-black font-bold rounded uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                    >
                        <RefreshCw size={18} />
                        Start New Round
                    </button>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* New Round Transition Overlay */}
      <AnimatePresence>
        {showNewRoundTransition && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
          >
            {/* Background grid pattern */}
            <div className="absolute inset-0 opacity-5">
              <div className="absolute inset-0" style={{
                backgroundImage: `linear-gradient(rgba(16,185,129,0.3) 1px, transparent 1px),
                                  linear-gradient(90deg, rgba(16,185,129,0.3) 1px, transparent 1px)`,
                backgroundSize: '50px 50px'
              }} />
            </div>

            {/* Animated circles */}
            <div className="absolute inset-0 overflow-hidden">
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rehab-green/30"
                  initial={{ width: 0, height: 0, opacity: 0.8 }}
                  animate={{
                    width: [0, 800],
                    height: [0, 800],
                    opacity: [0.8, 0],
                  }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    delay: i * 0.8,
                    ease: 'easeOut',
                  }}
                />
              ))}
            </div>

            {/* Content */}
            <div className="relative z-10 text-center">
              <AnimatePresence mode="wait">
                {transitionPhase === 'fadeOut' && (
                  <motion.div
                    key="fadeout"
                    initial={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <RefreshCw size={48} className="text-rehab-green" />
                    </motion.div>
                    <p className="text-slate-400 mt-4 font-mono text-sm">Finalizing round...</p>
                  </motion.div>
                )}

                {transitionPhase === 'message' && (
                  <motion.div
                    key="message"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center"
                  >
                    {/* Glowing icon */}
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="relative mb-6"
                    >
                      <div className="absolute inset-0 bg-rehab-green/30 rounded-full blur-2xl animate-pulse" />
                      <Zap size={72} className="text-rehab-green relative drop-shadow-[0_0_30px_rgba(16,185,129,0.8)]" />
                    </motion.div>

                    <motion.h1
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tight"
                    >
                      NEW ROUND
                    </motion.h1>

                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ delay: 0.5, duration: 0.8 }}
                      className="h-[2px] bg-gradient-to-r from-transparent via-rehab-green to-transparent mb-4 max-w-xs"
                    />

                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                      className="text-slate-400 font-mono text-sm tracking-widest uppercase"
                    >
                      Scan your wallet to enter
                    </motion.p>

                    {/* Loading dots */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1 }}
                      className="flex gap-1 mt-6"
                    >
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 bg-rehab-green rounded-full"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: i * 0.2,
                          }}
                        />
                      ))}
                    </motion.div>
                  </motion.div>
                )}

                {transitionPhase === 'fadeIn' && (
                  <motion.div
                    key="fadein"
                    initial={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.2 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200 }}
                    >
                      <CheckCircle2 size={64} className="text-rehab-green drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]" />
                    </motion.div>
                    <p className="text-rehab-green mt-4 font-mono text-sm">Ready!</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};
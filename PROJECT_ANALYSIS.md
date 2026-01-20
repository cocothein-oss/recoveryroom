# The Recovery Room (GEM) - Project Analysis

## Overview

**Project Name:** The Recovery Room (GEM)
**Type:** Solana Loss Recovery Lottery Protocol - Frontend Application
**Status:** Demo/MVP Phase (Frontend Only)
**Stack:** React 19 + TypeScript + Vite + Tailwind CSS

**Description:** A gamified Solana loss recovery protocol where users can turn their "red PnL" (unrealized losses) into potential paydays via a provably fair lottery system.

---

## Project Structure

```
recoveryroom/
├── App.tsx                    # Root component with routing
├── index.tsx                  # React entry point
├── index.html                 # HTML template + Tailwind config
├── types.ts                   # TypeScript interfaces
├── constants.ts               # Mock data & thresholds
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── vite.config.ts             # Vite build config
├── metadata.json              # AI Studio metadata
├── README.md                  # Documentation
├── .env.local                 # Environment variables
│
├── components/
│   ├── Layout.tsx             # Main layout with navigation
│   └── SpinWheel.tsx          # Interactive lottery wheel
│
├── pages/
│   ├── Landing.tsx            # Home/marketing page
│   ├── Dashboard.tsx          # Main treatment/lottery interface
│   ├── Leaderboard.tsx        # User rankings
│   ├── Transparency.tsx       # Proof of fairness & history
│   └── Admin.tsx              # Admin console (mock)
│
└── services/
    └── solanaService.ts       # Wallet & lottery logic (mocked)
```

---

## Key Features

### 1. Landing Page (`/`)
- Hero section with protocol branding
- Live stats ticker (USDC distributed, hourly pot, recycled tokens)
- Recent winners marquee
- "How Treatment Works" 3-step explainer

### 2. Dashboard (`/dashboard`)
- **Left Panel:** Rug Scanner - detects wallet losses
- **Center Panel:** Interactive lottery wheel with sqrt-weighted odds
- **Right Panel:** Live admissions feed (real-time entries)
- Test spin functionality with winner modal

### 3. Leaderboard (`/leaderboard`)
- 3 ranking tabs: Most Unlucky, Biggest Comeback, Luckiest God
- Badge system (CHIEF SURGEON, RESIDENT)
- Share rank functionality

### 4. Transparency (`/transparency`)
- Provably fair explanation (Switchboard VRF)
- Win distribution bar chart
- Round history log with tx hashes

### 5. Admin (`/admin`)
- Emergency stop toggle (mock)
- Fee configuration sliders (mock)

---

## Type Definitions

```typescript
interface UserProfile {
  walletAddress: string
  balance: number              // Project token balance
  tier: 'TIER_1' | 'TIER_2' | 'NONE'
  totalLossesSubmitted: number
  totalWinnings: number
}

interface LossCard {
  id: string
  ticker: string
  name: string
  lossAmount: number           // USD
  date: string
  txHash: string
  status: 'ELIGIBLE' | 'USED' | 'INELIGIBLE'
  imageUrl?: string
  entryPrice: number
  currentPrice: number
  volume24h: number
  holdings: number
}

interface GlobalPoolToken {
  ticker: string
  subCount: number             // Submissions count
  color: string                // Wheel color
}

interface RoundEntry {
  id: string
  walletAddress: string
  lossTicker: string
  lossAmount: number
  timestamp: number
  heldAmount: number
}

interface RoundHistory {
  id: number
  winningToken: string
  totalPayout: number
  winnerCount: number
  txHash: string
  timestamp: string
}
```

---

## Constants & Thresholds

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_PROJECT_TOKENS` | 1,000,000 | Required to access scanner |
| `MIN_LOSS_PERCENTAGE` | 80% | Minimum loss to qualify |
| `MAX_VOL_24H` | $5,000 | Maximum 24h volume to qualify |

---

## Core Algorithm: SQRT-Weighted Lottery

```
Weight = √(Submissions for Token)
Probability = (Token Weight / Sum of All Weights) × 100%
```

**Example:**
| Token | Submissions | Weight | Probability |
|-------|-------------|--------|-------------|
| LUNA | 16 | 4.0 | 40% |
| FTT | 9 | 3.0 | 30% |
| SLERF | 4 | 2.0 | 20% |
| JEJ | 1 | 1.0 | 10% |

---

## Qualification Criteria for Loss Entry

1. ✅ Must still hold tokens (`holdings > 0`)
2. ✅ Unrealized loss >= 80%
3. ✅ 24h volume < $5,000

---

## Dependencies

### Production
- `react` 19.2.3 - UI framework
- `react-dom` 19.2.3 - DOM rendering
- `react-router-dom` 7.11.0 - Routing
- `framer-motion` 12.23.26 - Animations
- `lucide-react` 0.562.0 - Icons
- `recharts` 3.6.0 - Charts

### Development
- `vite` 6.2.0 - Build tool
- `typescript` 5.8.2 - Type safety
- `@vitejs/plugin-react` 5.0.0 - React plugin

---

## Design System

### Colors (Tailwind Extended)
- `rehab-900`: #020617 (Dark background)
- `rehab-800`: #0f172a (Card background)
- `rehab-700`: #1e293b (Border/subtle)
- `rehab-green`: #10b981 (Primary accent)
- `rehab-neon`: #34d399 (Highlight)
- `rehab-alert`: #ef4444 (Error/alert)

### Theme
- Dark mode cyberpunk aesthetic
- Medical/rehabilitation terminology
- Emerald green accents
- Grid background pattern
- Neon glow effects

---

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Landing | Home/marketing |
| `/dashboard` | Dashboard | Main lottery interface |
| `/leaderboard` | Leaderboard | Rankings |
| `/transparency` | Transparency | Fairness proof |
| `/admin` | Admin | Control panel |

---

## Services

### SolanaService (Singleton)

| Method | Purpose | Returns |
|--------|---------|---------|
| `getInstance()` | Get singleton | SolanaService |
| `connectWallet()` | Connect wallet | UserProfile |
| `scanTrauma()` | Detect losses | LossCard[] |
| `getGlobalPoolStats()` | Get pool stats | GlobalPoolToken[] |
| `enterLottery(id)` | Submit loss | boolean |
| `disconnect()` | Disconnect | void |

**Note:** All methods are currently mocked with simulated delays.

---

## What's Missing (Production Gaps)

### Backend/Smart Contract
- [ ] Anchor/Rust smart contracts not present
- [ ] No Cargo.toml or Anchor.toml
- [ ] Program deployment scripts needed

### Real Integrations Needed
- [ ] `@solana/web3.js` - Wallet connection
- [ ] `@solana/wallet-adapter` - Wallet UI
- [ ] Helius/RPC API - Token data
- [ ] Switchboard VRF - Randomness
- [ ] Real transaction submission

### Testing
- [ ] No test files found
- [ ] Unit tests needed
- [ ] Integration tests needed
- [ ] E2E tests needed

### DevOps
- [ ] CI/CD pipeline
- [ ] Environment configs (dev/staging/prod)
- [ ] Error tracking (Sentry)
- [ ] Analytics

---

## User Flows

### 1. Onboarding
```
Connect Wallet → Check Token Balance → Grant Access or Deny
```

### 2. Loss Detection
```
Click Scan → Analyze Wallet → Display Loss Cards → Filter by Eligibility
```

### 3. Lottery Entry
```
Select Loss Card → Click Enter → Update Card Status → Add to Pool
```

### 4. Lottery Spin
```
Click Spin → Animate Wheel → Select Winner → Show Modal → Distribute Payout
```

---

## File Quick Reference

| Need | File |
|------|------|
| Add new route | `App.tsx` |
| Modify layout/nav | `components/Layout.tsx` |
| Change lottery logic | `services/solanaService.ts` |
| Update types | `types.ts` |
| Change thresholds | `constants.ts` |
| Modify wheel | `components/SpinWheel.tsx` |
| Update styles | `index.html` (Tailwind config) |

---

## Commands

```bash
# Development
npm run dev          # Start dev server at localhost:3000

# Production
npm run build        # Build for production
npm run preview      # Preview production build
```

---

## Statistics

| Metric | Value |
|--------|-------|
| Total Files | 21 |
| Components | 2 |
| Pages | 5 |
| Services | 1 |
| Routes | 5 |
| Lines of Code | ~2,500+ |

---

*Last Updated: January 2025*

# RFND - Loss Recovery Protocol

A Solana-based loss recovery protocol that redistributes PumpFun creator fees to token holders who have experienced trading losses.

## How It Works

### 1. Token & Fee Flow

The $RFND token is live on Pump.fun. All creator fees generated from $RFND trading activity are automatically routed to the protocol treasury. 100% of collected creator fees are reserved exclusively for user payouts through the recovery mechanism.

### 2. Treasury Accumulation

Creator fees accumulate in the treasury continuously as trading volume occurs. The treasury is the sole funding source for all distribution rounds and does not serve any other purpose.

### 3. Eligibility Scan

Users connect their wallet to the application. The protocol analyzes on-chain portfolio history to identify eligible loss positions.

A position is eligible if **all** of the following conditions are met:
- Unrealized loss exceeds **80%**
- Total traded volume for the token is below **$2,000**
- The user is still holding the token

Only positions meeting every criterion can be submitted into a round.

### 4. Submission Phase

Eligible users may submit qualifying positions into the active round. Each submitted position represents an entry in the upcoming draw. Submissions remain open until the next scheduled draw.

### 5. Hourly Draw (Square Root Weighted)

Every 1 hour, the protocol executes a draw using a verifiable random function (VRF).

To limit disproportionate influence from large positions, entries are weighted using square root weighting:

```
Weight = √(Number of Entries)
```

This approach reduces the marginal advantage of larger submissions while still preserving proportional participation incentives.

### 6. Prize Distribution

The treasury balance allocated to the round is distributed to selected participants. Payouts are executed automatically from the treasury to user wallets. All distributions are fully on-chain and publicly verifiable.

## Features

- **PumpFun Integration**: Auto-claims creator fees via PumpPortal API
- **VRF Randomization**: Verifiable random function for fair winner selection
- **Real-time Updates**: WebSocket-powered live feed of entries and results
- **Portfolio Analysis**: Scans wallet history to detect eligible losing positions
- **Transparent**: All rounds, winners, and transactions are publicly viewable

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Framer Motion (animations)
- TailwindCSS (styling)

### Backend
- Node.js + Express
- WebSocket (real-time updates)
- JSON file-based database

### Blockchain
- Solana Web3.js
- Anchor Framework (smart contracts)
- PumpPortal API (fee claiming)

## Project Structure

```
recoveryroom/
├── components/          # React components
├── pages/              # Page components
│   ├── Dashboard.tsx   # Main lottery interface
│   ├── Portfolio.tsx   # Wallet analysis
│   ├── Leaderboard.tsx # Winners leaderboard
│   └── Transparency.tsx # Round history
├── services/           # Frontend services
│   ├── dataService.ts  # API client
│   ├── solanaService.ts # Wallet connection
│   └── websocketService.ts # Real-time updates
├── server/             # Backend
│   ├── routes/         # API endpoints
│   ├── services/       # Backend services
│   │   ├── pumpfunService.js  # PumpFun integration
│   │   ├── solanaTransfer.js  # Prize distribution
│   │   └── jsonDb.js   # Database
│   └── data/           # Round/user data (gitignored)
└── programs/           # Anchor smart contracts
```

## Installation

### Prerequisites
- Node.js 18+
- npm or yarn
- Solana CLI (optional, for smart contracts)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/cocothein-oss/recoveryroom.git
   cd recoveryroom
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd server
   npm install
   ```

4. **Configure environment**
   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env` with your values:
   - `PUMPFUN_TOKEN_MINT` - Your PumpFun token address
   - `PUMPFUN_CREATOR_WALLET` - Creator wallet address
   - `PUMPFUN_CREATOR_PRIVATE_KEY` - Private key for auto-claiming

5. **Start the backend**
   ```bash
   cd server
   node index.js
   ```

6. **Start the frontend** (new terminal)
   ```bash
   npm run dev
   ```

7. Open http://localhost:5173

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/round` | GET | Current round info |
| `/api/live-feed` | GET | Recent entries |
| `/api/pool-stats` | GET | Token participation stats |
| `/api/pumpfun/fees` | GET | Estimated creator fees |
| `/api/pumpfun/wallet` | GET | Creator wallet balance |
| `/api/participate` | POST | Submit lottery entry |

## Environment Variables

```env
# Server
PORT=6002
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# PumpFun Integration
PUMPFUN_TOKEN_MINT=your-token-mint
PUMPFUN_CREATOR_WALLET=your-creator-wallet
PUMPFUN_CREATOR_PRIVATE_KEY=your-private-key

# Security
ADMIN_KEY=your-admin-key
ENCRYPTION_PASSWORD=your-encryption-password
```

## Token Eligibility

Tokens qualify for entry if:
- Unrealized loss exceeds **80%**
- Total traded volume for the token is below **$2,000**
- User still holds the tokens

## Security

- Private keys are never committed to git
- Creator wallet uses minimal reserve (0.0001 SOL)
- Only claimed fees are distributed, not wallet balance
- Admin endpoints require authentication

## License

MIT

## Disclaimer

This is experimental software. Use at your own risk. Not financial advice. Always verify transactions before signing.

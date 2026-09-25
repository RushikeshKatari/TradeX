# TradeX — Indian Market Paper Trading & Technical Analysis Platform

> **EDUCATIONAL & PAPER TRADING NOTICE:** TradeX is an educational paper-trading platform utilizing simulated virtual capital. It never executes real-money trades, never deposits/withdraws real funds, and does not claim that technical indicators guarantee future price performance.

---

## 1. Overview & Architecture

TradeX is a full-stack, production-quality Indian stock-market paper trading and technical analysis terminal designed to run seamlessly on **Vercel** with **Next.js (App Router)** and **PostgreSQL (via Prisma ORM)**.

```
Browser (React Client)
   │ (Interactive Candlestick Charts, Option Chain Matrix, Paper Order Ticket, Portfolio)
   ▼
Next.js 14 App Router on Vercel
   ├── Server Actions & Vercel Functions
   ├── RBAC Middleware (ADMIN vs USER)
   ├── Market Data Abstraction Layer (Live Provider Feed + Offline Dev Adapter)
   ├── Multi-Factor Technical Indicator & Signal Engine
   ├── Atomic Paper-Trading Execution Engine (Decimal Precision)
   └── Immutable Fund Ledger & System Security Audit Trail
   │
   ▼
PostgreSQL Database (Neon / Vercel Marketplace / Supabase / Self-hosted)
```

---

## 2. Core Capabilities

1. **Strict Market Data Integrity**:
   - Live mode (`MARKET_DATA_MODE=live`): Retrieves genuine market data from licensed external feeds.
   - If external feeds are unreachable or credentials are unconfigured, TradeX **strictly displays "Live market data unavailable"** and **NEVER generates fake market data**.
   - Offline development mode (`MARKET_DATA_MODE=development`): An isolated development adapter is provided for local deterministic testing and unit tests.
2. **Indian Market Hours & Calendar**:
   - Accounts for NSE / BSE trading sessions (09:15 to 15:30 IST) in `Asia/Kolkata` time.
   - Built-in exchange holiday calendar (Republic Day, Holi, Diwali, etc.) and weekend closures.
3. **Modular Technical Analysis Engine**:
   - **Trend**: SMA, EMA (20 & 50), Supertrend (ATR-based), ADX (+DI/-DI).
   - **Momentum**: RSI (14, Wilder's smoothing), MACD (12, 26, 9), Stochastic Oscillator (%K, %D).
   - **Volatility**: Bollinger Bands (Upper, Middle, Lower, Bandwidth), ATR (14).
   - **Volume**: VWAP, OBV.
   - **Explainable Multi-factor Scoring**: Deterministic score mapping to `BULLISH`, `BEARISH`, or `SIDEWAYS`, with `Weak`, `Moderate`, or `Strong` signal confidence and transparent indicator breakdown.
4. **Options Chain Analysis (NIFTY 50 & SENSEX)**:
   - Side-by-side Call (CE) and Put (PE) matrix around ATM strike.
   - **Highest Observed Volume Strike** ("Volume Leader", explicitly labeled without buy recommendation).
   - Put/Call Ratio (PCR) by Volume and Open Interest (OI).
5. **Paper Trading Engine & Financial Math**:
   - Buy & Sell support with Market and Limit orders.
   - Exact financial decimal precision (`decimal.js`) preventing floating-point rounding errors.
   - Weighted average cost accounting for multi-tranche purchases.
   - Realized and Unrealized P&L mark-to-market calculations.
   - Atomic database transactions (`prisma.$transaction`) ensuring cash deduction, trade persistence, and position updates occur simultaneously.
6. **Immutable Virtual Capital Ledger**:
   - `fund_transactions` table records all debits/credits (`INITIAL_ALLOCATION`, `TRADE_BUY`, `TRADE_SELL`, `ADMIN_CREDIT`, `ADMIN_DEBIT`) with `balanceBefore` and `balanceAfter`.
7. **Two Isolated Portals & Role-Based Access Control (RBAC)**:
   - **User Portal (`/dashboard`, `/stocks/[symbol]`, `/options/[symbol]`, `/portfolio`, `/orders`, `/watchlist`)**: Paper trading, charting, and portfolio tracking.
   - **Admin Portal (`/admin`)**: User creation, virtual capital allocation, and system audit trail inspection. Normal users cannot access `/admin` or `/api/admin/*`.

---

## 3. Technology Stack

- **Framework**: Next.js 14 (App Router, Server Actions, Route Handlers)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS, Lucide React
- **Database & ORM**: PostgreSQL with Prisma ORM
- **Authentication**: Stateless JOSE HS256 JWT session cookies with bcryptjs password hashing
- **Validation**: Zod
- **Financial Math**: Decimal.js
- **Testing**: Vitest

---

## 4. Setup & Local Development

### Prerequisites
- Node.js LTS (v20+ or v22+)
- PostgreSQL database (e.g., [Neon Serverless Postgres](https://neon.tech), Supabase, or local PostgreSQL)

### 1. Clone & Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Set the variables:
```ini
# PostgreSQL connection string
DATABASE_URL="postgresql://user:password@ep-cool-frost-123456.ap-southeast-1.aws.neon.tech/tradex?sslmode=require"

# Minimum 32-character session encryption secret
AUTH_SECRET="tradex_super_secret_session_jwt_key_at_least_32_chars_2026"

# Market Data Mode: "development" for local offline testing, "live" for production feeds
MARKET_DATA_MODE="development"
MARKET_DATA_API_URL="https://query1.finance.yahoo.com"
MARKET_DATA_API_KEY=""

# Admin seed credentials
ADMIN_EMAIL="admin@tradex.local"
ADMIN_PASSWORD="AdminSecurePassword123!"
```

### 3. Database Migration & Seeding
```bash
# Push schema to PostgreSQL
npm run db:push

# Seed admin and demo users with virtual capital
npm run db:seed
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## 5. Automated Verification & Testing

Run all automated test suites (indicators, financial math, options analysis, market calendar, signal scoring):
```bash
npm test
```

Run TypeScript compilation verification:
```bash
npm run typecheck
```

Run ESLint checks:
```bash
npm run lint
```

Run production build:
```bash
npm run build
```

---

## 6. Vercel Deployment Guide

1. **Create a PostgreSQL Database**:
   - Provision a PostgreSQL database via Neon ([neon.tech](https://neon.tech)) or the Vercel Marketplace.
2. **Deploy to Vercel**:
   - Connect your GitHub repository to Vercel.
   - Framework Preset: **Next.js**.
   - Build Command: `prisma generate && next build` (configured in `package.json`).
3. **Configure Environment Variables in Vercel**:
   - `DATABASE_URL`: Your PostgreSQL connection string.
   - `AUTH_SECRET`: A secure random 32+ character string.
   - `MARKET_DATA_MODE`: Set to `live` for genuine market feeds.
   - `ADMIN_EMAIL`: Admin email address.
   - `ADMIN_PASSWORD`: Strong administrator password.
4. **Run Migrations on Remote Database**:
   ```bash
   npx prisma db push
   npx tsx prisma/seed.ts
   ```

---

## 7. Demo Accounts

- **Administrator**:
  - Email: `admin@tradex.local`
  - Password: `AdminSecurePassword123!`
  - Portal: `/admin`
- **Demo Trader**:
  - Email: `user@tradex.local`
  - Password: `UserSecurePassword123!`
  - Portal: `/dashboard`

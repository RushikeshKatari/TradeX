const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function write(relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf8');
  console.log('Created: ' + relPath);
}

write('types/market.ts', `
export type MarketSessionStatus = 'OPEN' | 'CLOSED' | 'PRE_OPEN' | 'HOLIDAY';

export interface MarketStatus {
  isOpen: boolean;
  status: MarketSessionStatus;
  message: string;
  nextOpen: string;
  nextClose: string;
  timezone: string;
  timestamp: string;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  lastPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  volume: number;
  timestamp: string;
  isDelayed: boolean;
  marketStatus: MarketSessionStatus;
  dataSource: string;
}

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W';

export interface SearchInstrumentResult {
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: 'EQUITY' | 'INDEX' | 'OPTION';
  lastPrice?: number;
  change?: number;
  changePercent?: number;
}
`);

write('types/trading.ts', `
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderStatus = 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface OrderInput {
  symbol: string;
  exchange?: string;
  instrumentType?: 'EQUITY' | 'INDEX' | 'OPTION';
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number;
}

export interface PortfolioSummary {
  cashBalance: number;
  reservedBalance: number;
  investedValue: number;
  currentValue: number;
  totalAccountValue: number;
  totalUnrealizedPnL: number;
  totalRealizedPnL: number;
  todaysPnL: number;
}

export interface PositionView {
  id: string;
  symbol: string;
  exchange: string;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  currentValue: number;
  investedValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
}

export interface HoldingView {
  id: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
}
`);

write('types/options.ts', `
export interface OptionLeg {
  ltp: number;
  change: number;
  volume: number;
  oi: number;
  changeOi: number;
  iv?: number;
  bid?: number;
  ask?: number;
}

export interface OptionStrikeRow {
  strikePrice: number;
  ce: OptionLeg | null;
  pe: OptionLeg | null;
}

export interface OptionChainData {
  underlyingSymbol: string;
  underlyingPrice: number;
  timestamp: string;
  expiryDates: string[];
  selectedExpiry: string;
  strikes: OptionStrikeRow[];
  highestVolumeStrikeCE: {
    strike: number;
    volume: number;
  } | null;
  highestVolumeStrikePE: {
    strike: number;
    volume: number;
  } | null;
  pcr: {
    volumePcr: number;
    oiPcr: number;
  };
  dataSource: string;
  isDelayed: boolean;
}
`);

write('types/user.ts', `
export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface UserSessionPayload {
  userId: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}
`);

write('lib/utils/index.ts', `
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(val: number | string | undefined | null): string {
  if (val === undefined || val === null || isNaN(Number(val))) return '₹0.00';
  const num = Number(val);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatNumber(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0';
  return new Intl.NumberFormat('en-IN').format(val);
}

export function formatPercent(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0.00%';
  const prefix = val > 0 ? '+' : '';
  return prefix + val.toFixed(2) + '%';
}
`);

write('lib/validation/schemas.ts', `
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const orderSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required').toUpperCase(),
  exchange: z.enum(['NSE', 'BSE']).default('NSE'),
  instrumentType: z.enum(['EQUITY', 'INDEX', 'OPTION']).default('EQUITY'),
  side: z.enum(['BUY', 'SELL']),
  orderType: z.enum(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']).default('MARKET'),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  price: z.number().positive('Price must be greater than 0').optional(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric and underscores only'),
  displayName: z.string().min(1).max(50),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'USER']).default('USER'),
  initialCapital: z.number().min(0).default(1000000),
});

export const allocateFundsSchema = z.object({
  amount: z.number().refine((val) => val !== 0, 'Amount cannot be zero'),
  reason: z.string().min(3, 'Reason is required for fund ledger audit'),
});

export const watchlistSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
});
`);

write('lib/db/prisma.ts', `
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
`);

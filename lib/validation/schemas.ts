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

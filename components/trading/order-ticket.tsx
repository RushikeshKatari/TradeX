'use client';

import React, { useState } from 'react';
import { formatINR } from '@/lib/utils';
import { OrderSide, OrderType } from '@/types/trading';
import { Quote } from '@/types/market';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';

interface OrderTicketProps {
  quote: Quote | null;
  userBalance: number;
  onOrderSuccess?: () => void;
}

export function OrderTicket({ quote, userBalance, onOrderSuccess }: OrderTicketProps) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [quantity, setQuantity] = useState<number>(1);
  const [limitPrice, setLimitPrice] = useState<string>(quote?.lastPrice ? String(quote.lastPrice) : '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!quote) return null;

  const currentPrice = quote.lastPrice;
  const effectivePrice = orderType === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : currentPrice;
  const totalCost = quantity * effectivePrice;
  const hasSufficientBalance = side === 'SELL' || userBalance >= totalCost;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: quote.symbol,
          exchange: quote.exchange,
          instrumentType: 'EQUITY',
          side,
          orderType,
          quantity: Number(quantity),
          price: orderType === 'LIMIT' ? Number(limitPrice) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Order execution failed.');
      }

      setMessage({
        type: 'success',
        text: `Paper order executed: ${side} ${quantity} ${quote.symbol} @ ${formatINR(data.executedPrice || effectivePrice)}`,
      });

      if (onOrderSuccess) onOrderSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order could not be processed.';
      setMessage({ type: 'error', text: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-xl">
      <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
        <div>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Paper Trading Order Slip
          </span>
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            {quote.symbol}
            <span className="text-xs font-mono font-normal text-slate-400">
              ({formatINR(quote.lastPrice)})
            </span>
          </h3>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-slate-400 block">Available Cash</span>
          <span className="text-xs font-semibold text-emerald-400 font-mono">
            {formatINR(userBalance)}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* BUY / SELL Switch */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setSide('BUY')}
            className={`py-2 text-xs font-bold rounded-md transition-all ${
              side === 'BUY'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => setSide('SELL')}
            className={`py-2 text-xs font-bold rounded-md transition-all ${
              side === 'SELL'
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            SELL
          </button>
        </div>

        {/* Order Type: MARKET vs LIMIT */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Order Type:</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrderType('MARKET')}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                orderType === 'MARKET'
                  ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setOrderType('LIMIT')}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                orderType === 'LIMIT'
                  ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              Limit
            </button>
          </div>
        </div>

        {/* Limit Price Input if LIMIT selected */}
        {orderType === 'LIMIT' && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Limit Price (₹)</label>
            <input
              type="number"
              step="0.05"
              min="0.05"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
        )}

        {/* Quantity Stepper */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-400">Quantity (Shares)</label>
            <div className="flex gap-1">
              {[1, 5, 25, 50].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuantity(q)}
                  className="px-1.5 py-0.5 text-[10px] bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300"
                >
                  +{q}
                </button>
              ))}
            </div>
          </div>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            required
          />
        </div>

        {/* Margin / Cost Summary */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5 text-xs font-mono">
          <div className="flex justify-between text-slate-400">
            <span>Execution Price:</span>
            <span className="text-slate-200">{formatINR(effectivePrice)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Estimated Value:</span>
            <span className="text-slate-100 font-bold">{formatINR(totalCost)}</span>
          </div>
        </div>

        {/* Feedback Alert */}
        {message && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
              message.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40'
                : 'bg-rose-950/40 text-rose-300 border-rose-800/40'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || (!hasSufficientBalance && side === 'BUY')}
          className={`w-full py-2.5 rounded-lg text-sm font-bold text-white transition-all shadow-lg ${
            side === 'BUY'
              ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
              : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isSubmitting
            ? 'Processing Execution...'
            : `${side} ${quantity} ${quote.symbol}`}
        </button>

        <div className="text-[10px] text-center text-slate-500 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>Paper execution • Virtual cash deducted atomically</span>
        </div>
      </form>
    </div>
  );
}

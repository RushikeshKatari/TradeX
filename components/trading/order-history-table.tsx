'use client';

import React, { useState } from 'react';
import { formatINR } from '@/lib/utils';
import { XCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface OrderItem {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  quantity: number;
  requestedPrice: number | null;
  executedPrice: number | null;
  status: 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
}

interface OrderHistoryTableProps {
  orders: OrderItem[];
  onOrderCancelled?: () => void;
}

export function OrderHistoryTable({ orders, onOrderCancelled }: OrderHistoryTableProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
      if (res.ok && onOrderCancelled) {
        onOrderCancelled();
      }
    } catch {}
    setCancellingId(null);
  };

  return (
    <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Order Log & Historical Executions ({orders.length})
        </h3>
        <span className="text-xs text-slate-500 font-mono">Immutable Order Records</span>
      </div>

      {orders.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          No paper trading orders placed yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                <th className="py-2.5 px-4 text-left">Time (IST)</th>
                <th className="py-2.5 px-3 text-left">Symbol</th>
                <th className="py-2.5 px-3 text-center">Side</th>
                <th className="py-2.5 px-3 text-center">Type</th>
                <th className="py-2.5 px-3 text-right">Quantity</th>
                <th className="py-2.5 px-3 text-right">Req. Price</th>
                <th className="py-2.5 px-3 text-right">Exec. Price</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-4 text-center">Action / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {orders.map((order) => {
                const isBuy = order.side === 'BUY';
                return (
                  <tr key={order.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-left text-slate-400 whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-3 text-left font-bold text-slate-200">{order.symbol}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {order.side}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center text-slate-400">{order.orderType}</td>
                    <td className="py-3 px-3 text-right text-slate-300">{order.quantity}</td>
                    <td className="py-3 px-3 text-right text-slate-400">
                      {order.requestedPrice ? formatINR(order.requestedPrice) : 'MKT'}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-200">
                      {order.executedPrice ? formatINR(order.executedPrice) : '-'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          order.status === 'FILLED'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : order.status === 'OPEN'
                            ? 'bg-cyan-500/20 text-cyan-400'
                            : order.status === 'REJECTED'
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {order.status === 'OPEN' ? (
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={cancellingId === order.id}
                          className="px-2 py-0.5 text-[10px] bg-rose-600/30 text-rose-300 hover:bg-rose-600 hover:text-white rounded border border-rose-500/30 transition-all"
                        >
                          {cancellingId === order.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      ) : order.rejectionReason ? (
                        <span className="text-[10px] text-rose-400/80 truncate max-w-xs block" title={order.rejectionReason}>
                          {order.rejectionReason}
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

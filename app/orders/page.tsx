'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { OrderHistoryTable } from '@/components/trading/order-history-table';
import { Trash2 } from 'lucide-react';
import { formatINR } from '@/lib/utils';

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');
  const [isClearing, setIsClearing] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);

  const loadOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
      const me = await fetch('/api/auth/me');
      if (me.ok) {
        const u = await me.json();
        if (u?.user) setUserRole(u.user.role);
      }
    } catch {}
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleClearHistory = async () => {
    if (orders.length === 0 || isClearing) return;
    const confirmed = window.confirm(
      'Permanently clear all order history for this account, including older records not currently listed, and delete the linked trades? Positions, holdings, cash balance, and fund ledger remain; reserved funds from pending buy orders will be released.',
    );
    if (!confirmed) return;

    setIsClearing(true);
    setHistoryMessage(null);
    try {
      const response = await fetch('/api/orders', { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not clear order history.');
      setHistoryMessage(`Cleared ${result.deletedOrders} orders and ${result.deletedTrades} trades. Released ${formatINR(result.releasedReservedFunds)} from pending-order reserves.`);
      await loadOrders();
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Could not clear order history.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div className="flex items-start justify-between gap-4">
            <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Orders & Execution History</h1>
            <p className="text-xs text-slate-400 mt-1">
              Audit trail of all simulated orders, fills, cancellations, and rejections.
            </p>
            </div>
            <button
              onClick={handleClearHistory}
              disabled={orders.length === 0 || isClearing}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-600/15 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isClearing ? 'Clearing…' : 'Clear All Order History'}
            </button>
          </div>

          {historyMessage && <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">{historyMessage}</div>}

          <OrderHistoryTable orders={orders} onOrderCancelled={loadOrders} />
        </main>
      </div>
    </div>
  );
}

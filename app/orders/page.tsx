'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { OrderHistoryTable } from '@/components/trading/order-history-table';

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<'ADMIN' | 'USER'>('USER');

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

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole={userRole} />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Orders & Execution History</h1>
            <p className="text-xs text-slate-400 mt-1">
              Audit trail of all simulated orders, fills, cancellations, and rejections.
            </p>
          </div>

          <OrderHistoryTable orders={orders} onOrderCancelled={loadOrders} />
        </main>
      </div>
    </div>
  );
}

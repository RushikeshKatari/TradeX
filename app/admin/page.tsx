import React from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { AdminPanel } from '@/components/admin/admin-panel';

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-[#090d16] flex flex-col">
      <Navbar />
      <div className="flex-1 flex">
        <Sidebar userRole="ADMIN" />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div>
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
              Administrative Control Center
            </span>
            <h1 className="text-2xl font-bold text-white tracking-tight mt-0.5">
              User Management & Virtual Capital Allocation
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Create student/learner paper trading accounts, issue virtual capital with immutable audit records, and monitor system activity.
            </p>
          </div>

          <AdminPanel />
        </main>
      </div>
    </div>
  );
}

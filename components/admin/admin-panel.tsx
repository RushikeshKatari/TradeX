'use client';

import React, { useState, useEffect } from 'react';
import { formatINR } from '@/lib/utils';
import { Users, UserPlus, DollarSign, ShieldAlert, CheckCircle, XCircle, Search, RefreshCw, AlertCircle } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  virtualAccount: {
    balance: number;
    reservedBalance: number;
  } | null;
  _count: {
    orders: number;
    trades: number;
    positions: number;
  };
}

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'create' | 'audit'>('users');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Fund allocation modal state
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [fundAmount, setFundAmount] = useState<number>(100000);
  const [fundReason, setFundReason] = useState<string>('Capital top-up for simulation competition');
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New user form state
  const [newUser, setNewUser] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    role: 'USER',
    initialCapital: 1000000,
  });

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {}
    setIsLoading(false);
  };

  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data);
      }
    } catch {}
  };

  useEffect(() => {
    loadUsers();
    loadAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleToggleStatus = async (user: AdminUser) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        loadUsers();
      }
    } catch {}
  };

  const handleAllocateFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setActionMsg(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/funds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(fundAmount),
          reason: fundReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Allocation failed');

      setActionMsg({
        type: 'success',
        text: `Allocated ${formatINR(fundAmount)} to ${selectedUser.displayName} with ledger audit record.`,
      });
      setSelectedUser(null);
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error allocating funds';
      setActionMsg({ type: 'error', text: msg });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionMsg(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setActionMsg({
        type: 'success',
        text: `User ${data.user.displayName} (${data.user.email}) created with ${formatINR(data.user.balance)} virtual capital.`,
      });
      setNewUser({
        email: '',
        username: '',
        displayName: '',
        password: '',
        role: 'USER',
        initialCapital: 1000000,
      });
      setActiveTab('users');
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating user';
      setActionMsg({ type: 'error', text: msg });
    }
  };

  const totalCapitalAllocated = users.reduce((acc, u) => acc + (u.virtualAccount?.balance || 0), 0);

  return (
    <div className="space-y-6">
      {/* Admin KPI Header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase">Total Users</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{users.length}</div>
        </div>

        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase">Total Virtual Capital Issued</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">
            {formatINR(totalCapitalAllocated)}
          </div>
        </div>

        <div className="bg-[#0f172a] border border-border rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase">Security Audits</span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{auditLogs.length} Records</div>
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
            actionMsg.type === 'success'
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40'
              : 'bg-rose-950/40 text-rose-300 border-rose-800/40'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'users'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          User Accounts
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'create'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          + Create User
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'audit'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          System Audit Trail
        </button>
      </div>

      {/* Tab: Users List */}
      {activeTab === 'users' && (
        <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search users by name, username, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={loadUsers}
              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                  <th className="py-2.5 px-4 text-left">User</th>
                  <th className="py-2.5 px-3 text-left">Role</th>
                  <th className="py-2.5 px-3 text-right">Virtual Balance</th>
                  <th className="py-2.5 px-3 text-center">Trades</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 text-left">
                      <span className="font-bold text-slate-200 block">{u.displayName}</span>
                      <span className="text-[11px] text-slate-400 block">{u.email}</span>
                      <span className="text-[10px] text-slate-500">@{u.username}</span>
                    </td>
                    <td className="py-3 px-3 text-left">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.role === 'ADMIN' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-400">
                      {formatINR(u.virtualAccount?.balance ?? 0)}
                    </td>
                    <td className="py-3 px-3 text-center text-slate-300">{u._count.trades}</td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.status === 'ACTIVE'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setSelectedUser(u)}
                          className="px-2.5 py-1 text-[11px] bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white rounded border border-indigo-500/30 transition-all font-semibold"
                        >
                          Allocate Funds
                        </button>
                        <button
                          onClick={() => handleToggleStatus(u)}
                          className={`px-2.5 py-1 text-[11px] rounded border transition-all font-semibold ${
                            u.status === 'ACTIVE'
                              ? 'bg-rose-950/30 text-rose-300 border-rose-800/40 hover:bg-rose-600 hover:text-white'
                              : 'bg-emerald-950/30 text-emerald-300 border-emerald-800/40 hover:bg-emerald-600 hover:text-white'
                          }`}
                        >
                          {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Create User Form */}
      {activeTab === 'create' && (
        <div className="bg-[#0f172a] border border-border rounded-xl p-6 shadow-xl max-w-xl">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-indigo-400" />
            <span>Create New User & Provision Virtual Capital</span>
          </h3>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Email Address</label>
              <input
                type="email"
                required
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Initial Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Initial Capital (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={newUser.initialCapital}
                  onChange={(e) => setNewUser({ ...newUser, initialCapital: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-lg shadow-indigo-600/20 transition-all text-sm mt-2"
            >
              Provision Account
            </button>
          </form>
        </div>
      )}

      {/* Tab: System Audit Trail */}
      {activeTab === 'audit' && (
        <div className="bg-[#0f172a] border border-border rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Immutable Security & Execution Audit Logs ({auditLogs.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-border text-[11px]">
                  <th className="py-2.5 px-4 text-left">Timestamp (IST)</th>
                  <th className="py-2.5 px-3 text-left">Action</th>
                  <th className="py-2.5 px-3 text-left">Entity</th>
                  <th className="py-2.5 px-3 text-left">User</th>
                  <th className="py-2.5 px-4 text-left">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-2.5 px-4 text-left text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-left font-bold text-indigo-300">{log.action}</td>
                    <td className="py-2.5 px-3 text-left text-slate-400">{log.entity}</td>
                    <td className="py-2.5 px-3 text-left text-slate-300">
                      {log.user ? `${log.user.displayName} (@${log.user.username})` : 'System'}
                    </td>
                    <td className="py-2.5 px-4 text-left text-slate-400 max-w-md truncate">
                      {log.details ? JSON.stringify(log.details) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fund Allocation Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-border rounded-xl p-6 shadow-2xl max-w-md w-full">
            <h3 className="text-base font-bold text-white mb-1">Allocate Virtual Capital</h3>
            <p className="text-xs text-slate-400 mb-4">
              Adjust balance for <strong className="text-slate-200">{selectedUser.displayName}</strong>. Creates an immutable ledger entry in <code className="text-indigo-400">fund_transactions</code>.
            </p>

            <form onSubmit={handleAllocateFunds} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="1000"
                  required
                  value={fundAmount}
                  onChange={(e) => setFundAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Positive to credit, negative to debit.</span>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Reason (Mandatory for Audit Trail)</label>
                <input
                  type="text"
                  required
                  value={fundReason}
                  onChange={(e) => setFundReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
                >
                  Confirm Allocation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import {
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  PieChart,
  User,
  CreditCard,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatCurrency, formatTimeAgo } from "@/lib/utils";

interface DebtItem {
  id: number;
  person: string;
  amount: number;
  currency: string;
  description: string;
  is_debt: number; // 1 = owed to me, 2 = i owe
  created_at: string;
}

interface ExpenseItem {
  id: number;
  amount: number;
  currency: string;
  category: string;
  description: string;
  person?: string;
  is_debt: number;
  created_at: string;
}

interface LedgerData {
  total_spent: number;
  owed_to_me: number;
  i_owe: number;
  net_debt_balance: number;
  by_category: { category: string; total: number; count: number }[];
  debts: DebtItem[];
  recent: ExpenseItem[];
}

export default function LedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLedger = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/proxy/ledger");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchLedger();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <Receipt className="w-6 h-6 text-emerald-400" />
          <span>Financial Ledger & Expense Tracker</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Real-time expense logs, debt balances, and "who owes whom" tracking (ADR 0001).
        </p>
      </div>

      {loading || !data ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Calculating financial totals...</span>
        </div>
      ) : (
        <>
          {/* Key Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Personal Spent */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#0D1322]/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <span>Personal Expenses</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div id="ledger-total-spent" className="text-2xl font-bold text-white font-mono">
                {formatCurrency(data.total_spent)}
              </div>
              <p className="text-[11px] text-slate-500">Tracked personal expenditures</p>
            </div>

            {/* Owed to Me */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#0D1322]/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                <span>Owed To Me</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div id="ledger-owed-to-me" className="text-2xl font-bold text-emerald-400 font-mono">
                {formatCurrency(data.owed_to_me)}
              </div>
              <p className="text-[11px] text-slate-500">Receivable from contacts</p>
            </div>

            {/* I Owe */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#0D1322]/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-red-400 uppercase tracking-wider">
                <span>I Owe Others</span>
                <TrendingDown className="w-4 h-4 text-red-400" />
              </div>
              <div id="ledger-i-owe" className="text-2xl font-bold text-red-400 font-mono">
                {formatCurrency(data.i_owe)}
              </div>
              <p className="text-[11px] text-slate-500">Payable debts</p>
            </div>

            {/* Net Debt Balance */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#0D1322]/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-cyan-400 uppercase tracking-wider">
                <span>Net Debt Balance</span>
                <CreditCard className="w-4 h-4 text-cyan-400" />
              </div>
              <div
                id="ledger-net-balance"
                className={`text-2xl font-bold font-mono ${
                  data.net_debt_balance >= 0 ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {data.net_debt_balance >= 0 ? "+" : ""}
                {formatCurrency(data.net_debt_balance)}
              </div>
              <p className="text-[11px] text-slate-500">Net receivable vs payable</p>
            </div>
          </div>

          {/* Section: Who Owes Whom */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <User className="w-5 h-5 text-amber-400" />
              <span>Who Owes Whom (Active Debts & Credits)</span>
            </h2>

            {data.debts.length === 0 ? (
              <div className="p-8 text-center glass-panel rounded-xl border border-slate-800 text-slate-400 text-sm">
                No active outstanding debts or receivables recorded.
              </div>
            ) : (
              <div id="ledger-debts-list" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.debts.map((debt) => {
                  const isReceivable = debt.is_debt === 1;
                  return (
                    <div
                      key={debt.id}
                      className="glass-panel rounded-xl p-4 border border-slate-800 bg-[#0D1322]/70 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                            isReceivable
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-red-500/10 text-red-400 border border-red-500/20"
                          }`}
                        >
                          {isReceivable ? (
                            <ArrowDownLeft className="w-4 h-4" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">
                            {debt.person || "Unknown Contact"}
                          </div>
                          <div className="text-xs text-slate-400">
                            {debt.description || "Uncategorized"}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div
                          className={`font-mono font-bold text-sm ${
                            isReceivable ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {isReceivable ? "+ " : "- "}
                          {formatCurrency(debt.amount, debt.currency)}
                        </div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          {isReceivable ? "Owes You" : "You Owe"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Category Breakdown & Recent Expenses */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Category Breakdown */}
            <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <PieChart className="w-4 h-4 text-cyan-400" />
                <span>Spending by Category</span>
              </h3>
              <div className="space-y-3">
                {data.by_category.map((cat) => {
                  const pct = data.total_spent > 0 ? (cat.total / data.total_spent) * 100 : 0;
                  return (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300 font-medium">{cat.category}</span>
                        <span className="text-slate-400 font-mono">{formatCurrency(cat.total)}</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="lg:col-span-2 glass-panel rounded-2xl p-5 border border-slate-800 space-y-4">
              <h3 className="font-bold text-white text-sm">Recent Transactions</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">
                    <tr>
                      <th className="pb-2">Description</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Time</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {data.recent.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 font-medium text-white">{item.description}</td>
                        <td className="py-2.5 text-slate-400">{item.category}</td>
                        <td className="py-2.5 text-slate-500">{formatTimeAgo(item.created_at)}</td>
                        <td className="py-2.5 text-right font-mono font-semibold text-slate-200">
                          {formatCurrency(item.amount, item.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

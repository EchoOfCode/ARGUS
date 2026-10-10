"use client";

import React, { useState, useEffect } from "react";
import {
  Server,
  QrCode,
  Shield,
  Cpu,
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Zap,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

interface StatusData {
  brain_healthy: boolean;
  whatsapp_connected: boolean;
  last_message_at: string | null;
  qr_code: string | null;
  llm_provider: string;
  llm_model: string;
  kill_switch_active: boolean;
  stats: {
    pending_approvals: number;
    contacts: number;
    memories: number;
    expenses: number;
  };
}

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/proxy/status");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Server className="w-6 h-6 text-emerald-400" />
            <span>System Status & Infrastructure</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time diagnostics, WhatsApp connection state, pairing QR code, and AI model health.
          </p>
        </div>

        <button
          onClick={fetchStatus}
          disabled={refreshing}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          <span>Refresh Health</span>
        </button>
      </div>

      {loading || !data ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Querying system heartbeat...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Main 2-column Grid: WhatsApp Status + AI Brain Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* WhatsApp Connection State */}
            <div
              id="status-whatsapp-card"
              className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4 bg-[#0D1322]/70"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center font-bold",
                      data.whatsapp_connected
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    )}
                  >
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">WhatsApp Web Gateway</h3>
                    <p className="text-xs text-slate-400">@whiskeysockets/baileys client</p>
                  </div>
                </div>

                <span
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                    data.whatsapp_connected
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse"
                  )}
                >
                  {data.whatsapp_connected ? "Connected" : "Unpaired / Waiting"}
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-300 font-mono bg-[#080C14] p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status:</span>
                  <span className={data.whatsapp_connected ? "text-emerald-400" : "text-amber-400"}>
                    {data.whatsapp_connected ? "Active & Synchronized" : "Waiting for phone pairing"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Message Received:</span>
                  <span>{formatTimeAgo(data.last_message_at)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Architecture:</span>
                  <span>Single Sender Policy Engine (Bridge Dispatcher)</span>
                </div>
              </div>

              {/* QR Code Section (if unlinked) */}
              {data.qr_code ? (
                <div id="status-qr-container" className="pt-2 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                    <QrCode className="w-4 h-4" />
                    <span>Scan with WhatsApp (Linked Devices):</span>
                  </div>
                  <div className="bg-white p-4 rounded-xl flex items-center justify-center font-mono text-[9px] leading-none whitespace-pre select-all overflow-x-auto text-black">
                    {data.qr_code}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Open WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device to authenticate ARGUS.
                  </p>
                </div>
              ) : data.whatsapp_connected ? (
                <div className="flex items-center gap-2 text-xs text-emerald-400 pt-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Session authenticated. Bridge actively monitoring inbound events.</span>
                </div>
              ) : null}
            </div>

            {/* AI Brain Backend Health */}
            <div
              id="status-brain-card"
              className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4 bg-[#0D1322]/70"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">ARGUS AI Brain Core</h3>
                    <p className="text-xs text-slate-400">FastAPI backend & agent engine</p>
                  </div>
                </div>

                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Healthy
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-300 font-mono bg-[#080C14] p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between">
                  <span className="text-slate-500">LLM Provider:</span>
                  <span id="status-model-provider" className="text-cyan-400 font-semibold uppercase">
                    {data.llm_provider}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Active Model:</span>
                  <span>{data.llm_model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Database Role:</span>
                  <span className="text-emerald-400">Single SQLite Writer (WAL Mode)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Autonomy Killswitch:</span>
                  <span className={data.kill_switch_active ? "text-red-400 font-bold" : "text-slate-400"}>
                    {data.kill_switch_active ? "ENGAGED" : "Disengaged (Normal)"}
                  </span>
                </div>
              </div>

              <div className="pt-1">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Enforcing HMAC-SHA256 token authorization on all endpoints.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Database Entities Inventory Grid */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>Database Ledger Inventory</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="glass-panel rounded-xl p-4 border border-slate-800 text-center space-y-1">
                <div className="text-2xl font-bold font-mono text-amber-400">
                  {data.stats.pending_approvals}
                </div>
                <div className="text-xs text-slate-400">Pending Approvals</div>
              </div>

              <div className="glass-panel rounded-xl p-4 border border-slate-800 text-center space-y-1">
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {data.stats.contacts}
                </div>
                <div className="text-xs text-slate-400">Direct Contacts</div>
              </div>

              <div className="glass-panel rounded-xl p-4 border border-slate-800 text-center space-y-1">
                <div className="text-2xl font-bold font-mono text-cyan-400">
                  {data.stats.memories}
                </div>
                <div className="text-xs text-slate-400">Second Brain Facts</div>
              </div>

              <div className="glass-panel rounded-xl p-4 border border-slate-800 text-center space-y-1">
                <div className="text-2xl font-bold font-mono text-purple-400">
                  {data.stats.expenses}
                </div>
                <div className="text-xs text-slate-400">Financial Records</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

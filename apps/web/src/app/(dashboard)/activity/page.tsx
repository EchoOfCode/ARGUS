"use client";

import React, { useState, useEffect } from "react";
import {
  Activity,
  Shield,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

interface AuditEntry {
  id: number;
  timestamp: string;
  target_jid: string;
  contact_name: string;
  trigger_type: string;
  tier: number;
  content_sha256: string;
  latency_ms: number;
  verdict: string;
  rejection_reason?: string | null;
}

interface MessageEntry {
  id: number;
  chat_jid: string;
  chat_name?: string | null;
  sender_jid: string;
  sender_name?: string | null;
  message_text: string;
  timestamp: string;
  is_from_me: number;
  created_at: string;
}

export default function ActivityPage() {
  const [activeTab, setActiveTab] = useState<"audit" | "messages">("audit");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/proxy/activity");
        if (res.ok) {
          const json = await res.json();
          setAuditLog(json.audit_log || []);
          setMessages(json.messages || []);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchActivity();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-emerald-400" />
            <span>Activity Log & Outbound Audit Trail</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Tamper-proof record of policy verdicts and incoming WhatsApp messages (ADR 0003).
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-2 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
          <button
            id="activity-audit-tab"
            onClick={() => setActiveTab("audit")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "audit"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white"
            )}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Outbound Policy Audit</span>
          </button>
          <button
            id="activity-messages-tab"
            onClick={() => setActiveTab("messages")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5",
              activeTab === "messages"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:text-white"
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>WhatsApp Messages Mirror</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Fetching event trail...</span>
        </div>
      ) : activeTab === "audit" ? (
        /* Tab 1: Audit Log */
        <div id="activity-feed" className="space-y-3">
          {auditLog.length === 0 ? (
            <div className="p-8 text-center glass-panel rounded-2xl border border-white/5 text-slate-400 text-sm">
              No audit log entries recorded yet.
            </div>
          ) : (
            auditLog.map((entry) => {
              const isApproved = entry.verdict === "approved" || entry.verdict === "edited_approved";
              const isDraftOnly = entry.verdict === "draft_only";
              const isRejected = entry.verdict === "rejected" || entry.verdict === "declined";

              return (
                <div
                  key={entry.id}
                  className="glass-panel rounded-xl p-4 border border-slate-800 bg-[#0D1322]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                        isApproved
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : isDraftOnly
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      )}
                    >
                      {isApproved ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : isDraftOnly ? (
                        <Clock className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white text-sm">
                          {entry.contact_name}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-slate-800 text-slate-400">
                          Tier {entry.tier}
                        </span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          trigger: {entry.trigger_type}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                        <span>hash: {entry.content_sha256?.substring(0, 12)}...</span>
                        <span>latency: {entry.latency_ms}ms</span>
                        {entry.rejection_reason && (
                          <span className="text-amber-400">reason: {entry.rejection_reason}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-1">
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
                        isApproved
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : isDraftOnly
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-red-500/20 text-red-300 border border-red-500/30"
                      )}
                    >
                      {entry.verdict}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Tab 2: WhatsApp Messages Mirror */
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="p-8 text-center glass-panel rounded-2xl border border-white/5 text-slate-400 text-sm">
              No WhatsApp messages recorded in database yet.
            </div>
          ) : (
            messages.map((msg) => {
              const isFromMe = msg.is_from_me === 1;
              return (
                <div
                  key={msg.id}
                  className="glass-panel rounded-xl p-4 border border-slate-800 bg-[#0D1322]/60 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between text-slate-400">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-md flex items-center justify-center font-bold text-[10px]",
                          isFromMe ? "bg-emerald-500/20 text-emerald-400" : "bg-cyan-500/20 text-cyan-400"
                        )}
                      >
                        {isFromMe ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                      </div>
                      <span className="font-semibold text-white">
                        {isFromMe ? "You (Owner)" : msg.sender_name || msg.sender_jid.split("@")[0]}
                      </span>
                      {msg.chat_name && msg.chat_name !== msg.sender_name && (
                        <span className="text-slate-500">in {msg.chat_name}</span>
                      )}
                    </div>
                    <span className="text-slate-500 font-mono text-[11px]">
                      {formatTimeAgo(msg.timestamp || msg.created_at)}
                    </span>
                  </div>

                  <p className="text-slate-200 text-sm leading-relaxed pl-8">
                    {msg.message_text}
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

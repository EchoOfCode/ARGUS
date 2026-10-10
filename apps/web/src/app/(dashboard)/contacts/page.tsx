"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  Zap,
  Clock,
  FileText,
  CheckCircle2,
  Phone,
  PowerOff,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

interface Contact {
  jid: string;
  name: string;
  is_group: number;
  tier: number;
  status: "active" | "disabled";
  auto_reply_count: number;
  last_replied_at: string | null;
}

const TIER_DESCRIPTIONS: Record<number, { label: string; desc: string; color: string; icon: any }> = {
  0: {
    label: "Tier 0: Draft Only",
    desc: "Default safe mode. Assistant drafts replies to Approvals Inbox; zero messages sent autonomously.",
    color: "text-slate-300 border-slate-700 bg-slate-800/50",
    icon: FileText,
  },
  1: {
    label: "Tier 1: Supervised",
    desc: "15-minute approval token. Requires owner confirmation before dispatch.",
    color: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    icon: Clock,
  },
  2: {
    label: "Tier 2: Autonomous",
    desc: "High trust. Sends immediately with 8-second undo grace period.",
    color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
    icon: Zap,
  },
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingJid, setUpdatingJid] = useState<string | null>(null);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [ksLoading, setKsLoading] = useState(false);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const [cRes, ksRes] = await Promise.all([
        fetch("/api/proxy/contacts"),
        fetch("/api/proxy/killswitch"),
      ]);
      if (cRes.ok) {
        const data = await cRes.json();
        setContacts(Array.isArray(data) ? data : []);
      }
      if (ksRes.ok) {
        const ksData = await ksRes.json();
        setKillSwitchActive(Boolean(ksData.active));
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleTierChange = async (jid: string, newTier: number, currentStatus: string) => {
    setUpdatingJid(jid);
    try {
      const res = await fetch(`/api/proxy/contacts/${encodeURIComponent(jid)}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: newTier, status: currentStatus }),
      });
      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.jid === jid ? { ...c, tier: newTier } : c))
        );
      }
    } finally {
      setUpdatingJid(null);
    }
  };

  const handleStatusToggle = async (jid: string, currentTier: number, currentStatus: string) => {
    setUpdatingJid(jid);
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    try {
      const res = await fetch(`/api/proxy/contacts/${encodeURIComponent(jid)}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: currentTier, status: newStatus }),
      });
      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.jid === jid ? { ...c, status: newStatus } : c))
        );
      }
    } finally {
      setUpdatingJid(null);
    }
  };

  const handleToggleKillSwitch = async () => {
    setKsLoading(true);
    const next = !killSwitchActive;
    try {
      const res = await fetch("/api/proxy/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (res.ok) {
        setKillSwitchActive(next);
      }
    } finally {
      setKsLoading(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Users className="w-6 h-6 text-emerald-400" />
            <span>Contacts & Autonomy Policy</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure per-contact autonomy tiers (ADR 0003) and emergency controls.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
      </div>

      {/* Global Emergency Autonomy Kill Switch Banner */}
      <div
        className={cn(
          "glass-panel rounded-2xl p-5 border flex flex-col md:flex-row md:items-center justify-between gap-4",
          killSwitchActive
            ? "border-red-500/40 bg-red-500/10"
            : "border-slate-800 bg-[#0D1322]/60"
        )}
      >
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
              killSwitchActive
                ? "bg-red-500/20 text-red-300 border-red-500/40"
                : "bg-slate-800 text-slate-400 border-slate-700"
            )}
          >
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-base">Global Emergency Kill Switch</h3>
              {killSwitchActive && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/30 text-red-200 border border-red-500/40">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Engaging the kill switch immediately overrides all Tier 1 and Tier 2 rules across all contacts, forcing all assistant outbound activity into Tier 0 (Draft Only).
            </p>
          </div>
        </div>

        <button
          onClick={handleToggleKillSwitch}
          disabled={ksLoading}
          className={cn(
            "px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap shadow-lg",
            killSwitchActive
              ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20"
              : "bg-red-500 hover:bg-red-600 text-white shadow-red-500/20"
          )}
        >
          <PowerOff className="w-4 h-4" />
          <span>{killSwitchActive ? "Disengage Kill Switch" : "Activate Kill Switch"}</span>
        </button>
      </div>

      {/* Tier Explanation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((tierNum) => {
          const t = TIER_DESCRIPTIONS[tierNum];
          const Icon = t.icon;
          return (
            <div key={tierNum} className="glass-panel rounded-xl p-4 border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Icon className="w-4 h-4 text-emerald-400" />
                <span className="text-white">{t.label}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{t.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Contacts Table / Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Loading contacts directory...</span>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="p-12 text-center glass-panel rounded-2xl border border-white/5 space-y-2">
          <p className="text-slate-400 text-sm">No contacts matching your query.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0D1322] border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-5">Contact</th>
                  <th className="py-3.5 px-5">Identifier (JID)</th>
                  <th className="py-3.5 px-5">Autonomy Tier</th>
                  <th className="py-3.5 px-5">Rule Status</th>
                  <th className="py-3.5 px-5 text-right">Replies Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredContacts.map((contact) => {
                  const phoneOnly = contact.jid.replace("@s.whatsapp.net", "");
                  const isUpdating = updatingJid === contact.jid;

                  return (
                    <tr
                      key={contact.jid}
                      className="hover:bg-slate-800/25 transition-colors group"
                    >
                      {/* Name */}
                      <td className="py-4 px-5 font-medium text-white flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
                          {contact.name.charAt(0).toUpperCase()}
                        </div>
                        <span>{contact.name}</span>
                      </td>

                      {/* Phone / JID */}
                      <td className="py-4 px-5 text-slate-400 font-mono text-xs">
                        +{phoneOnly}
                      </td>

                      {/* Autonomy Tier Selector */}
                      <td className="py-4 px-5">
                        <select
                          id={`contact-tier-select-${contact.jid}`}
                          value={contact.tier}
                          disabled={isUpdating || killSwitchActive}
                          onChange={(e) =>
                            handleTierChange(contact.jid, parseInt(e.target.value, 10), contact.status)
                          }
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                        >
                          <option value={0}>Tier 0 (Draft Only)</option>
                          <option value={1}>Tier 1 (Supervised)</option>
                          <option value={2}>Tier 2 (Autonomous)</option>
                        </select>
                      </td>

                      {/* Status Toggle */}
                      <td className="py-4 px-5">
                        <button
                          id={`contact-status-toggle-${contact.jid}`}
                          disabled={isUpdating}
                          onClick={() => handleStatusToggle(contact.jid, contact.tier, contact.status)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer border",
                            contact.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                              : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                          )}
                        >
                          {contact.status}
                        </button>
                      </td>

                      {/* Replies */}
                      <td className="py-4 px-5 text-right font-mono text-xs text-slate-300">
                        {contact.auto_reply_count}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

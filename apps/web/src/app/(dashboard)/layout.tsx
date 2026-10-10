"use client";

import React, { useState, useEffect } from "react";
import Link from "next/navigation";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Inbox,
  Users,
  Brain,
  Receipt,
  Activity,
  Server,
  Shield,
  ShieldAlert,
  LogOut,
  Menu,
  X,
  PowerOff,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/approvals", label: "Approvals Inbox", icon: Inbox, badgeKey: "approvals" },
  { href: "/contacts", label: "Contacts & Autonomy", icon: Users },
  { href: "/memory", label: "Second Brain", icon: Brain },
  { href: "/ledger", label: "Ledger & Expenses", icon: Receipt },
  { href: "/activity", label: "Activity Log", icon: Activity },
  { href: "/status", label: "System Status", icon: Server },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [whatsappConnected, setWhatsappConnected] = useState(true);
  const [loadingKillswitch, setLoadingKillswitch] = useState(false);

  // Poll system status & killswitch every 10 seconds
  const fetchStatus = async () => {
    try {
      const [statusRes, ksRes, apprRes] = await Promise.all([
        fetch("/api/proxy/status"),
        fetch("/api/proxy/killswitch"),
        fetch("/api/proxy/approvals?status=pending"),
      ]);

      if (statusRes.ok) {
        const sData = await statusRes.json();
        setWhatsappConnected(Boolean(sData.whatsapp_connected));
      }
      if (ksRes.ok) {
        const kData = await ksRes.json();
        setKillSwitchActive(Boolean(kData.active));
      }
      if (apprRes.ok) {
        const aData = await apprRes.json();
        setPendingApprovalsCount(Array.isArray(aData) ? aData.length : 0);
      }
    } catch {
      // Ignore background network blips
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleKillSwitch = async () => {
    setLoadingKillswitch(true);
    const nextState = !killSwitchActive;
    try {
      const res = await fetch("/api/proxy/killswitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextState }),
      });
      if (res.ok) {
        setKillSwitchActive(nextState);
      }
    } catch {
      // Revert if error
    } finally {
      setLoadingKillswitch(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080C14] text-slate-100">
      {/* ─── Global Autonomy Killswitch Alert Bar (When Active) ─── */}
      {killSwitchActive && (
        <div
          id="kill-switch-active-banner"
          className="bg-red-500/15 border-b border-red-500/30 px-4 py-2.5 text-xs font-medium text-red-300 flex items-center justify-between gap-3 animate-pulse"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>
              <strong>EMERGENCY AUTONOMY KILL SWITCH ACTIVE:</strong> All assistant-initiated sends are strictly quarantined to Draft Only (Tier 0).
            </span>
          </div>
          <button
            onClick={handleToggleKillSwitch}
            disabled={loadingKillswitch}
            className="px-3 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 text-xs font-semibold cursor-pointer transition-all"
          >
            Disengage Kill Switch
          </button>
        </div>
      )}

      {/* ─── Topbar ─── */}
      <header className="h-16 border-b border-slate-800/80 bg-[#0D1322]/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <a href="/chat" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-500 p-0.5 shadow-md shadow-emerald-500/20">
              <div className="w-full h-full bg-[#080C14] rounded-[10px] flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-base">ARGUS</span>
              <span className="hidden sm:inline-block ml-2 px-1.5 py-0.5 text-[10px] font-mono tracking-wider uppercase rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                v2.1
              </span>
            </div>
          </a>
        </div>

        <div className="flex items-center gap-3">
          {/* WhatsApp Connection Indicator */}
          <div
            id="whatsapp-status-indicator"
            className={cn(
              "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
              whatsappConnected
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            )}
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                whatsappConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              )}
            />
            <span>{whatsappConnected ? "WhatsApp Live" : "WhatsApp Unlinked"}</span>
          </div>

          {/* Global Kill Switch Toggle Button */}
          <button
            id="global-kill-switch-toggle"
            onClick={handleToggleKillSwitch}
            disabled={loadingKillswitch}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer border",
              killSwitchActive
                ? "bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30"
                : "bg-slate-800/80 text-slate-300 border-slate-700/80 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
            )}
            title="Emergency Kill Switch: immediately halts all autonomous sends"
          >
            <PowerOff className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {killSwitchActive ? "Kill Switch Active" : "Emergency Kill Switch"}
            </span>
          </button>

          {/* Logout */}
          <button
            id="logout-button"
            onClick={handleLogout}
            className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ─── Main Content Area with Sidebar ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden sm:flex flex-col w-64 border-r border-slate-800/80 bg-[#0A0F1D]/60 p-4 space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
            Navigation
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            const hasBadge = item.badgeKey === "approvals" && pendingApprovalsCount > 0;

            return (
              <a
                key={item.href}
                href={item.href}
                id={`nav-${item.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                className={cn(
                  "flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      "w-4 h-4 transition-colors",
                      isActive ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-300"
                    )}
                  />
                  <span>{item.label}</span>
                </div>
                {hasBadge && (
                  <span
                    id="pending-approvals-badge"
                    className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  >
                    {pendingApprovalsCount}
                  </span>
                )}
              </a>
            );
          })}

          <div className="mt-auto pt-4 border-t border-slate-800/60">
            <div className="glass-panel-subtle rounded-xl p-3 text-xs text-slate-400">
              <div className="flex items-center gap-2 text-slate-300 font-semibold mb-1">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>Single-Owner Core</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Outbound policy engine active. Draft-only default enabled.
              </p>
            </div>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 top-16 z-50 bg-[#080C14]/95 backdrop-blur-xl p-6 sm:hidden space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Navigation
            </div>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              const hasBadge = item.badgeKey === "approvals" && pendingApprovalsCount > 0;

              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center justify-between px-4 py-3 rounded-xl text-base font-medium transition-all",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "text-slate-300 hover:bg-slate-800/40"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-emerald-400" />
                    <span>{item.label}</span>
                  </div>
                  {hasBadge && (
                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300">
                      {pendingApprovalsCount}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

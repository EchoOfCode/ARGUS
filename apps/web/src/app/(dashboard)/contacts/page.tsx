"use client";

import React, { useState, useEffect, useRef } from "react";
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
  UserPlus,
  Upload,
  RefreshCw,
  Trash2,
  X,
  FileSpreadsheet,
  AlertCircle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Contact {
  jid: string;
  name: string;
  is_group: number;
  tier: number;
  status: "active" | "disabled";
  auto_reply_count: number;
  last_replied_at: string | null;
}

interface ParsedContactItem {
  name: string;
  phone: string;
  tier: number;
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

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scanningHistory, setScanningHistory] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Add Contact Form State
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addTier, setAddTier] = useState(0);
  const [addingContact, setAddingContact] = useState(false);

  // Import State
  const [importMode, setImportMode] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState("");
  const [parsedContacts, setParsedContacts] = useState<ParsedContactItem[]>([]);
  const [importingBatch, setImportingBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (text: string, type: "success" | "error" = "success") => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const [cRes, ksRes] = await Promise.all([
        fetch("/api/proxy/contacts"),
        fetch("/api/proxy/killswitch"),
      ]);
      if (cRes.ok) {
        const data = await cRes.json();
        const validContacts = (Array.isArray(data) ? data : []).filter(
          (c) => c && c.jid && !c.jid.endsWith("@lid") && !c.jid.includes("@lid") && !c.jid.includes("@broadcast")
        );
        setContacts(validContacts);
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
        showToast("Autonomy tier updated.");
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

  const handleDeleteContact = async (jid: string, name: string) => {
    if (!confirm(`Are you sure you want to remove ${name || jid} from contacts?`)) return;
    try {
      const res = await fetch(`/api/proxy/contacts/${encodeURIComponent(jid)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setContacts((prev) => prev.filter((c) => c.jid !== jid));
        showToast(`Contact removed.`);
      }
    } catch {
      showToast("Failed to delete contact.", "error");
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

  const handleScanHistory = async () => {
    setScanningHistory(true);
    try {
      const res = await fetch("/api/proxy/contacts/scan-history", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast(`Discovered and synced ${data.discovered_count} contacts from message logs.`);
        await fetchContacts();
      } else {
        showToast("Error scanning chat logs.", "error");
      }
    } catch {
      showToast("Network error scanning chat history.", "error");
    } finally {
      setScanningHistory(false);
    }
  };

  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim() || !addPhone.trim()) return;
    setAddingContact(true);
    try {
      const res = await fetch("/api/proxy/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          phone: addPhone.trim(),
          tier: addTier,
        }),
      });
      if (res.ok) {
        showToast(`Added ${addName} to directory.`);
        setAddName("");
        setAddPhone("");
        setAddTier(0);
        setShowAddModal(false);
        await fetchContacts();
      } else {
        showToast("Failed to add contact.", "error");
      }
    } catch {
      showToast("Error submitting contact.", "error");
    } finally {
      setAddingContact(false);
    }
  };

  // ─── Contact File / Paste Parsing (.vcf vCard and .csv) ────────
  const parseVCard = (text: string): ParsedContactItem[] => {
    const cards = text.split(/BEGIN:VCARD/i).slice(1);
    const results: ParsedContactItem[] = [];

    for (const card of cards) {
      let name = "";
      const fnMatch = card.match(/FN(?:;[^:]*)?:([^\r\n]+)/i);
      if (fnMatch) {
        name = fnMatch[1].trim();
      } else {
        const nMatch = card.match(/N(?:;[^:]*)?:([^\r\n]+)/i);
        if (nMatch) {
          name = nMatch[1].split(";").filter(Boolean).join(" ").trim();
        }
      }

      const telRegex = /TEL(?:;[^:]*)?:([^\r\n]+)/gi;
      let telMatch: RegExpExecArray | null;
      while ((telMatch = telRegex.exec(card)) !== null) {
        const phone = telMatch[1].trim();
        const digits = phone.replace(/[^0-9]/g, "");
        if (digits.length >= 7) {
          results.push({
            name: name || `Contact ${phone}`,
            phone,
            tier: 0,
          });
          break; // Use primary number
        }
      }
    }
    return results;
  };

  const parseCsvOrText = (text: string): ParsedContactItem[] => {
    const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const results: ParsedContactItem[] = [];

    for (const line of lines) {
      if (line.toLowerCase().startsWith("name,") || line.toLowerCase().startsWith("phone,")) continue;

      let name = "";
      let phone = "";

      if (line.includes(",")) {
        const parts = line.split(",");
        name = parts[0].trim();
        phone = parts[1]?.trim() || "";
      } else if (line.includes(":")) {
        const parts = line.split(":");
        name = parts[0].trim();
        phone = parts[1]?.trim() || "";
      } else if (line.includes("\t")) {
        const parts = line.split("\t");
        name = parts[0].trim();
        phone = parts[1]?.trim() || "";
      } else {
        const match = line.match(/^([a-zA-Z\s]+)\s+([\+\d\s\-]{7,20})$/);
        if (match) {
          name = match[1].trim();
          phone = match[2].trim();
        }
      }

      const digits = phone.replace(/[^0-9]/g, "");
      if (digits.length >= 7) {
        results.push({
          name: name || `Contact ${digits}`,
          phone,
          tier: 0,
        });
      }
    }
    return results;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "");
      let parsed: ParsedContactItem[] = [];
      if (file.name.endsWith(".vcf") || content.includes("BEGIN:VCARD")) {
        parsed = parseVCard(content);
      } else {
        parsed = parseCsvOrText(content);
      }
      setParsedContacts(parsed);
    };
    reader.readAsText(file);
  };

  const handlePasteChange = (val: string) => {
    setPasteText(val);
    if (val.includes("BEGIN:VCARD")) {
      setParsedContacts(parseVCard(val));
    } else {
      setParsedContacts(parseCsvOrText(val));
    }
  };

  const handleBatchImportSubmit = async () => {
    if (parsedContacts.length === 0) return;
    setImportingBatch(true);
    try {
      const res = await fetch("/api/proxy/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: parsedContacts }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Successfully imported ${data.imported_count} contacts!`);
        setShowImportModal(false);
        setParsedContacts([]);
        setPasteText("");
        await fetchContacts();
      } else {
        showToast("Error importing contacts.", "error");
      }
    } catch {
      showToast("Network error during batch import.", "error");
    } finally {
      setImportingBatch(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    if (!c || !c.jid) return false;
    if (c.jid.endsWith("@lid") || c.jid.includes("@lid") || c.jid.includes("@broadcast")) return false;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div
          className={cn(
            "fixed top-20 right-6 z-50 px-4 py-3 rounded-xl border flex items-center gap-2.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2",
            notification.type === "success"
              ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/40"
              : "bg-red-950/90 text-red-300 border-red-500/40"
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-xs font-medium">{notification.text}</span>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Users className="w-6 h-6 text-emerald-400" />
            <span>Contacts & Autonomy Directory</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage your verified WhatsApp address book, import phone contacts, and configure per-contact autonomy.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleScanHistory}
            disabled={scanningHistory}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
            title="Scan past WhatsApp message logs to import contacts"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-cyan-400", scanningHistory && "animate-spin")} />
            <span>{scanningHistory ? "Scanning..." : "Sync Chat History"}</span>
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import Contacts (.vcf / CSV)</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Contact</span>
          </button>
        </div>
      </div>

      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or number..."
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
        <div className="text-xs text-slate-400">
          Showing <strong className="text-emerald-400">{filteredContacts.length}</strong> of{" "}
          <strong className="text-white">{contacts.length}</strong> saved contacts
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
        {Object.entries(TIER_DESCRIPTIONS).map(([tierKey, config]) => {
          const Icon = config.icon;
          return (
            <div key={tierKey} className="glass-panel rounded-2xl p-4 border border-slate-800/80">
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn("p-1.5 rounded-lg border", config.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <h4 className="font-semibold text-sm text-white">{config.label}</h4>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{config.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Contacts Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm">
          Loading WhatsApp address book...
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="p-12 text-center glass-panel rounded-2xl border border-slate-800 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">No contacts found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Your directory is currently empty. Click <strong>Import Contacts</strong> to upload your phone's <code>.vcf</code> or spreadsheet, or click <strong>Sync Chat History</strong>.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
            >
              Import Contacts (.vcf)
            </button>
            <button
              onClick={handleScanHistory}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Sync from Chat Logs
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContacts.map((contact) => {
            const tierConfig = TIER_DESCRIPTIONS[contact.tier] || TIER_DESCRIPTIONS[0];
            const TierIcon = tierConfig.icon;
            const isUpdating = updatingJid === contact.jid;
            const displayPhone = contact.jid.replace("@s.whatsapp.net", "");

            return (
              <div
                key={contact.jid}
                className={cn(
                  "glass-panel rounded-2xl p-5 border transition-all flex flex-col justify-between group",
                  contact.status === "disabled"
                    ? "opacity-60 border-slate-800/50"
                    : "border-slate-800 hover:border-slate-700"
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-emerald-400 shrink-0">
                        {contact.name.charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-white text-sm truncate" title={contact.name}>
                          {contact.name}
                        </h4>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 font-mono">
                          <Phone className="w-3 h-3 text-slate-500" />
                          <span>+{displayPhone}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteContact(contact.jid, contact.name)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove contact"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Current Autonomy Tier Badge */}
                  <div className="mt-3 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TierIcon className={cn("w-3.5 h-3.5", tierConfig.color.split(" ")[0])} />
                      <span className="text-xs font-semibold text-slate-200">
                        {tierConfig.label.split(":")[0]}
                      </span>
                    </div>

                    {/* Tier selector dropdown */}
                    <select
                      value={contact.tier}
                      disabled={isUpdating || killSwitchActive}
                      onChange={(e) =>
                        handleTierChange(contact.jid, parseInt(e.target.value), contact.status)
                      }
                      className="bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                    >
                      <option value={0}>Tier 0: Draft</option>
                      <option value={1}>Tier 1: Supervised</option>
                      <option value={2}>Tier 2: Autonomous</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Auto-replies sent: <strong className="text-white">{contact.auto_reply_count}</strong></span>
                  <button
                    onClick={() => handleStatusToggle(contact.jid, contact.tier, contact.status)}
                    disabled={isUpdating}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors",
                      contact.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    {contact.status === "active" ? "Active" : "Disabled"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── MODAL 1: ADD SINGLE CONTACT ─────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-[#080C14]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel bg-[#0D1322] border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <UserPlus className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-white text-lg">Add New Contact</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddContactSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Full Name / Identifier
                </label>
                <input
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  required
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210 or 9876543210"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Includes international prefix. 10-digit numbers default to +91 (India).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Initial Autonomy Tier
                </label>
                <select
                  value={addTier}
                  onChange={(e) => setAddTier(parseInt(e.target.value))}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
                >
                  <option value={0}>Tier 0: Draft Only (Quarantined to Approvals Inbox)</option>
                  <option value={1}>Tier 1: Supervised (15-min Owner Approval Token)</option>
                  <option value={2}>Tier 2: Autonomous (Instant Send with 8s Undo Window)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingContact}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20"
                >
                  {addingContact ? "Saving..." : "Save Contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: BATCH IMPORT CONTACTS (.vcf / CSV) ─────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-[#080C14]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel bg-[#0D1322] border border-slate-800 rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">Import Contacts</h3>
                  <p className="text-xs text-slate-400">
                    Upload your phone's exported contacts (.vcf vCard) or a CSV spreadsheet
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs: Upload vs Paste */}
            <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
              <button
                onClick={() => setImportMode("file")}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  importMode === "file"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "text-slate-400 hover:text-white"
                )}
              >
                Upload File (.vcf / .csv)
              </button>
              <button
                onClick={() => setImportMode("paste")}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  importMode === "paste"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "text-slate-400 hover:text-white"
                )}
              >
                Paste Contacts Text
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 flex-1 pr-1">
              {importMode === "file" ? (
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".vcf,.csv,text/vcard,text/csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-900/40 hover:bg-slate-900/80 space-y-2"
                  >
                    <Upload className="w-8 h-8 text-emerald-400 mx-auto" />
                    <h4 className="text-sm font-semibold text-white">
                      Click to choose or drop contact file
                    </h4>
                    <p className="text-xs text-slate-400">
                      Standard vCard (<strong>.vcf</strong> from Samsung/iPhone/Google) or <strong>.csv</strong> spreadsheet
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Paste contacts (Name, Phone or vCard format):
                  </label>
                  <textarea
                    rows={6}
                    value={pasteText}
                    onChange={(e) => handlePasteChange(e.target.value)}
                    placeholder={"Alex, +91 98765 43210\nSarah: 9876543211\nDr. Smith 9988776655"}
                    className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
              )}

              {/* Preview Table */}
              {parsedContacts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>Parsed Contacts Preview:</span>
                    <span className="text-emerald-400">{parsedContacts.length} detected</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/80 divide-y divide-slate-800 text-xs">
                    {parsedContacts.slice(0, 100).map((c, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between">
                        <span className="font-medium text-white truncate max-w-[50%]">{c.name}</span>
                        <span className="font-mono text-slate-400">{c.phone}</span>
                      </div>
                    ))}
                    {parsedContacts.length > 100 && (
                      <div className="px-3 py-2 text-center text-slate-500 text-[11px]">
                        ...and {parsedContacts.length - 100} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
              <span className="text-xs text-slate-400">
                {parsedContacts.length > 0 ? `Ready to import ${parsedContacts.length} contacts` : "No contacts parsed yet"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBatchImportSubmit}
                  disabled={parsedContacts.length === 0 || importingBatch}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 disabled:opacity-40"
                >
                  {importingBatch ? "Importing..." : `Import ${parsedContacts.length} Contacts`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

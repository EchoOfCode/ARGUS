"use client";

import React, { useState, useEffect } from "react";
import {
  Brain,
  Plus,
  Trash2,
  Tag,
  ShieldCheck,
  Search,
  Sparkles,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

interface MemoryItem {
  id: number;
  fact_text: string;
  category: string;
  entities: string[];
  created_at: string;
  updated_at: string;
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/proxy/memory");
      if (res.ok) {
        const data = await res.json();
        setMemories(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/proxy/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fact_text: newFact.trim(),
          category: newCategory.trim() || "general",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to save memory.");
        return;
      }

      setNewFact("");
      setNewCategory("general");
      setModalOpen(false);
      fetchMemories();
    } catch {
      setErrorMsg("Error connecting to memory engine.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/proxy/memory/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      }
    } catch {
      // Ignore
    }
  };

  const filtered = memories.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.fact_text.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      (m.entities || []).some((e) => e.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Brain className="w-6 h-6 text-cyan-400" />
            <span>Second Brain & Long-Term Memory</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Browse and manage persistent facts, preferences, and contextual knowledge.
          </p>
        </div>

        <button
          id="add-memory-button"
          onClick={() => setModalOpen(true)}
          className="px-4 py-2.5 rounded-xl font-semibold text-xs text-slate-950 bg-gradient-to-r from-emerald-500 to-cyan-400 hover:opacity-95 shadow-lg shadow-emerald-500/20 flex items-center gap-2 cursor-pointer transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Fact</span>
        </button>
      </div>

      {/* Security Architecture Guarantee Banner */}
      <div
        id="zero-credential-security-banner"
        className="glass-panel rounded-2xl p-4 border border-cyan-500/30 bg-cyan-500/5 flex items-start gap-3.5"
      >
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0 text-cyan-400">
          <Lock className="w-4 h-4" />
        </div>
        <div className="text-xs">
          <div className="font-semibold text-white flex items-center gap-2">
            <span>Guaranteed Zero-Credential Exposure</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300">
              ADR 0004
            </span>
          </div>
          <p className="text-slate-400 mt-0.5 leading-relaxed">
            Sensitive credentials, passwords, and API secrets are never stored in plain text memories and are fundamentally excluded from this interface. Secrets reside in the encrypted Fernet vault and cannot be queried by the web client.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter memories by keyword, entity, or category..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        />
      </div>

      {/* Memories Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Consulting Second Brain...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center glass-panel rounded-2xl border border-white/5 space-y-2">
          <p className="text-slate-400 text-sm">No memories found matching your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((memory) => (
            <div
              key={memory.id}
              id={`memory-item-${memory.id}`}
              className="glass-panel glass-card-hover rounded-2xl p-5 border border-slate-800 bg-[#0D1322]/60 flex flex-col justify-between gap-4 group"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" />
                    <span>{memory.category}</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {formatTimeAgo(memory.created_at)}
                  </span>
                </div>

                <p className="text-sm text-slate-200 leading-relaxed font-sans">
                  {memory.fact_text}
                </p>

                {memory.entities && memory.entities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {memory.entities.map((ent, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded text-[11px] bg-slate-800/80 text-slate-400 font-mono"
                      >
                        #{ent}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-slate-800/60">
                <button
                  id={`delete-memory-button-${memory.id}`}
                  onClick={() => handleDelete(memory.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  title="Delete memory"
                  aria-label="Delete memory"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Memory Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl p-6 border border-white/10 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span>Record New Memory Fact</span>
            </h3>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateMemory} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Fact / Knowledge Note
                </label>
                <textarea
                  id="memory-fact-input"
                  value={newFact}
                  onChange={(e) => setNewFact(e.target.value)}
                  placeholder="e.g. 'Prefers dark roast coffee with almond milk' or 'Dentist appointment is Dr. Smith on Elm St'..."
                  rows={4}
                  className="w-full p-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="general, preferences, health, contacts, work..."
                  className="w-full p-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  id="save-memory-submit"
                  type="submit"
                  disabled={submitting || !newFact.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-500 to-cyan-400 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save to Second Brain"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

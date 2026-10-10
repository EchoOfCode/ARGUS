"use client";

import React, { useState, useEffect } from "react";
import {
  Inbox,
  CheckCircle,
  Edit3,
  XCircle,
  Clock,
  ShieldCheck,
  User,
  AlertCircle,
  Save,
  RotateCcw,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

interface ApprovalItem {
  id: string;
  target_jid: string;
  contact_name: string;
  draft_text: string;
  content_sha256: string;
  trigger_type: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "approved" | "edited" | "declined";
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [feedback, setFeedback] = useState<{ id: string; msg: string; type: "success" | "error" } | null>(null);

  const fetchApprovals = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/proxy/approvals?status=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setApprovals(Array.isArray(data) ? data : []);
      }
    } catch {
      // Ignore network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, [filter]);

  const handleAction = async (id: string, action: "approve" | "edit" | "decline") => {
    setActionLoading(id);
    setFeedback(null);
    try {
      const payload: any = { action };
      if (action === "edit") {
        if (!editText.trim()) {
          setFeedback({ id, msg: "Edited message text cannot be empty.", type: "error" });
          setActionLoading(null);
          return;
        }
        payload.edited_text = editText.trim();
      }

      const res = await fetch(`/api/proxy/approvals/${encodeURIComponent(id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setFeedback({ id, msg: data.error || "Action failed.", type: "error" });
        return;
      }

      setFeedback({
        id,
        msg: `Outbound draft ${action === "approve" ? "approved" : action === "edit" ? "edited & approved" : "declined"} and logged to immutable audit trail.`,
        type: "success",
      });

      setEditingId(null);
      // Refresh list
      fetchApprovals();
    } catch {
      setFeedback({ id, msg: "Failed to connect to backend server.", type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  const startEdit = (item: ApprovalItem) => {
    setEditingId(item.id);
    setEditText(item.draft_text);
    setFeedback(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Inbox className="w-6 h-6 text-amber-400" />
            <span>Outbound Approvals Inbox</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Human-in-the-loop firewall for assistant-generated messages (ADR 0003 & 0004).
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
          <button
            id="approvals-filter-pending"
            onClick={() => setFilter("pending")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              filter === "pending"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:text-white"
            )}
          >
            Pending Review
          </button>
          <button
            id="approvals-filter-all"
            onClick={() => setFilter("all")}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              filter === "all"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-white"
            )}
          >
            Audit History (All)
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 glass-panel rounded-2xl">
          <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
          <span>Loading outbound drafts...</span>
        </div>
      ) : approvals.length === 0 ? (
        <div className="p-12 text-center glass-panel rounded-2xl border border-white/5 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">Inbox Clean</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {filter === "pending"
              ? "No pending outbound drafts require approval. ARGUS will pause and notify you whenever Tier 1 or Tier 0 assistant replies are drafted."
              : "No historical approval drafts found in database."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((item) => {
            const isEditing = editingId === item.id;
            const isPending = item.status === "pending";

            return (
              <div
                key={item.id}
                id={`approval-item-${item.id}`}
                className={cn(
                  "glass-panel rounded-2xl p-5 border transition-all space-y-4",
                  isPending ? "border-amber-500/30 bg-[#0D1322]/80 shadow-lg shadow-amber-500/5" : "border-slate-800 bg-[#0A0F1D]/50"
                )}
              >
                {/* Top Row: Contact & Badges */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 font-bold border border-slate-700">
                      <User className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-white text-base flex items-center gap-2">
                        <span>{item.contact_name}</span>
                        <span className="text-xs font-mono text-slate-400 font-normal">
                          ({item.target_jid.split("@")[0]})
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Created {formatTimeAgo(item.created_at)}</span>
                        <span>•</span>
                        <span className="uppercase text-[10px] tracking-wider font-semibold text-cyan-400">
                          {item.trigger_type}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider",
                        item.status === "pending"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse"
                          : item.status === "approved" || item.status === "edited"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-red-500/20 text-red-300 border border-red-500/30"
                      )}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>

                {/* Draft Content (Display or Inline Edit) */}
                <div className="rounded-xl bg-[#05070B] border border-slate-800 p-4 font-sans text-sm text-slate-200 leading-relaxed">
                  {isEditing ? (
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-amber-400">
                        Edit outbound message before approving:
                      </label>
                      <textarea
                        id={`edit-draft-input-${item.id}`}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="w-full p-3 bg-[#080C14] border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          id={`save-edit-button-${item.id}`}
                          onClick={() => handleAction(item.id, "edit")}
                          disabled={actionLoading === item.id}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save & Approve</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{item.draft_text}</p>
                  )}
                </div>

                {/* Feedback Message */}
                {feedback && feedback.id === item.id && (
                  <div
                    className={cn(
                      "p-3 rounded-xl text-xs flex items-center gap-2",
                      feedback.type === "success"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border border-red-500/20"
                    )}
                  >
                    {feedback.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span>{feedback.msg}</span>
                  </div>
                )}

                {/* Actions (Only when pending) */}
                {isPending && !isEditing && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-slate-850">
                    <button
                      id={`decline-button-${item.id}`}
                      onClick={() => handleAction(item.id, "decline")}
                      disabled={actionLoading === item.id}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Decline</span>
                    </button>

                    <button
                      id={`edit-button-${item.id}`}
                      onClick={() => startEdit(item)}
                      disabled={actionLoading === item.id}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Draft</span>
                    </button>

                    <button
                      id={`approve-button-${item.id}`}
                      onClick={() => handleAction(item.id, "approve")}
                      disabled={actionLoading === item.id}
                      className="px-5 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 shadow-md shadow-emerald-500/20 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Approve Outbound Send</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

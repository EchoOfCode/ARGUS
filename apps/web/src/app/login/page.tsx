"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Key, ArrowRight, AlertCircle, Eye, EyeOff, Lock } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/chat";

  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessKey.trim()) {
      setError("Please enter your owner access key.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: accessKey.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Authentication failed.");
        setLoading(false);
        return;
      }

      // Success: redirect to intended page
      router.push(from);
      router.refresh();
    } catch {
      setError("Unable to connect to ARGUS server. Please check your connection.");
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-md glass-panel rounded-2xl p-8 border border-white/10 shadow-2xl backdrop-blur-xl">
      {/* Header Icon */}
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-cyan-500 p-0.5 mb-4 shadow-lg shadow-emerald-500/20">
          <div className="w-full h-full bg-[#0D1322] rounded-[14px] flex items-center justify-center">
            <Shield className="w-8 h-8 text-emerald-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
          ARGUS Control Plane
        </h1>
        <p className="text-sm text-slate-400">
          Single-Owner AI Chief of Staff & Outbound Firewall
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          id="login-error-message"
          className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
          <div className="leading-snug">{error}</div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="access-key-input"
            className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2"
          >
            Owner Access Key
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Key className="w-4 h-4" />
            </div>
            <input
              id="access-key-input"
              name="accessKey"
              type={showKey ? "text" : "password"}
              autoComplete="current-password"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="Enter ARGUS_WEB_ACCESS_KEY"
              disabled={loading}
              className="w-full pl-10 pr-11 py-3 bg-[#080C14]/80 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
              aria-label={showKey ? "Hide access key" : "Show access key"}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Configured in your backend environment file.
          </p>
        </div>

        <button
          id="login-submit-button"
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Verifying Credentials...
            </span>
          ) : (
            <>
              <span>Access Control Plane</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Security Footer */}
      <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-center gap-2 text-xs text-slate-500 text-center">
        <Lock className="w-3.5 h-3.5 text-emerald-500/70" />
        <span>Constant-time HMAC verification & IP rate-limiting</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-[#080C14] overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />

      <Suspense fallback={
        <div className="glass-panel p-8 rounded-2xl text-slate-400 text-sm">
          Loading ARGUS Secure Login...
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}

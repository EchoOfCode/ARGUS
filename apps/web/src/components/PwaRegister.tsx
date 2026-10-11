"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    // 1. Register Service Worker
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((reg) => {
            console.log("[PWA] Service Worker registered with scope:", reg.scope);
          })
          .catch((err) => {
            console.warn("[PWA] Service Worker registration failed:", err);
          });
      });
    }

    // 2. Check if already installed / standalone
    if (typeof window !== "undefined") {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(isStandaloneMode);

      // Listen for display mode changes
      const mediaQuery = window.matchMedia("(display-mode: standalone)");
      const handleDisplayModeChange = (e: MediaQueryListEvent) => {
        setIsStandalone(e.matches);
        if (e.matches) setShowInstallBanner(false);
      };
      mediaQuery.addEventListener("change", handleDisplayModeChange);

      // 3. Capture beforeinstallprompt for Android / Chrome install banner
      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        // Only show if not dismissed in this session
        const dismissed = sessionStorage.getItem("pwa_install_dismissed");
        if (!dismissed) {
          setShowInstallBanner(true);
        }
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

      return () => {
        mediaQuery.removeEventListener("change", handleDisplayModeChange);
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setShowInstallBanner(false);
      }
    } catch (err) {
      console.error("[PWA] Error launching install prompt:", err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowInstallBanner(false);
    sessionStorage.setItem("pwa_install_dismissed", "true");
  };

  if (isStandalone || !showInstallBanner || !deferredPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="glass-panel rounded-2xl p-4 shadow-2xl shadow-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-3 bg-[#0D1322]/95 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-500 p-0.5 shadow-md shadow-emerald-500/20 shrink-0">
            <div className="w-full h-full bg-[#080C14] rounded-[10px] flex items-center justify-center">
              <Download className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white">Install ARGUS App</h4>
            <p className="text-xs text-slate-400">Add to your home screen for instant access</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleInstallClick}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#080C14] font-semibold text-xs shadow-md transition-all active:scale-95"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

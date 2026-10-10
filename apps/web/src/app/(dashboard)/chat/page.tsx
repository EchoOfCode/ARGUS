"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Square,
  Bot,
  User,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolCall {
  id: string;
  name: string;
  args?: any;
  result?: any;
  status: "running" | "completed" | "error";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  status?: "streaming" | "done" | "error";
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content:
        "Greetings. I am ARGUS, your autonomous Chief of Staff. I have real-time access to your WhatsApp contacts, message history, Second Brain, and calendar. How can I assist you today?",
      status: "done",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = inputValue.trim();
    if (!prompt || isStreaming) return;

    setInputValue("");

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    const newMessages: Message[] = [
      ...messages,
      { id: userMsgId, role: "user", content: prompt, status: "done" },
      { id: assistantMsgId, role: "assistant", content: "", toolCalls: [], status: "streaming" },
    ];

    setMessages(newMessages);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/proxy/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let eventType = "message";
          let dataStr = "";

          const eventMatch = trimmed.match(/^event:\s*(.+)$/m);
          if (eventMatch) eventType = eventMatch[1].trim();

          const dataMatch = trimmed.match(/^data:\s*(.+)$/m);
          if (dataMatch) dataStr = dataMatch[1].trim();

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === "TEXT_MESSAGE_CHUNK") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: msg.content + (data.content || "") }
                    : msg
                )
              );
            } else if (eventType === "TOOL_CALL_START") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        toolCalls: [
                          ...(msg.toolCalls || []),
                          {
                            id: data.tool_call_id,
                            name: data.name,
                            args: data.args,
                            status: "running",
                          },
                        ],
                      }
                    : msg
                )
              );
            } else if (eventType === "TOOL_CALL_RESULT") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        toolCalls: (msg.toolCalls || []).map((tc) =>
                          tc.id === data.tool_call_id
                            ? { ...tc, result: data.result, status: "completed" }
                            : tc
                        ),
                      }
                    : msg
                )
              );
            } else if (eventType === "RUN_FINISHED") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId ? { ...msg, status: "done" } : msg
                )
              );
            } else if (eventType === "RUN_ERROR") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: msg.content + `\n\n[Error: ${data.error || "Agent execution interrupted"}]`,
                        status: "error",
                      }
                    : msg
                )
              );
            }
          } catch {
            // Ignore non-json chunk fragments
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: msg.content || "Error: Connection lost with ARGUS brain backend.",
                  status: "error",
                }
              : msg
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInputValue(prompt);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-h-[900px] glass-panel rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-slate-800/80 bg-[#0D1322]/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">ARGUS Executive Interface</h2>
            <p className="text-xs text-slate-400">AG-UI Server-Sent Events Stream with Tool Execution</p>
          </div>
        </div>

        {isStreaming && (
          <button
            id="chat-stop-button"
            onClick={handleStop}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold cursor-pointer transition-all"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop Generating</span>
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div
        id="chat-messages-container"
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#080C14]/40"
      >
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={cn("flex gap-3 max-w-3xl", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold",
                  isUser
                    ? "bg-emerald-500 text-slate-950 font-bold"
                    : "bg-slate-800 text-emerald-400 border border-slate-700"
                )}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div className="space-y-2 max-w-[85%]">
                <div
                  className={cn(
                    "p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap",
                    isUser
                      ? "bg-emerald-600 text-white rounded-tr-none shadow-md shadow-emerald-700/20"
                      : "glass-panel-subtle text-slate-200 rounded-tl-none border border-slate-800"
                  )}
                >
                  {message.content}
                  {message.status === "streaming" && !message.content && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 animate-pulse">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Thinking & consulting tools...</span>
                    </span>
                  )}
                </div>

                {/* Render Tool Invocations */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {message.toolCalls.map((tc) => (
                      <div
                        key={tc.id}
                        className="glass-panel text-xs rounded-xl p-3 border border-slate-800 space-y-1"
                      >
                        <div className="flex items-center justify-between text-slate-300 font-mono">
                          <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                            <Wrench className="w-3.5 h-3.5" />
                            <span>tool: {tc.name}</span>
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {tc.status === "completed" ? (
                              <span className="flex items-center gap-1 text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> executed
                              </span>
                            ) : (
                              <span className="animate-pulse text-amber-400">running...</span>
                            )}
                          </span>
                        </div>
                        {tc.args && (
                          <div className="text-[11px] text-slate-400 font-mono overflow-x-auto bg-[#05070B] p-1.5 rounded">
                            args: {JSON.stringify(tc.args)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-4 py-2 border-t border-slate-800/40 bg-[#0D1322]/40 flex gap-2 overflow-x-auto text-xs">
        <button
          onClick={() => handleQuickPrompt("What are my pending tasks and reminders for today?")}
          className="whitespace-nowrap px-3 py-1 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700/60 transition-colors cursor-pointer"
        >
          📅 Today's reminders
        </button>
        <button
          onClick={() => handleQuickPrompt("Summarize my financial ledger and who owes me money.")}
          className="whitespace-nowrap px-3 py-1 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700/60 transition-colors cursor-pointer"
        >
          💰 Debt & ledger summary
        </button>
        <button
          onClick={() => handleQuickPrompt("Check pending outbound approval drafts.")}
          className="whitespace-nowrap px-3 py-1 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border border-slate-700/60 transition-colors cursor-pointer"
        >
          📥 Pending approvals
        </button>
      </div>

      {/* Input Box */}
      <form onSubmit={handleSend} className="p-4 bg-[#0D1322]/90 border-t border-slate-800/80">
        <div className="relative flex items-center">
          <input
            id="chat-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Instruct ARGUS (e.g. 'Draft reply to Alice' or 'Remind me tomorrow at 4pm')..."
            disabled={isStreaming}
            className="w-full pl-4 pr-12 py-3.5 bg-[#080C14] border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all font-sans"
          />
          <button
            id="chat-send-button"
            type="submit"
            disabled={isStreaming || !inputValue.trim()}
            className="absolute right-2 p-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

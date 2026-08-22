import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const ArgusDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ─── 60-Second Apple Commercial Timeline (1800 frames @ 30fps) ───
  // Beat 1: 0 - 250 (0 - 8.3s) — Macro Titanium Reveal & "Meet ARGUS"
  // Beat 2: 250 - 530 (8.3 - 17.6s) — Cognitive Second Brain
  // Beat 3: 530 - 810 (17.6 - 27s) — Outbound Drafter & Interactive Safety Controls
  // Beat 4: 810 - 1090 (27 - 36.3s) — 3-Tier WhatsApp Group Catch-up
  // Beat 5: 1090 - 1370 (36.3 - 45.6s) — Direct Gmail IMAP & 1-Tap Google Calendar Sync
  // Beat 6: 1370 - 1600 (45.6 - 53.3s) — Whisper Voice Notes & Daily Executive Briefing
  // Beat 7: 1600 - 1800 (53.3 - 60s) — Apple Outro & "Designed by Yusuf"

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif",
        color: "#FFFFFF",
        overflow: "hidden",
      }}
    >
      {/* Studio Dramatic Rim Lighting & Volumetric Glow */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "1400px",
          height: "700px",
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(37, 211, 102, 0.09) 0%, rgba(0, 240, 255, 0.05) 35%, rgba(0,0,0,0) 70%)",
          filter: "blur(140px)",
        }}
      />

      {/* Titanium Dynamic Studio Reflections */}
      <div
        style={{
          position: "absolute",
          bottom: "-30%",
          right: "10%",
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(16, 185, 129, 0.07) 0%, rgba(0,0,0,0) 70%)",
          filter: "blur(120px)",
        }}
      />

      {/* ─── BEAT 1: Macro Titanium Reveal & Intro ─── */}
      {frame >= 0 && frame < 250 && <AppleMacroIntro frame={frame} fps={fps} />}

      {/* ─── BEAT 2: Cognitive Second Brain ─── */}
      {frame >= 250 && frame < 530 && (
        <AppleSecondBrain frame={frame - 250} fps={fps} />
      )}

      {/* ─── BEAT 3: Outbox Drafter & Dispatcher ─── */}
      {frame >= 530 && frame < 810 && (
        <AppleOutboxDrafter frame={frame - 530} fps={fps} />
      )}

      {/* ─── BEAT 4: 3-Tier Group Catch-up ─── */}
      {frame >= 810 && frame < 1090 && (
        <AppleGroupCatchup frame={frame - 810} fps={fps} />
      )}

      {/* ─── BEAT 5: Gmail IMAP & Google Calendar ─── */}
      {frame >= 1090 && frame < 1370 && (
        <AppleGmailAndCalendar frame={frame - 1090} fps={fps} />
      )}

      {/* ─── BEAT 6: Whisper Voice & Daily Briefing ─── */}
      {frame >= 1370 && frame < 1600 && (
        <AppleVoiceAndBriefing frame={frame - 1370} fps={fps} />
      )}

      {/* ─── BEAT 7: Apple Cinematic Outro ─── */}
      {frame >= 1600 && <AppleCinematicOutro frame={frame - 1600} fps={fps} />}
    </AbsoluteFill>
  );
};

// ─── HYPER-REALISTIC BRUSHED TITANIUM IPHONE FRAME ───────────────
const TitaniumPhone: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tiltY?: number;
  tiltX?: number;
  scale?: number;
  opacity?: number;
}> = ({
  title,
  subtitle = "online • ARGUS Brain Active",
  children,
  tiltY = 0,
  tiltX = 0,
  scale = 1,
  opacity = 1,
}) => {
    return (
      <div
        style={{
          width: "740px",
          height: "920px",
          borderRadius: "56px",
          padding: "12px",
          // Brushed Titanium Bezel with Rim Highlight
          background:
            "linear-gradient(135deg, #475569 0%, #1E293B 25%, #0F172A 50%, #334155 75%, #1E293B 100%)",
          boxShadow:
            "0 50px 120px -20px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.2), inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.8)",
          transform: `perspective(1400px) rotateY(${tiltY}deg) rotateX(${tiltX}deg) scale(${scale})`,
          opacity,
          display: "flex",
          flexDirection: "column",
          transition: "transform 0.1s ease-out",
        }}
      >
        {/* Glossy Black Glass Screen */}
        <div
          style={{
            flex: 1,
            borderRadius: "46px",
            background: "#0B141A",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            boxShadow: "inset 0 0 0 2px #000000",
          }}
        >
          {/* Dynamic Island */}
          <div
            style={{
              position: "absolute",
              top: "14px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "140px",
              height: "34px",
              borderRadius: "20px",
              background: "#000000",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 14px",
              zIndex: 10,
              boxShadow: "0 2px 10px rgba(0,0,0,0.8)",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#25D366",
                boxShadow: "0 0 8px #25D366",
              }}
            />
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8" }}>
              ARGUS AI
            </div>
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "#1E293B",
              }}
            />
          </div>

          {/* iOS Status Bar */}
          <div
            style={{
              height: "50px",
              padding: "0 32px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
              background: "#111B21",
            }}
          >
            <span>9:41</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span>5G</span>
              <span>100% 🔋</span>
            </div>
          </div>

          {/* WhatsApp Header */}
          <div
            style={{
              height: "72px",
              background: "#202C33",
              display: "flex",
              alignItems: "center",
              padding: "0 22px",
              gap: "16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #25D366 0%, #00F0FF 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                boxShadow: "0 4px 16px rgba(37,211,102,0.4)",
              }}
            >
              🤖
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#E9EDEF" }}>
                {title}
              </div>
              <div style={{ fontSize: "13px", color: "#25D366", fontWeight: 500 }}>
                {subtitle}
              </div>
            </div>
          </div>

          {/* Chat Body */}
          <div
            style={{
              flex: 1,
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              background: "#0B141A",
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
              overflow: "hidden",
            }}
          >
            {children}
          </div>

          {/* WhatsApp Bottom Input */}
          <div
            style={{
              height: "68px",
              background: "#202C33",
              display: "flex",
              alignItems: "center",
              padding: "0 18px",
              gap: "14px",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "44px",
                background: "#2A3942",
                borderRadius: "24px",
                padding: "0 20px",
                display: "flex",
                alignItems: "center",
                color: "#8696A0",
                fontSize: "15px",
              }}
            >
              Ask ARGUS or send command...
            </div>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "50%",
                background: "#00A884",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                boxShadow: "0 4px 12px rgba(0,168,132,0.4)",
              }}
            >
              🎙️
            </div>
          </div>
        </div>
      </div>
    );
  };

// WhatsApp User Chat Bubble (Green)
const UserBubble: React.FC<{ text: string; time?: string }> = ({
  text,
  time = "9:41 AM",
}) => (
  <div
    style={{
      alignSelf: "flex-end",
      background: "#005C4B",
      color: "#E9EDEF",
      padding: "14px 18px",
      borderRadius: "20px 20px 4px 20px",
      maxWidth: "82%",
      fontSize: "17px",
      lineHeight: "1.4",
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
    }}
  >
    <div>{text}</div>
    <div
      style={{
        fontSize: "11px",
        color: "rgba(255,255,255,0.6)",
        textAlign: "right",
        marginTop: "4px",
      }}
    >
      {time} ✓✓
    </div>
  </div>
);

// WhatsApp Bot Chat Bubble (Dark Charcoal)
const BotBubble: React.FC<{ children: React.ReactNode; time?: string }> = ({
  children,
  time = "9:41 AM",
}) => (
  <div
    style={{
      alignSelf: "flex-start",
      background: "#202C33",
      color: "#E9EDEF",
      padding: "16px 20px",
      borderRadius: "20px 20px 20px 4px",
      maxWidth: "90%",
      fontSize: "16px",
      lineHeight: "1.5",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}
  >
    {children}
    <div
      style={{
        fontSize: "11px",
        color: "#8696A0",
        textAlign: "right",
        marginTop: "6px",
      }}
    >
      {time}
    </div>
  </div>
);

// ─── BEAT 1: Macro Titanium Reveal & "Meet ARGUS" (0 - 8.3s) ────
const AppleMacroIntro: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 30], [0, 1]);
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const panX = interpolate(frame, [0, 250], [60, 0]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      {/* Left: Cinematic Keynote Typography */}
      <div style={{ width: "780px", transform: `translateX(${panX}px)` }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#25D366",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          Special Event • February 2026
        </div>
        <h1
          style={{
            fontSize: "92px",
            fontWeight: 800,
            lineHeight: "1.0",
            letterSpacing: "-3px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Meet ARGUS.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #25D366 0%, #00F0FF 50%, #3B82F6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            The Personal AI OS.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0 0 36px 0",
          }}
        >
          Your cognitive Second Brain and executive Chief of Staff. Living
          natively inside WhatsApp.
        </p>

        <div style={{ display: "flex", gap: "16px" }}>
          <div
            style={{
              background: "rgba(37, 211, 102, 0.12)",
              border: "1px solid rgba(37, 211, 102, 0.3)",
              color: "#25D366",
              padding: "10px 22px",
              borderRadius: "20px",
              fontSize: "18px",
              fontWeight: 600,
            }}
          >
            🔒 100% Local & Private
          </div>
          <div
            style={{
              background: "rgba(0, 240, 255, 0.12)",
              border: "1px solid rgba(0, 240, 255, 0.3)",
              color: "#00F0FF",
              padding: "10px 22px",
              borderRadius: "20px",
              fontSize: "18px",
              fontWeight: 600,
            }}
          >
            ⚡ Groq Llama 3.3 Powered
          </div>
        </div>
      </div>

      {/* Right: Titanium iPhone */}
      <TitaniumPhone
        title="ARGUS AI"
        tiltY={-8}
        tiltX={4}
        scale={scale}
      >
        <UserBubble text="help" />
        <BotBubble>
          <div style={{ color: "#25D366", fontWeight: 700, fontSize: "17px" }}>
            🤖 ARGUS Executive Assistant Active:
          </div>
          <div style={{ margin: "8px 0", color: "#CBD5E1" }}>
            • 🧠 <b>Second Brain:</b> Auto-categorized recall<br />
            • 📤 <b>Smart Outbox:</b> Draft & send to any chat<br />
            • 💬 <b>Group Catch-up:</b> 3-tier summaries<br />
            • 📬 <b>Gmail Reader:</b> Direct IMAP triage<br />
            • 📅 <b>Google Calendar:</b> 1-tap event sync
          </div>
        </BotBubble>
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 2: Cognitive Second Brain (8.3 - 17.6s) ───────────────
const AppleSecondBrain: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 25], [0, 1]);
  const tiltY = interpolate(frame, [0, 280], [-6, 6]);

  const showStoreUser = frame >= 30;
  const showStoreBot = frame >= 75;
  const showQueryUser = frame >= 140;
  const showQueryBot = frame >= 195;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      <div style={{ width: "780px" }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#00F0FF",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          Cognitive Second Brain
        </div>
        <h1
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: "1.02",
            letterSpacing: "-2px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Never Forget A Detail.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #00F0FF 0%, #3B82F6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Ever Again.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0",
          }}
        >
          Store college roll numbers, WiFi codes, project roles, and medical
          notes. ARGUS auto-categorizes facts and synthesizes instant answers.
        </p>
      </div>

      <TitaniumPhone title="ARGUS AI" tiltY={tiltY} tiltX={-2}>
        {showStoreUser && (
          <UserBubble text="remember my SRN is PES1UG25CS001 and I'm in Section E" />
        )}
        {showStoreBot && (
          <BotBubble>
            <div style={{ color: "#00F0FF", fontWeight: 700 }}>
              🧠 Saved to Second Brain:
            </div>
            <div style={{ color: "#E2E8F0", marginTop: "4px" }}>
              "My SRN is PES1UG25CS001 and I'm in Section E"
            </div>
            <div style={{ marginTop: "6px", fontSize: "12px", display: "flex", gap: "6px" }}>
              <span style={{ background: "rgba(0,240,255,0.15)", color: "#00F0FF", padding: "2px 8px", borderRadius: "8px" }}>#academics</span>
              <span style={{ background: "rgba(37,211,102,0.15)", color: "#25D366", padding: "2px 8px", borderRadius: "8px" }}>#srn</span>
              <span style={{ background: "rgba(59,130,246,0.15)", color: "#3B82F6", padding: "2px 8px", borderRadius: "8px" }}>#section</span>
            </div>
          </BotBubble>
        )}
        {showQueryUser && (
          <UserBubble text="what is my SRN and section?" />
        )}
        {showQueryBot && (
          <BotBubble>
            <div style={{ color: "#25D366", fontWeight: 700 }}>
              🧠 Direct Synthesis:
            </div>
            <div>
              Your SRN is <b style={{ color: "#00F0FF" }}>PES1UG25CS001</b> and you are enrolled in <b style={{ color: "#00F0FF" }}>Section E</b>.
            </div>
          </BotBubble>
        )}
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 3: Outbound Drafter & Safety Controls (17.6 - 27s) ────
const AppleOutboxDrafter: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 25], [0, 1]);
  const tiltY = interpolate(frame, [0, 280], [6, -6]);

  const showUserCommand = frame >= 30;
  const showDraftCard = frame >= 85;
  const showConfirmSend = frame >= 170;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      <div style={{ width: "780px" }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#10B981",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          Smart Outbound Dispatch
        </div>
        <h1
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: "1.02",
            letterSpacing: "-2px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Delegate Messages.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #10B981 0%, #00F0FF 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            With Total Control.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0",
          }}
        >
          Command ARGUS to message any contact or group. It crafts the draft,
          generates an interactive preview, and dispatches only when you approve.
        </p>
      </div>

      <TitaniumPhone title="ARGUS AI" tiltY={tiltY} tiltX={2}>
        {showUserCommand && (
          <UserBubble text="can u send message to jack about moving meeting to 7" />
        )}
        {showDraftCard && (
          <BotBubble>
            <div style={{ color: "#00F0FF", fontWeight: 700 }}>
              📝 Outbound Draft for Jack:
            </div>
            <div
              style={{
                margin: "10px 0",
                padding: "12px 16px",
                background: "#111B21",
                borderRadius: "12px",
                borderLeft: "3px solid #00F0FF",
                fontStyle: "italic",
              }}
            >
              "Hey JAKC, could we move our meeting to 7:00 PM today? Let me know if that works for you."
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <span style={{ background: "#00A884", color: "#FFFFFF", padding: "8px 14px", borderRadius: "16px", fontWeight: 700, fontSize: "14px" }}>
                ✅ yes (send)
              </span>
              <span style={{ background: "rgba(255,255,255,0.1)", padding: "8px 14px", borderRadius: "16px", fontSize: "14px" }}>
                ✏️ edit
              </span>
              <span style={{ background: "rgba(255,255,255,0.1)", padding: "8px 14px", borderRadius: "16px", fontSize: "14px" }}>
                ❌ cancel
              </span>
            </div>
          </BotBubble>
        )}
        {showConfirmSend && (
          <>
            <UserBubble text="yes" />
            <BotBubble>
              <div style={{ color: "#25D366", fontWeight: 700 }}>
                ✅ Message sent to JACK!
              </div>
            </BotBubble>
          </>
        )}
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 4: 3-Tier WhatsApp Group Catch-Up (27 - 36.3s) ────────
const AppleGroupCatchup: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 25], [0, 1]);
  const tiltY = interpolate(frame, [0, 280], [-6, 6]);

  const showCatchupCmd = frame >= 30;
  const showSummary = frame >= 85;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      <div style={{ width: "780px" }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#38BDF8",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          High-Yield Triage
        </div>
        <h1
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: "1.02",
            letterSpacing: "-2px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Catch Up on 500+ Messages.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #38BDF8 0%, #818CF8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            In 5 Seconds.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0",
          }}
        >
          3-tier executive breakdowns extracting key decisions, shared slide
          links, and critical deadlines across your 80+ WhatsApp groups.
        </p>
      </div>

      <TitaniumPhone title="ARGUS AI" tiltY={tiltY} tiltX={-2}>
        {showCatchupCmd && <UserBubble text="catchup Section E" />}
        {showSummary && (
          <BotBubble>
            <div style={{ color: "#38BDF8", fontWeight: 700, fontSize: "17px" }}>
              💬 Catch-up Summary: Section E
            </div>
            <div style={{ marginTop: "10px", lineHeight: "1.5" }}>
              <div style={{ color: "#25D366", fontWeight: 700 }}>
                📌 Key Discussions:
              </div>
              <div>• Lab submission deadline finalized for Friday</div>
              <div>• Midterm syllabus confirmed for chapters 1-4</div>

              <div style={{ color: "#F59E0B", fontWeight: 700, marginTop: "8px" }}>
                ⚡ Action Items & Deadlines:
              </div>
              <div>• Submit assignment code repository by 11:59 PM</div>
            </div>
          </BotBubble>
        )}
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 5: Gmail IMAP & Google Calendar Sync (36.3 - 45.6s) ───
const AppleGmailAndCalendar: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 25], [0, 1]);
  const tiltY = interpolate(frame, [0, 280], [6, -6]);

  const showScheduleCmd = frame >= 30;
  const showCalCard = frame >= 85;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      <div style={{ width: "780px" }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#3B82F6",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          Seamless Ecosystem
        </div>
        <h1
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: "1.02",
            letterSpacing: "-2px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Gmail Triage.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #3B82F6 0%, #EC4899 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Google Calendar Sync.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0",
          }}
        >
          Read priority emails and schedule meetings with instant 1-tap Google
          Calendar links syncing to your phone, smartwatch, and laptop.
        </p>
      </div>

      <TitaniumPhone title="ARGUS AI" tiltY={tiltY} tiltX={2}>
        {showScheduleCmd && (
          <UserBubble text="schedule Hackathon Pitch tomorrow at 4pm" />
        )}
        {showCalCard && (
          <BotBubble>
            <div style={{ color: "#25D366", fontWeight: 700 }}>
              ✅ Added to Calendar:
            </div>
            <div style={{ fontSize: "17px", fontWeight: 700, margin: "6px 0" }}>
              📌 Hackathon Pitch Presentation
            </div>
            <div style={{ color: "#8696A0", fontSize: "15px" }}>
              📅 Tomorrow • 4:00 PM - 5:00 PM
            </div>
            <div
              style={{
                marginTop: "14px",
                background: "linear-gradient(135deg, #1A73E8 0%, #0052CC 100%)",
                padding: "12px 18px",
                borderRadius: "14px",
                color: "#FFFFFF",
                fontSize: "15px",
                fontWeight: 700,
                textAlign: "center",
                boxShadow: "0 6px 18px rgba(26,115,232,0.4)",
              }}
            >
              🔗 1-Tap Add to Google Calendar
            </div>
          </BotBubble>
        )}
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 6: Whisper Voice Notes & Daily Briefing (45.6 - 53.3s) ─
const AppleVoiceAndBriefing: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 25], [0, 1]);
  const tiltY = interpolate(frame, [0, 230], [-6, 6]);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 120px",
        opacity: introFade,
      }}
    >
      <div style={{ width: "780px" }}>
        <div
          style={{
            fontSize: "20px",
            letterSpacing: "6px",
            color: "#A855F7",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "16px",
          }}
        >
          Hands-Free Intelligence
        </div>
        <h1
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: "1.02",
            letterSpacing: "-2px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 60%, #64748B 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Voice Notes.
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #A855F7 0%, #00F0FF 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Instant Execution.
          </span>
        </h1>
        <p
          style={{
            fontSize: "28px",
            color: "#94A3B8",
            lineHeight: "1.4",
            margin: "0",
          }}
        >
          Speak on the go while driving or walking. Groq Whisper transcribes in
          milliseconds, and ARGUS delivers your 8:00 AM executive morning agenda.
        </p>
      </div>

      <TitaniumPhone title="ARGUS AI" tiltY={tiltY} tiltX={-2}>
        <UserBubble text="🎙️ Voice Note (0:08) — 'briefing'" />
        <BotBubble>
          <div style={{ color: "#25D366", fontWeight: 700, fontSize: "17px" }}>
            🌅 ARGUS DAILY EXECUTIVE BRIEFING
          </div>
          <div style={{ marginTop: "10px", lineHeight: "1.5" }}>
            <div>📅 <b>Today:</b> Hackathon Pitch @ 4:00 PM</div>
            <div>⏰ <b>Reminder:</b> Call JAKC @ 6:30 PM</div>
            <div>📝 <b>Pending:</b> Push slide deck to repo</div>
            <div>📧 <b>Inbox:</b> 3 unread priority emails</div>
          </div>
        </BotBubble>
      </TitaniumPhone>
    </AbsoluteFill>
  );
};

// ─── BEAT 7: Apple Cinematic Outro (53.3 - 60s) ─────────────────
const AppleCinematicOutro: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const introFade = interpolate(frame, [0, 30], [0, 1]);
  const scale = spring({ frame, fps, config: { damping: 10 } });

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "60px",
        opacity: introFade,
      }}
    >
      <div style={{ transform: `scale(${scale})` }}>
        <div
          style={{
            fontSize: "22px",
            letterSpacing: "8px",
            color: "#25D366",
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: "20px",
          }}
        >
          The Next Generation Assistant
        </div>
        <h1
          style={{
            fontSize: "104px",
            fontWeight: 900,
            letterSpacing: "-4px",
            margin: "0 0 24px 0",
            background:
              "linear-gradient(135deg, #FFFFFF 0%, #25D366 40%, #00F0FF 80%, #3B82F6 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Intelligence Redefined.
        </h1>
        <p
          style={{
            fontSize: "32px",
            color: "#94A3B8",
            maxWidth: "1150px",
            margin: "0 auto 48px auto",
            lineHeight: "1.4",
          }}
        >
          100% locally hosted. SQLite encrypted memory. Docker containerized.
          Powered by ultra-fast Groq Llama 3.3.
        </p>

        {/* Apple Glass Badges */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "20px",
            marginBottom: "56px",
          }}
        >
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "18px 32px", borderRadius: "22px", fontSize: "22px", fontWeight: 600 }}>
            🧠 Second Brain
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "18px 32px", borderRadius: "22px", fontSize: "22px", fontWeight: 600 }}>
            📤 Smart Outbox
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "18px 32px", borderRadius: "22px", fontSize: "22px", fontWeight: 600 }}>
            📬 Gmail IMAP
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "18px 32px", borderRadius: "22px", fontSize: "22px", fontWeight: 600 }}>
            📅 Google Calendar
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", padding: "18px 32px", borderRadius: "22px", fontSize: "22px", fontWeight: 600 }}>
            🐳 Docker Ready
          </div>
        </div>

        <div style={{ fontSize: "26px", color: "#64748B", letterSpacing: "1px", fontWeight: 500 }}>
          Designed & Engineered by <b style={{ color: "#FFFFFF" }}>Yusuf</b> • Open Source on GitHub
        </div>
      </div>
    </AbsoluteFill>
  );
};

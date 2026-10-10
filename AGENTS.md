# AGENTS.md — Master Context & Rules of Engagement

## Role

You are a senior engineer helping turn ARGUS, a personal AI assistant that lives in WhatsApp, into a secure, well-tested, open-source-quality project. You work in small, reviewable steps and you tell the truth about what you did and did not verify.

## What ARGUS is

- A self-hosted assistant for one owner. It reads the owner's WhatsApp chats, remembers facts ("second brain"), tracks expenses and reminders, reads email and documents, transcribes voice notes, and can draft or send messages and optionally auto-reply in the owner's style.
- **Bridge** (`bridge/`): Node.js + TypeScript, `@whiskeysockets/baileys` (an unofficial WhatsApp Web client), `better-sqlite3`, `node-cron`. Logs messages to `argus.db`, routes commands, forwards work to the brain over HTTP with an HMAC shared secret.
- **Brain** (`backend/`): Python + FastAPI. ReAct-style agent loop (`agent_core.py`), intent classifier, memory in `argus_memory.db`, stylometry for matching the owner's texting style, Groq for LLM and Whisper, IMAP email reader, a dashboard at `/dashboard`.
- Windows `.bat` scripts and a `docker-compose.yml` exist today. There are no tests and no CI.

## Known problems (the reason for this work)

1. A real-looking `ARGUS_SECRET` value is published in the public README and git history.
2. The README tells Linux/macOS users to run uvicorn on `0.0.0.0`.
3. There is no LICENSE file although the README claims MIT.
4. The README claims "Zero Cloud Storage / privacy-first" but chat content, voice and email are sent to Groq.
5. The README contains real-looking personal data (a phone number, a student ID).
6. Two processes (Node and Python) both write the same SQLite file. Expense logic exists in both.
7. Message content from other people reaches the agent and its tools (prompt injection risk). The "privacy firewall" for auto-reply is prompt-based.
8. Credentials can be stored in plaintext in the memory DB and are searchable by the LLM.
9. Production runs dev servers (`uvicorn --reload`, `npm run dev`).
10. No tests, CI, SECURITY.md or CONTRIBUTING.md. The project name is expanded two different ways.

## Rules of engagement (non-negotiable)

- Work on the branch named in the phase prompt. Never commit to `main`. Never force-push. Never rewrite git history yourself; produce the commands and stop for human confirmation (see Phase 0).
- **Never read, print, log or commit** `.env` files, `bridge/auth_info/`, `*.db` files or any real secret. Use placeholders. If you find a real secret, report its **location only**, never its value.
- Do not use real names, phone numbers or message content in code, tests, docs or fixtures. Use obviously fake data.
- Prefer small commits with conventional-commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`). Use `git mv` for moves so history is preserved.
- Do not change behavior in a phase that is about structure. If you spot a bug outside the phase scope, list it in the report instead of fixing it.
- Do not invent APIs. When using a third-party library or protocol (Baileys, AG-UI, CopilotKit, LiteLLM), read its current official docs or source first. If you cannot verify something, say so.
- Run the checks that exist (lint, type check, tests, build) before declaring a task done, and paste the actual results. If something cannot be run in your environment, say exactly that.
- If a requirement is ambiguous or a decision has security consequences, stop and ask rather than guessing.

## Output contract for every phase

At the end, produce a report with: (1) what changed, by file; (2) the commands you ran and their real results; (3) anything you could not verify; (4) risks and follow-ups; (5) a checklist of the phase's acceptance criteria marked done / not done. Do not claim a criterion is done unless you verified it.

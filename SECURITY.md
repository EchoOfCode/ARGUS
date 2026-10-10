# Security Policy

## Reporting Security Vulnerabilities

We take the security of ARGUS seriously. If you believe you have discovered a vulnerability, **please do not open a public issue**. Instead, report it privately:

1. **GitHub Security Advisory (Recommended):** Submit a confidential advisory via the GitHub "Security" tab -> "Report a vulnerability".
2. **Email:** Send details to `security@example.com` (GPG key available upon request).

Please include:
- A description of the vulnerability and its potential impact.
- Clear reproduction steps or proof-of-concept code.
- Any suggested remediations or mitigations.

We will acknowledge receipt within 48 hours and provide status updates as we investigate and develop a patch.

---

## Supported Versions

Only the latest release and the `main` branch receive active security updates.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

---

## Threat Model (Overview)

ARGUS is an executive personal AI assistant designed for a single owner, operating across WhatsApp, SQLite databases, and external cognitive APIs. When running ARGUS, consider the following threat vectors:

### 1. Ingress Boundaries & Prompt Injection
- **External Messages:** Messages received from group chats or non-owner contacts are untrusted. Malicious inputs can attempt to hijack agent reasoning or exfiltrate private context.
- **Untrusted Documents & Attachments:** PDFs or images parsed by visual/document analyzers must be treated as untrusted text.

### 2. Service Authentication (HMAC Shared Secret)
- The WhatsApp Bridge (`apps/bridge`) and Cognitive Brain (`apps/brain`) communicate over HTTP using HMAC-SHA256 request signatures with `ARGUS_SECRET`.
- `ARGUS_SECRET` must be a high-entropy string (minimum 32 characters, generated via `openssl rand -hex 32`). Never commit this secret or expose it over public network interfaces.

### 3. Network Isolation
- In production Docker Compose setups, the brain service does not publish ports to the host interface. It communicates exclusively within the private Docker bridge network (`argus-network`).
- Avoid binding FastAPI or development servers to `0.0.0.0` on untrusted networks without reverse-proxy authentication.

### 4. Data Privacy & Cloud Inference
- While message history, contacts, and embeddings reside in local SQLite databases, inference requests (LLM completions and audio transcriptions) are transmitted over TLS to configured inference providers (e.g., Groq, OpenAI).
- Sensitive credentials should never be stored in plain text memory entries.

---

## Security Incident Runbook

For rotated secrets or incident remediation procedures, consult [`docs/SECURITY_INCIDENT_RUNBOOK.md`](docs/SECURITY_INCIDENT_RUNBOOK.md).

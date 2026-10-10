# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Monorepo directory layout separating `apps/brain`, `apps/bridge`, `deploy/`, `scripts/`, and `docs/`.
- Strict startup configuration validation via `pydantic-settings` (Brain) and `zod` (Bridge), rejecting placeholder secrets.
- Pinned multi-stage Docker builds running as non-root with container healthchecks.
- Automated CI workflow in GitHub Actions (lint, typecheck, pytest, bridge tests, docker builds, and gitleaks scans).
- Characterization test suites covering HMAC authentication, `/health` endpoint, intent classification, and config validation.
- Developer experience tooling including `Makefile`, `justfile`, `.editorconfig`, and `.pre-commit-config.yaml`.
- Community documentation: `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and issue/PR templates.
- Architecture technical documentation moved to `docs/architecture.md`.

### Security
- Completely removed exposed secret placeholders and implemented automated verification against tracked `.env` and `.db` files.
- Replaced hardcoded personal data and identifiers with synthetic test fixtures across all docs and code.
- Bound FastAPI server strictly to `127.0.0.1` on local setups and internal network in Docker Compose (no exposed host port).
- Established Security Incident Runbook in `docs/SECURITY_INCIDENT_RUNBOOK.md`.

## [2.0.0] - 2026-03-01

### Added
- WhatsApp Web bridge integration powered by Baileys.
- ReAct cognitive agent loop with memory, email reading, web search, and expense tracking.
- Web Cockpit Dashboard for status and contact inspection.
- Audio note transcription powered by Groq Whisper.

# Contributing to ARGUS

Thank you for your interest in improving ARGUS! ARGUS is an open-source, self-hosted personal AI assistant operating across WhatsApp and modern LLM cognitive backends.

To maintain code quality, security, and developer ergonomics, all contributors must follow these guidelines.

---

## Repository Structure

ARGUS is structured as a lightweight monorepo:

```
ARGUS/
├── apps/
│   ├── brain/        # FastAPI Python cognitive engine, memory, ReAct agent loop
│   └── bridge/       # Node.js + TypeScript WhatsApp Web bridge (Baileys)
├── deploy/           # Docker Compose files (production and development overrides)
├── docs/             # Technical architecture guides and incident runbooks
├── scripts/          # Convenience shell and batch scripts for development
└── tests/            # Test suites and characterization fixtures
```

---

## Local Development Setup

### Prerequisites
- **Python**: 3.10 or higher
- **Node.js**: 20 LTS or higher (`npm` 10+)
- **Docker & Docker Compose**: (optional, for containerized workflows)
- **Make** or **Just**: (optional, for automation tasks)

### Quick Start
1. Clone the repository:
   ```bash
   git clone https://github.com/EchoOfCode/ARGUS.git
   cd ARGUS
   ```

2. Initialize environment variables from templates:
   ```bash
   cp apps/brain/.env.example apps/brain/.env
   cp apps/bridge/.env.example apps/bridge/.env
   ```
   Generate a secure 32-byte secret and set it in both `.env` files:
   ```bash
   openssl rand -hex 32
   ```

3. Install dependencies:
   ```bash
   # Brain (Python)
   cd apps/brain
   pip install -r requirements.txt

   # Bridge (Node)
   cd ../bridge
   npm install
   ```

---

## Testing & Quality Checks

Run the verification suites before submitting pull requests:

### Python Brain
```bash
cd apps/brain
ruff check .           # Linting
pytest tests/ -v       # Characterization and unit tests
```

### Node Bridge
```bash
cd apps/bridge
npm run typecheck      # TypeScript compilation check
npm test               # Config validation and unit tests
```

---

## Coding & Security Standards

1. **Zero Secret Leaks**:
   - Never commit `.env` files, `*.db` SQLite databases, or WhatsApp credentials (`auth_info/`).
   - Pre-commit hooks and CI runs scan every commit with Gitleaks.
2. **Synthetic Data Only**:
   - Never use real personal phone numbers, student IDs, personal names, or real chat snippets in documentation, tests, or test fixtures.
   - Use standardized test data: `Alex`, `919876543210@s.whatsapp.net`, etc.
3. **Commit Messages**:
   - Use [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` new capabilities or tools
     - `fix:` bug fixes
     - `chore:` dependency updates, refactors, configuration
     - `docs:` documentation improvements
     - `test:` test coverage and fixtures
     - `ci:` workflow or pipeline changes

---

## Pull Request Guidelines

1. Work on a feature branch (e.g., `feat/add-ollama-support` or `fix/reminder-parser`).
2. Ensure all linting, typechecking, and tests pass locally.
3. Keep pull requests focused on a single change or cohesive feature.
4. Fill out the PR template completely with test verification results.

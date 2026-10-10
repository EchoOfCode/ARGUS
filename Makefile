# ===================================================================
# ARGUS — Root Makefile (Developer Experience & CI Automation)
# ===================================================================

.PHONY: help setup dev test lint build up down clean

help:
	@echo "Available commands:"
	@echo "  make setup   - Install dependencies for both brain and bridge"
	@echo "  make dev     - Run local development servers"
	@echo "  make test    - Run test suites for brain and bridge"
	@echo "  make lint    - Run linter and type-checking"
	@echo "  make build   - Build TypeScript bridge and Docker images"
	@echo "  make up      - Launch containerized services with Docker Compose"
	@echo "  make down    - Stop containerized services"
	@echo "  make clean   - Remove cache and temporary artifacts"

setup:
	@echo "==> Setting up Python Brain..."
	cd apps/brain && pip install -r requirements.txt
	@echo "==> Setting up TypeScript Bridge..."
	cd apps/bridge && npm install

dev:
	@echo "==> Starting local development services..."
	@echo "Please run 'scripts/start.bat' on Windows or use separate terminals:"
	@echo "  Terminal 1: cd apps/brain && uvicorn main:app --host 127.0.0.1 --port 8000 --reload"
	@echo "  Terminal 2: cd apps/bridge && npm run dev"

test:
	@echo "==> Running Brain tests..."
	cd apps/brain && python -m pytest tests/ -v
	@echo "==> Running Bridge tests..."
	cd apps/bridge && npm test

lint:
	@echo "==> Linting Python Brain..."
	-cd apps/brain && python -m ruff check .
	@echo "==> Type-checking Bridge..."
	cd apps/bridge && npx tsc --noEmit

build:
	@echo "==> Building TypeScript Bridge..."
	cd apps/bridge && npm run build
	@echo "==> Building Docker Images..."
	docker compose build

up:
	@echo "==> Starting ARGUS containers..."
	docker compose up -d
	@echo "Brain running on http://127.0.0.1:8000"
	@echo "To view WhatsApp QR code: docker attach argus-bridge"

down:
	@echo "==> Stopping ARGUS containers..."
	docker compose down

clean:
	@echo "==> Cleaning cache directories..."
	-find . -type d -name "__pycache__" -exec rm -rf {} +
	-find . -type d -name ".pytest_cache" -exec rm -rf {} +
	-find . -type d -name ".ruff_cache" -exec rm -rf {} +

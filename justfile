# ARGUS — Justfile

default:
    @just --list

# Install all dependencies for both services
setup:
    @echo "Setting up Brain..."
    cd apps/brain && pip install -r requirements.txt
    @echo "Setting up Bridge..."
    cd apps/bridge && npm install

# Run tests
test:
    cd apps/brain && python -m pytest tests/ -v
    cd apps/bridge && npm test

# Lint and check types
lint:
    cd apps/brain && python -m ruff check .
    cd apps/bridge && npx tsc --noEmit

# Build production artifacts
build:
    cd apps/bridge && npm run build
    docker compose build

# Start Docker containers
up:
    docker compose up -d

# Stop Docker containers
down:
    docker compose down

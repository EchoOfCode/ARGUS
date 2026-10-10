# ARGUS AI Brain — Multi-stage Non-Root Dockerfile
# Stage 1: Build virtual environment & wheels
FROM python:3.11.9-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Minimal runtime image
FROM python:3.11.9-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create dedicated non-root user
RUN groupadd -r argus && useradd -r -g argus -d /app -s /sbin/nologin argus

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

COPY . /app

RUN mkdir -p /app/data && chown -R argus:argus /app

USER argus

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/health || exit 1

# Production server without --reload
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

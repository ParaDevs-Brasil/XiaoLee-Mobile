# XiaoLee Backend — Dockerfile de Produção
#
# Multi-stage build para imagem mínima.
# Stage 1 (builder): instala dependências com pip
# Stage 2 (runtime): copia apenas o necessário, sem ferramentas de build
#
# Build:
#   docker build -f backend/Dockerfile -t xiaolee-backend:latest .
#
# Run local:
#   docker run -p 8000:8000 --env-file .env xiaolee-backend:latest

# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Instala dependências de build (compilação de extensões C para asyncpg/solders)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements primeiro (cache layer eficiente)
COPY backend/requirements.docker.txt /app/requirements.txt

# Instala em prefix isolado
RUN pip install --no-cache-dir --prefix=/install -r /app/requirements.txt

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Runtime libs + Node.js 20 LTS (necessário para agent-twitter-client via x_poller)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    ca-certificates \
    ffmpeg \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copia pacotes instalados do builder
COPY --from=builder /install /usr/local

# Copia código do backend
COPY backend /app

# Instala dependências Node.js para agent-twitter-client (x_poller)
WORKDIR /app/database/data
RUN npm ci --omit=dev
WORKDIR /app

# Usuário não-root para segurança
RUN groupadd --gid 1001 xiaolee && \
    useradd --uid 1001 --gid 1001 --no-create-home xiaolee && \
    chown -R xiaolee:xiaolee /app

USER xiaolee

# Variáveis de ambiente padrão (sobrescritas pelo docker-compose / vault)
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV XIAOLEE_ENV=production

EXPOSE 8000

# Health check nativo do container
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Produção: múltiplos workers uvicorn para aproveitamento de CPU
# Workers: 2 * CPU_COUNT + 1 (padrão gunicorn)
CMD ["uvicorn", "server.app:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--loop", "uvloop", \
     "--http", "h11", \
     "--access-log"]

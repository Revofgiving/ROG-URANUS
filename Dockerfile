# ============================================================
# URANUS Frontend — Dockerfile (root, per Coolify)
# ============================================================
# Build dal contesto radice del repo — il frontend è in /frontend
# ============================================================

# Stage 1 — Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Installa dipendenze
COPY frontend/package*.json ./
RUN npm ci

# Copia il codice sorgente del frontend
COPY frontend/ .

# Build Next.js (output standalone)
RUN npm run build

# Stage 2 — Runtime leggero (~100MB)
FROM node:20-alpine

WORKDIR /app

# wget per healthcheck Coolify
RUN apk add --no-cache wget

LABEL maintainer="URANUS"
LABEL description="Frontend URANUS — Next.js 16"

# Copia solo l'output standalone
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Next.js 16: bind su tutte le interfacce (richiesto in Docker)
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]

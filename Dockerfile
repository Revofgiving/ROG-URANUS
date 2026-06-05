# ============================================================
# URANUS Frontend — Dockerfile (root, per Coolify)
# ============================================================
# Build dal contesto radice del repo — il frontend è in /frontend
# ============================================================

# Stage 1 — Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Installa dipendenze
COPY frontend/package*.json ./
RUN npm ci

# Copia il codice sorgente del frontend
COPY frontend/ .

# Build Next.js (output standalone)
RUN npm run build

# Stage 2 — Runtime leggero (~100MB)
FROM node:18-alpine

WORKDIR /app

LABEL maintainer="URANUS"
LABEL description="Frontend URANUS — Next.js 16"

# Copia solo l'output standalone
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]

# ============================================================
# URANUS Frontend — Dockerfile per Coolify
# ============================================================
# Multi-stage build: dependencies → build → runtime
# Deploy su Coolify:
#   1. Collega il repository Git a Coolify
#   2. Coolify rileva il Dockerfile automaticamente
#   3. Imposta le variabili d'ambiente nel pannello Coolify
#   4. Coolify builda e deploya automaticamente ad ogni push
# ============================================================

# Stage 1 — Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Installa dipendenze
COPY package*.json ./
RUN npm ci

# Copia il codice sorgente
COPY . .

# Build Next.js
RUN npm run build

# Stage 2 — Runtime (immagine leggera ~100MB)
FROM node:20-alpine

WORKDIR /app

# Metadata
LABEL maintainer="URANUS"
LABEL description="Frontend URANUS — Next.js 16 con auth MetaMask + dashboard dinamico"

# Copia SOLO l'output standalone (no node_modules completi)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Porta esposta
EXPOSE 3000

# Health check per Coolify
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Avvio — Next.js standalone server
CMD ["node", "server.js"]

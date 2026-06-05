# ============================================================
# URANO v2 Backend — Dockerfile per Coolify
# ============================================================
# Deploy su Coolify:
#   1. Collega il repository Git a Coolify
#   2. Coolify rileva il Dockerfile automaticamente
#   3. Imposta le variabili d'ambiente nel pannello Coolify
#   4. Coolify builda e deploya automaticamente ad ogni push
# ============================================================

FROM node:18-alpine

# Metadata
LABEL maintainer="URANO"
LABEL description="Backend URANO v2 — 20 USDC → 2 posizioni (HUMAN + CASSA_ROG) → 1.000 netti"

# Directory di lavoro
WORKDIR /app

# Installa dipendenze (prima del codice per sfruttare la cache Docker)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copia il codice sorgente (escludi .dockerignore)
COPY . .

# Porta esposta (deve corrispondere a PORT nel .env di Coolify)
EXPOSE 4000

# Health check per Coolify
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||4000) + '/api/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Avvio
CMD ["node", "api-server.js"]

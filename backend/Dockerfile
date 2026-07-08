# ROG Backend - Dockerfile per Coolify
FROM node:18-alpine

# Dipendenze native per sqlite3 e build tools
RUN apk add --no-cache python3 make g++ sqlite curl

WORKDIR /app

# Copia package files e installa dipendenze
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copia tutto il codice
COPY . .

# Porta API
EXPOSE 3000

# Avvia backend
CMD ["node", "server-and-listener.js"]

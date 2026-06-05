# ROG-URANUS (SUPERURANO)

Sistema a doppio motore su Polygon: URANO 2 (tavole a cascata 6 livelli) + Nettuno (coda FIFO con rientri perpetui).

## Struttura

```
├── backend/          # Node.js + Express (porta 4000)
├── frontend/         # Next.js 16 (porta 3000)
├── docker-compose.yml
└── .gitignore
```

## Deploy (Coolify)

1. Collega questo repo a Coolify come **Docker Compose**
2. Configura le variabili d'ambiente nel pannello Coolify
3. Deploy — Coolify builda e avvia i 3 servizi (postgres, backend, frontend)

## Variabili d'ambiente obbligatorie

- `POSTGRES_PASSWORD` — password DB produzione
- `POLYGON_RPC_URL` — endpoint RPC Polygon (Alchemy/Infura)
- `ADMIN_API_KEY` — chiave admin backend
- `ADMIN_PASSWORD` — password pannello admin frontend
- `CORS_ORIGIN` — dominio produzione (es. `https://uranus.example.com`)
- `NEXT_PUBLIC_API_URL` — URL backend (es. `https://api.uranus.example.com`)
- `URANO_FUND_WALLET` — wallet Fondo A
- `CASSA_ROG_WALLET` — wallet CASSA sistema

## Prima inizializzazione

Dopo il deploy, con DB fresco:
```bash
curl -X POST https://API_URL/api/inizializza -H "x-admin-key: YOUR_ADMIN_KEY"
```

## Smart Contract

`UranusRegistry` — `0xCD934a62755B909fa65404cb37516eb4b1262eD3` su Polygon Mainnet

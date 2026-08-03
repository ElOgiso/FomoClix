# DigitalOcean Deployment

This deploys the bot backend only. The frontend can be updated later to point at this backend.

## Recommended Target

Use a single DigitalOcean Droplet with Docker Compose. Do not run multiple replicas of this bot yet: `index.js` keeps active trading state in memory and multiple instances could double-process chain events.

Suggested Droplet:

- Ubuntu 24.04 LTS
- 1-2 vCPU, 2 GB RAM minimum
- Docker + Docker Compose plugin
- Firewall: open `22`, `80`, `443`

## First Deploy

1. Point a domain or subdomain at the Droplet IP.

   Example:

   ```text
   bot.example.com -> DROPLET_IP
   ```

2. Copy this repo to the Droplet.

3. Create the production env file:

   ```bash
   cp .env.production.example .env.production
   nano .env.production
   ```

4. Fill in:

   - `BOT_DOMAIN`
   - `PRIVATE_KEY`
   - `ALCHEMY_RPC_URL`
   - `NEYNAR_API_KEY`
   - `NEYNAR_WEBHOOK_SECRET`
   - `JWT_SECRET`
   - `ADMIN_WALLETS`
   - `CORS_ALLOWED_ORIGIN`
   - trading config values

5. Start the service:

   ```bash
   docker compose --env-file .env.production up -d --build
   ```

6. Check status:

   ```bash
   docker compose --env-file .env.production ps
   docker compose --env-file .env.production logs -f zora-bot
   curl https://YOUR_BOT_DOMAIN/
   curl https://YOUR_BOT_DOMAIN/status
   ```

## Webhook URL

Set Neynar webhook URL to:

```text
https://YOUR_BOT_DOMAIN/webhook/neynar
```

## Persistent Data

SQLite is stored in the Docker named volume `zora_bot_data` at `/data/bot.db` inside the container. This survives container rebuilds and restarts.

Back up the database:

```bash
docker compose --env-file .env.production exec zora-bot sh -lc 'cp /data/bot.db /data/bot.db.backup'
docker cp zora-bot-service:/data/bot.db.backup ./bot.db.backup
```

## Operations

Restart:

```bash
docker compose --env-file .env.production restart zora-bot
```

Update after pulling new code:

```bash
docker compose --env-file .env.production up -d --build
```

View logs:

```bash
docker compose --env-file .env.production logs -f zora-bot
```

Stop:

```bash
docker compose --env-file .env.production down
```

## Notes

- Caddy automatically provisions HTTPS certificates for `BOT_DOMAIN`.
- The backend listens internally on port `8080`; only Caddy exposes public ports.
- Keep `.env.production` private. Never commit it or send it around with the wallet key inside.
- For now, SQLite is the fastest reliable deployment path. Move to Postgres later if you want multiple services, stronger query tooling, or analytics.

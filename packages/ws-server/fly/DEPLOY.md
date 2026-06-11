# Deploying the ws-server to Fly.io

## Prerequisites

```bash
# Install flyctl
brew install flyctl   # macOS
# or: curl -L https://fly.io/install.sh | sh

# Authenticate
fly auth login
```

## First deploy

```bash
cd packages/ws-server

# Create the app (only needed once)
fly apps create crdt-collab-ws --config fly/fly.toml

# Set secrets (never commit these)
fly secrets set \
  DATABASE_URL="postgresql://..." \
  SUPABASE_JWT_SECRET="..." \
  ALLOWED_ORIGINS="https://crdt-collab.vercel.app" \
  FRONTEND_URL="https://crdt-collab.vercel.app" \
  --config fly/fly.toml

# Deploy
fly deploy --config fly/fly.toml
```

## Subsequent deploys

```bash
fly deploy --config fly/fly.toml
```

## Verify

```bash
# Health check
curl https://crdt-collab-ws.fly.dev/healthz

# Tail logs
fly logs --config fly/fly.toml
```

## WebSocket sticky sessions

Fly.io uses anycast routing — without sticky sessions, a WebSocket client that
reconnects could land on a different machine, which would have a different
in-memory Yjs doc (or no doc at all if it hasn't been loaded from Postgres yet).

The `fly.toml` configures session affinity via the `[services.concurrency]`
block. Fly sets a `fly-sticky-session` cookie on the initial HTTP upgrade
request, pinning subsequent reconnects to the same machine.

For horizontal scaling beyond one machine, replace the in-memory room registry
with `y-redis` to fan out updates via Redis pub/sub.

## Scaling up

```bash
# Add a second instance (requires y-redis for cross-instance fan-out)
fly scale count 2 --config fly/fly.toml

# Check status
fly status --config fly/fly.toml
```

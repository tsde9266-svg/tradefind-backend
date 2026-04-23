# TradeFind Backend

Two Docker services, one Compose file. Give this folder to anyone with Docker — it just works.

---

## What's inside

| Container | Tech | Port | Does what |
|---|---|---|---|
| `tf-api` | Node.js 20 + Fastify + Prisma | **3000** | All REST endpoints, auth, PostgreSQL |
| `tf-location` | Go 1.22 + Gorilla WebSocket | **4000** | Live worker tracking, Redis geo search |
| `tf-postgres` | PostgreSQL 16 + PostGIS | 5432 | Main database |
| `tf-redis` | Redis 7 | 6379 | Worker geo index + session store |

---

## For your friend — step by step (Linux + Docker)

### Step 1 — Install Docker (skip if already done)

```bash
# Ubuntu / Debian
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin

# Add yourself to the docker group so you don't need sudo every time
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### Step 2 — Get the code onto the server

```bash
# If you're cloning from GitHub:
git clone https://github.com/YOUR_USERNAME/tradefind-backend.git
cd tradefind-backend

# Or if you're copying files manually (scp from your Windows machine):
# scp -r D:\tradefind-backend user@SERVER_IP:/home/user/tradefind-backend
# then: cd /home/user/tradefind-backend
```

### Step 3 — Create the environment file

```bash
cp .env.example .env
nano .env
```

Fill in every value. See the **Environment variables** section below for where to get each one. Save with `Ctrl+O`, exit with `Ctrl+X`.

### Step 4 — Fetch Go dependencies (one-time, takes ~30 seconds)

```bash
# You need Go installed just for this step
# Ubuntu:
sudo apt-get install -y golang-go

cd location
go mod tidy
cd ..
```

> If you don't want to install Go locally, skip this step — Docker will fetch dependencies
> during the build. `go mod tidy` just pre-generates `go.sum` so the build is faster.

### Step 5 — Build and start everything

```bash
docker compose up -d --build
```

This will:
- Pull Postgres 16 + PostGIS, Redis 7, Node 20, Go 1.22 images
- Build the API and location service
- Start all 4 containers in the background

First run takes 3–5 minutes. Subsequent starts take ~10 seconds.

### Step 6 — Run database migrations (first time only)

```bash
docker compose exec api npx prisma migrate deploy
```

This creates all tables in PostgreSQL. Only needed once (and after schema changes).

### Step 7 — Check everything is running

```bash
# See container status
docker compose ps

# Should show all 4 as "healthy" or "running"

# Check API is up
curl http://localhost:3000/health
# → {"status":"ok","ts":...}

# Check location service is up
curl http://localhost:4000/health
# → {"status":"ok"}

# Tail logs (Ctrl+C to stop)
docker compose logs -f
```

---

## That's it. The backend is running.

Point the mobile app's `apiUrl` to `http://SERVER_IP:3000` and `socketUrl` to `ws://SERVER_IP:4000`.

---

## Day-to-day commands

```bash
# Stop everything
docker compose down

# Stop + wipe database (careful — deletes all data)
docker compose down -v

# Restart one service
docker compose restart api
docker compose restart location

# Pull latest code and rebuild
git pull
docker compose up -d --build

# Run migrations after a code update
docker compose exec api npx prisma migrate deploy

# View logs for one service
docker compose logs -f api
docker compose logs -f location

# Open a Postgres shell
docker compose exec postgres psql -U tradefind -d tradefind

# Open a Redis shell
docker compose exec redis redis-cli
```

---

## Environment variables

All secrets go in `.env`. Never commit this file (it's in `.gitignore`).

| Variable | Where to get it |
|---|---|
| `POSTGRES_PASSWORD` | Make up a strong password — anything works |
| `JWT_SECRET` | Run: `openssl rand -base64 64` — copy the output |
| `R2_ACCOUNT_ID` | Cloudflare Dashboard → right sidebar shows Account ID |
| `R2_ACCESS_KEY` | Cloudflare → R2 → Manage API tokens → Create token |
| `R2_SECRET_KEY` | Same token creation screen as above |
| `R2_BUCKET` | Create a bucket in Cloudflare R2, use its name |
| `R2_PUBLIC_URL` | Enable public access on the bucket → copy the public URL |
| `RESEND_API_KEY` | Sign up at resend.com → API Keys → Create key |

**Minimum to get started (skip optional services):**

If you don't have Cloudflare R2 yet, the API still works — photo uploads will just return an error. You can set `R2_*` to dummy values temporarily:

```env
POSTGRES_PASSWORD=supersecret123
JWT_SECRET=paste_openssl_output_here
R2_ACCOUNT_ID=placeholder
R2_ACCESS_KEY=placeholder
R2_SECRET_KEY=placeholder
R2_BUCKET=tradefind-uploads
R2_PUBLIC_URL=https://placeholder.r2.dev
RESEND_API_KEY=re_placeholder
```

---

## Add a domain + HTTPS (optional but recommended for production)

Install [Caddy](https://caddyserver.com/) — it handles TLS automatically:

```bash
sudo apt-get install -y caddy

sudo nano /etc/caddy/Caddyfile
```

Paste this (replace with your real domain):

```
api.yourdomain.com {
    reverse_proxy localhost:3000
}

ws.yourdomain.com {
    reverse_proxy localhost:4000
}
```

```bash
sudo systemctl reload caddy
```

Caddy fetches a free Let's Encrypt certificate automatically. Then update `app.json` in the mobile app:
```json
"apiUrl":    "https://api.yourdomain.com",
"socketUrl": "wss://ws.yourdomain.com"
```

---

## Memory usage (fits on a £14/month Hetzner CX21: 2 vCPU, 4 GB RAM)

| Container | Memory limit |
|---|---|
| PostgreSQL | 1 024 MB |
| Redis | 300 MB |
| Node.js API | 512 MB |
| Go location | 128 MB |
| OS + headroom | ~900 MB |
| **Total** | **~2.9 GB** |

---

## API reference

Swagger UI: `http://SERVER_IP:3000/docs`

### Auth endpoints
```
POST   /api/auth/register        { name, email, phone, password, role }
POST   /api/auth/login           { email, password }
POST   /api/auth/refresh         { refreshToken }
POST   /api/auth/logout          { refreshToken }
GET    /api/auth/me
PATCH  /api/auth/push-token      { token }
```

### Worker endpoints
```
GET    /api/workers/nearby       ?lat&lng&radiusKm&trade&availableOnly&sortBy
GET    /api/workers/saved
GET    /api/workers/stats/today
GET    /api/workers/:id
PATCH  /api/workers/profile
PATCH  /api/workers/availability  { available, lat?, lng? }
POST   /api/workers/:id/save
DELETE /api/workers/:id/save
```

### Reviews
```
GET    /api/reviews/worker/:id
GET    /api/reviews/customer/:id
POST   /api/reviews              { toId, rating, text, photos[] }
POST   /api/reviews/:id/reply    { reply }
POST   /api/reviews/:id/report   { reason }
```

### Notifications
```
GET    /api/notifications
PATCH  /api/notifications/read-all
PATCH  /api/notifications/:id/read
```

### Upload
```
POST   /api/upload/presign       { filename, contentType, folder }
```

### Admin (requires admin JWT)
```
GET    /api/admin/stats
GET    /api/admin/workers        ?status&search&page
PATCH  /api/admin/workers/:id    { status: 'approved'|'blocked' }
GET    /api/admin/reviews/flagged
PATCH  /api/admin/reviews/:id    { action: 'approve'|'remove' }
GET    /api/admin/customers      ?search&page
```

---

## WebSocket protocol (port 4000)

Connect: `ws://SERVER_IP:4000/ws?token=JWT&workerId=PROFILE_ID`

Workers must pass `workerId` = their `WorkerProfile.id` (returned in `/api/auth/me → data.worker.id`).

| Who sends | Message type | Fields |
|---|---|---|
| Worker → Server | `location:update` | `lat`, `lng` |
| Worker → Server | `worker:offline` | — |
| Customer → Server | `track:start` | `workerId` |
| Customer → Server | `track:stop` | `workerId` |
| Server → Customer | `worker:moved` | `lat`, `lng` |
| Server → Customer | `worker:offline` | — |
| Server → Anyone | `connected` | — |

---

## Troubleshooting

**Containers won't start**
```bash
docker compose logs postgres   # check DB errors
docker compose logs api        # check API errors
```

**`prisma migrate deploy` fails**
```bash
# Make sure postgres is healthy first
docker compose ps
# Wait for "healthy" then retry
```

**Port already in use**
```bash
sudo lsof -i :3000    # find what's using port 3000
sudo lsof -i :4000
```

**Out of disk space**
```bash
docker system prune   # removes stopped containers and unused images
```

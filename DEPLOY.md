# Deploying Saheli to Render

**Short answer: yes.** The stack is a Node/Express API plus a static Vite bundle, both of which Render hosts on its free tier. This guide is the exact sequence, with the traps called out.

**Time:** ~25 minutes, most of it waiting for builds.

---

## Which shape to deploy

| | **A · Single service** ⭐ recommended | B · Two services |
|---|---|---|
| What runs | One Node service serving API **and** the React bundle | Web Service (API) + Static Site (frontend) |
| URLs | One | Two |
| CORS | None needed — same origin | Must be configured, and it *will* bite you |
| Free-tier cold start | One (~50 s) | One (the API still sleeps) |
| Setup | Blueprint, one click | Two services, wired by hand |

Go with **A** unless you specifically need the frontend on a CDN. The API already serves `app/dist` and falls back to `index.html` for client routes — I verified this end-to-end against the compiled build: `/` → 200 HTML, `/assets/*.js` → 200, `/health` → 200, `/api/*` → 200, `/some/deep/route` → 200.

---

## Before you start

1. **A MongoDB Atlas M0 cluster** (free, 512 MB) — <https://cloud.mongodb.com>
   - Create a database user (username + password)
   - **Network Access → Add IP Address → `0.0.0.0/0`.** Render's outbound IPs are not fixed on the free tier; without this the API cannot reach Atlas.
   - Copy the connection string: `mongodb+srv://user:pass@cluster.mongodb.net/saheli?retryWrites=true&w=majority`
   - Put `/saheli` before the `?` so it uses a named database.

2. **Push your code to GitHub** (Render deploys from a repo):

```bash
git add -A
git commit -m "Deploy-ready: AI agent, Excel reports, wallet settlement, single-leader approvals"
git push
```

3. **A funded TestNet relayer** (optional now, required for live chain settlement — see step 6).

---

## Option A — Single service (recommended)

### Step 1 · Create the Blueprint

The repo already contains [`render.yaml`](render.yaml).

1. <https://dashboard.render.com> → **New +** → **Blueprint**
2. Connect your GitHub account, pick the repo
3. Render reads `render.yaml` and shows one service named **saheli**
4. It will prompt for the variables marked `sync: false`. Fill in:

| Variable | Value |
|---|---|
| `MONGODB_URI` | Your Atlas connection string |
| `PUBLIC_BASE_URL` | Leave blank for now — you get the URL after deploy |
| `ALGORAND_RELAYER_MNEMONIC` | Blank is fine (see step 6) |
| `OPENAI_API_KEY` | Your key, or blank |
| `X402_FACILITATOR_URL` | **Leave blank** — uses the built-in local facilitator |
| `TWILIO_*` | Blank unless you're demoing live WhatsApp |

`JWT_SECRET` is generated automatically.

5. **Apply** / **Create**

### Step 2 · Watch the build

Roughly 5–8 minutes. The build command is:

```
npm --prefix app install --include=dev && npm --prefix app run build &&
npm --prefix backend install --include=dev && npm --prefix backend run build
```

> **The `--include=dev` is not optional.** `NODE_ENV=production` makes npm skip devDependencies, and TypeScript is a devDependency in both packages. Without the flag the build dies with `tsc: not found`. This is the single most common way this deploy fails.

Success looks like `==> Build successful 🎉` then `Your service is live 🎉`.

### Step 3 · Set `PUBLIC_BASE_URL`

You now have a URL like `https://saheli.onrender.com`.

**Environment** → edit `PUBLIC_BASE_URL` → paste the full URL **with `https://` and no trailing slash** → **Save**. The service redeploys.

This is what makes QR proof codes carry scannable absolute links.

### Step 4 · Confirm it's alive

Open `https://<your-service>.onrender.com/health`. You want:

```json
{ "status": "ok",
  "database": { "connected": true, "mode": "external" },
  "algorand": { "network": "testnet", "settlementMode": "..." },
  "x402": { "enabled": true } }
```

- `"database": { "connected": true, "mode": "external" }` ← Atlas is wired correctly.
  If you see `"mode": "in-process (ephemeral)"` or `"status": "degraded"`, your `MONGODB_URI` is wrong or Atlas is blocking the IP.

### Step 5 · Seed the demo data

```bash
curl -X POST https://<your-service>.onrender.com/api/auth/seed-demo -H "Content-Type: application/json" -d "{\"reset\":true}"
```

Because Atlas persists, **you only do this once** — unlike local dev, where a restart wipes the in-process database.

### Step 6 · Fund the relayer (do this, or nothing resolves on Lora)

```bash
curl -s https://<your-service>.onrender.com/api/algorand/info
```

Copy `relayer.address`, dispense to it **twice** at <https://bank.testnet.algorand.network>, then:

```bash
curl -s https://<your-service>.onrender.com/api/algorand/health
```

You want `"mode": "live"`.

> The derived relayer address depends on `ALGORAND_MASTER_SEED`. Since that is unset, it is the same address as your local machine — so if you already funded it locally, **you are already done**.

### Step 7 · Prove the deployment works

```bash
cd backend && npm run verify -- --url https://<your-service>.onrender.com
```

Expect `ALL 46 CHECKS PASSED` against the live deployment. This is the strongest thing you can show a judge.

---

## Option B — Two services

Only if you want the frontend on Render's CDN.

### B1 · Backend (Web Service)

**New +** → **Web Service** → your repo.

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Plan | Free |

Env vars: same as Option A, **plus** `CORS_ORIGINS` (you'll set it in B3).

### B2 · Frontend (Static Site)

**New +** → **Static Site** → same repo.

| Setting | Value |
|---|---|
| Root Directory | `app` |
| Build Command | `npm install --include=dev && npm run build` |
| Publish Directory | `dist` |

Environment variables — **these are baked in at build time, not read at runtime:**

```
VITE_API_BASE_URL = https://<your-backend>.onrender.com/api
VITE_ALGORAND_NETWORK = testnet
```

Add a rewrite so client routes don't 404:
**Redirects/Rewrites** → Source `/*` → Destination `/index.html` → Action **Rewrite**.

### B3 · Wire them together

On the **backend** service, set:

```
CORS_ORIGINS = https://<your-frontend>.onrender.com
```

No trailing slash. Save and let it redeploy.

> Changing `VITE_API_BASE_URL` later requires a **rebuild** of the static site — Vite inlines it into the bundle. Setting it at runtime does nothing.

---

## The traps, ranked by how likely they are to hit you

1. **`tsc: not found` during build** — you dropped `--include=dev`. Put it back.
2. **Every `/api` call returns 503** — `MONGODB_URI` is wrong, or Atlas Network Access doesn't allow `0.0.0.0/0`. Check `/health` → `database.connected`.
3. **Data vanishes after a while** — you left `MONGODB_URI` unset and it fell back to an ephemeral database. Set `USE_MEMORY_DB=false` so this fails loudly instead of silently.
4. **First request takes ~50 seconds** — free instances sleep after ~15 minutes idle. **Hit `/health` 2 minutes before you present.** Or keep a browser tab polling it.
5. **No transaction resolves on Lora** — relayer unfunded. Step 6.
6. **CORS errors (Option B only)** — `CORS_ORIGINS` missing or has a trailing slash.
7. **Frontend calls `localhost` (Option B only)** — `VITE_API_BASE_URL` wasn't set at build time; rebuild.

---

## Free tier: what you actually get

| | Free tier |
|---|---|
| Web service | 512 MB RAM, sleeps after 15 min idle, ~50 s cold start |
| Static site | Unlimited bandwidth, no sleep |
| Build minutes | 500/month — plenty |
| Atlas M0 | 512 MB, no sleep |
| HTTPS | Included, automatic |
| **Cost** | **₹0** |

The cold start is the only thing that can embarrass you on stage. Warm it before you present.

---

## Demo-day checklist for the deployed build

- [ ] `/health` → `status: ok`, `database.mode: external`
- [ ] `/api/algorand/health` → `mode: live`
- [ ] Seeded once (`/api/auth/seed-demo`)
- [ ] `npm run verify -- --url https://…` → 46/46
- [ ] **Warmed up within the last 10 minutes**
- [ ] All three logins work (member / leader / bank, `demo1234`)
- [ ] A green `on-chain` transaction opens on Lora

---

## Alternatives, honestly

| Host | Verdict |
|---|---|
| **Render** | Best fit. Free HTTPS, blueprint support, health checks. Cold starts are the only downside. |
| **Railway** | $5/month credit, **no cold starts** — better live demo, but the credit runs out. |
| **Fly.io** | No cold starts on the free allowance; more setup. |
| **Vercel/Netlify** | Frontend only. The backend is a long-running process with background timers, which serverless functions handle badly. |

For a hackathon: **Render + Atlas M0, single service.** Zero cost, one URL, and everything in this repo already supports it.

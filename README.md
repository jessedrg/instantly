# Instantly CSV Filter

Web app to filter leads against Instantly CRM and enrich with personal emails via LeadMagic.

## What it does

1. Upload CSVs via the web UI
2. Checks each contact against Instantly (by First Name + Last Name)
3. If found → excluded
4. If NOT found → calls LeadMagic to get personal email via LinkedIn URL
5. Download filtered CSV with `email` column

## Setup

```bash
cp .env.local.example .env.local
# Edit .env.local with your keys
npm install
npm run dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `APP_PASSWORD` | Password to access the app |
| `INSTANTLY_API_KEY` | Instantly API v2 Bearer token |
| `LEADMAGIC_API_KEY` | LeadMagic API key |
| `CONCURRENCY` | Parallel requests (default 10) |

## CSV Format

Input CSVs must have these columns:
- `First Name`
- `Last Name`
- `Linkedin` (URL for email enrichment)

## Deploy

Push to GitHub → auto-deploys on Vercel. Set env vars in Vercel dashboard.

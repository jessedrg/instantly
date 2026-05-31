# Instantly CSV Filter

Filter leads against Instantly CRM and enrich with personal emails via LeadMagic.

## What it does

1. Reads all CSVs from `input/` folder
2. Checks each contact against Instantly (by First Name + Last Name)
3. If found in Instantly → **excluded**
4. If NOT found → calls LeadMagic to get personal email via LinkedIn URL
5. Outputs filtered CSV with `email` column to `output/`

## CLI Usage

```bash
cp .env.example .env
# Edit .env with your API keys
npm install
npm start
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INSTANTLY_API_KEY` | Instantly API v2 Bearer token | required |
| `LEADMAGIC_API_KEY` | LeadMagic API key | required |
| `INPUT_DIR` | Folder with input CSVs | `input` |
| `OUTPUT_DIR` | Folder for output CSVs | `output` |
| `CONCURRENCY` | Parallel requests | `10` |

## Web App

A Next.js web interface for non-technical users.

```bash
cd web
cp .env.local.example .env.local
# Edit .env.local with your keys + password
npm install
npm run dev
```

### Web Environment Variables

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

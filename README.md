# Quip Folder Exporter

A production-friendly MVP for HR/business users to export all docs from a Quip folder into one ZIP of DOCX files.

Live app: [quip-export.vercel.app](https://quip-export.vercel.app/)

## What this app does

1. Guides the user through a 3-step form:
   - generate token
   - paste token
   - paste folder ID
2. Validates the token via `GET /1/oauth/verify_token`.
3. Reads folder contents and scans nested subfolders.
4. Deduplicates thread IDs.
5. Resolves thread titles (best effort) for user-friendly filenames.
5. Starts async bulk export via `POST /1/threads/export/async`.
6. Polls `GET /1/threads/export/async?request_id=...` until complete.
7. Downloads successful exported files.
8. Builds a ZIP while preserving folder/subfolder structure.
9. Uses original file/thread titles for DOCX names when available.
9. Provides a JSON failure report for partial failures.

## Security notes

- Bearer token is never written to disk, localStorage, sessionStorage, cookies, or any database.
- Token is kept in memory only during the active export flow.
- Token is not sent back to the browser after export starts.
- Token values are redacted from errors/logs.

## API base URL

- Default is `https://platform.quip.com`.
- The UI does not expose this option to keep things simple for internal users.
- For VPC/private Quip environments, set server env var `QUIP_API_BASE_URL`.

## Stack

- Next.js App Router (TypeScript)
- Node runtime API routes
- `jszip` for ZIP packaging

## Local development

```bash
cd /Users/carlamendes/Documents/New\ project/carlamendes/Comnexa/quip-export
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## How to use (internal user flow)

1. Step 1: Open [https://quip.com/dev/token](https://quip.com/dev/token) and create a personal token.
2. Step 2: Paste token into the app.
3. Step 3: Paste folder ID.
   - In Quip, open the target folder and copy the ID from the URL (after `/folder/`).
4. Click **Export to DOCX ZIP**.
5. Wait until the app shows **Done** and click **Download ZIP**.

Important:
- Do not close or refresh the page while export/download is running.
- Admin is usually not required; token only needs permission to the target folder/files.

## Notes for production hardening

This MVP keeps active job state in memory. Completed exports are persisted temporarily to runtime temp storage for more reliable post-completion download/report access.

For high volume or strict multi-instance reliability, move active job state to a shared store (for example Vercel KV/Redis) and move processing to a queue/worker pattern.

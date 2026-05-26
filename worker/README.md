# extension Worker

Cloudflare Worker dung chung de dong bo du lieu cho cac extension qua R2.

## Endpoints

- `GET /sync/:appId/state`
- `PUT /sync/:appId/state`
- `OPTIONS /sync/:appId/state`

Extension hien tai dung `appId` la `homepage`, nen object R2 se nam o:

```text
apps/homepage/state.v1.json
```

## Deploy

```sh
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create extension-sync
npx wrangler secret put SYNC_API_KEY
npx wrangler deploy
```

Sau khi deploy, nhap Worker URL dang `https://extension.<subdomain>.workers.dev`
va API code trung voi `SYNC_API_KEY` vao settings cua extension.

Neu dung custom domain, hay them domain do vao `host_permissions` trong
`manifest.json`.

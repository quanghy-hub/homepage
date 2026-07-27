# Homepage — Custom New Tab Page Chrome Extension

A clean, highly customizable new tab page designed to organize your favorite web links. Easily group your quicklinks into custom categories, pin important groups for quick access, and keep your workspace clean and organized.

This project is built using native HTML, CSS, and modern Javascript (ES Modules) for the frontend, combined with a Cloudflare Worker for backend synchronization via Cloudflare R2 storage.

## Features

- **Custom Grouping**: Group your quicklinks into custom tabs.
- **Drag-and-Drop Reordering**: Drag links, group tabs, and pinned group headers to rearrange them. Works seamlessly on both desktop (mouse) and mobile (touch devices).
- **Multi-Profile Sync**: Sync links and groups across devices (e.g., MacBook and Mobile). Supports different pinned groups and UI sizes per profile while sharing the same links database.
- **Robust Favicon Fallbacks**: Resolves favicons in three tiers:
  1. Google S2 Favicon API (256px resolution)
  2. Chrome Internal Favicon API (`_favicon` size 1024)
  3. First letter of the site name (or Unicode emoji) as a text fallback.
- **Local Favicon Caching**: Caches loaded favicons locally for 14 days as Base64 Data URLs to minimize external requests.
- **Revision & Backup**: Automated collision-detection with revision numbering to prevent concurrent write overrides, plus automatic daily backups via R2.

---

## Getting Started

### 1. Load the Extension in Chrome

To run the Extension locally:

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** in the top-left corner.
4. Select the root folder of this repository (the directory containing `manifest.json`).

The custom new tab page is now active. Open a new tab to see it!

### 2. Set Up Cloud Sync (Cloudflare Worker)

To enable syncing across multiple devices, deploy the Cloudflare Worker in the `worker/` folder:

1. Navigate to the worker directory and install dependencies:
   ```bash
   cd worker
   npm install
   ```
2. Log in to your Cloudflare account:
   ```bash
   npx wrangler login
   ```
3. Create an R2 storage bucket to hold the sync payloads:
   ```bash
   npx wrangler r2 bucket create extension-sync
   ```
4. Set your private synchronization security key (replace with a secure password):
   ```bash
   npx wrangler secret put SYNC_API_KEY
   ```
5. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```
6. Copy the deployed Worker URL (e.g., `https://extension.<your-subdomain>.workers.dev`).
7. Open the **Settings Panel** (gear icon) in the Homepage extension:
   - Paste the Worker URL.
   - Enter your `SYNC_API_KEY` into the **API Code** input.
   - Click **Verify** (`✓` button) to test the connection.

---

## Project Structure

```text
├── assets/                  # Extension icons and graphics
├── manifest.json            # Manifest V3 configuration
├── tests/                   # Native Node.js unit tests
├── worker/                  # Cloudflare Worker codebase
│   ├── src/                 # Worker logic, storage and normalizers
│   └── wrangler.toml        # Cloudflare Wrangler configuration
└── src/                     # Frontend codebase
    ├── background/          # Service worker for background actions (recent tabs)
    ├── shared/              # Shared constants and utility functions
    └── newtab/              # New Tab page client
        ├── index.html       # Page layout
        ├── index.css        # Layout & core styling
        ├── modal.css        # Modal form styling
        ├── settings.css     # Settings & sync panel styling
        └── index.js         # Entry point & event binding
```

---

## Running Unit Tests

The project includes unit tests for both the extension controllers/utilities and the worker R2 synchronizer using the native Node.js test runner. No external dependencies are needed.

To run the unit tests:

```bash
node --test tests/*.test.mjs
```

---

## Development & Refactoring Rules

- **CSS Splits**: Stylesheets are modularized:
  - `index.css`: Grid, links, tabs, and base structure.
  - `modal.css`: Styling for creation and deletion modal dialogs.
  - `settings.css`: Styling for the settings dialog and cloud-sync settings.
- **JS Modules**: Code is separated into distinct classes/factory functions to keep components isolated and testable. Avoid writing single-file monolithic logic.

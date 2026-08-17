# Chrome Web Store Listing — Homepage

> Last Updated: 2026-07-22

## Store Listing

**Extension Name**
Homepage

**Short Description**
Custom new tab page with grouped quicklinks

**Detailed Description**
A clean and highly customizable new tab page designed to organize your favorite web links. Easily group your quicklinks into custom categories, pin important groups for quick access, and keep your workspace clean and organized.

Features:

- Custom grouping for your quicklinks
- Drag and drop reordering of links and groups
- Three-level favicon loading with a text fallback
- Multiple custom sync profiles
- Fast, secure, and offline-first design
- Seamless sync support using Cloudflare Workers

**Category**
Productivity

**Single Purpose**
Displays a custom new tab page with grouped, draggable quicklinks.

**Primary Language**
Vietnamese (vi)

## Graphics & Assets

| Asset        | Dimensions          | Status         | Filename                                         |
| ------------ | ------------------- | -------------- | ------------------------------------------------ |
| Store Icon   | 128×128 PNG         | ✅ Ready       | assets/icons/icon128.png                         |
| Toolbar Icon | 16×16, 32×32 PNG    | ✅ Ready       | assets/icons/icon16.png, assets/icons/icon32.png |
| Screenshot 1 | 1280×800 or 640×400 | ⬜ Not created |                                                  |

## Permissions Justification

| Permission                 | Type             | Justification                                                                                                    |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `storage`                  | permissions      | Needed to save user settings, quicklinks, and sync profiles locally in the browser.                              |
| `tabs`                     | permissions      | Needed to query active tab information so users can add their currently open page as a quicklink with one click. |
| `favicon`                  | permissions      | Needed to retrieve the exact website favicon cached by the browser for page URLs in the user's quicklinks.       |
| `https://www.google.com/*` | host_permissions | Needed to retrieve high-resolution favicons from the Google S2 Favicon API.                                      |
| `https://*.gstatic.com/*`  | host_permissions | Needed to retrieve the official Gmail favicon.                                                                   |
| `https://*.workers.dev/*`  | host_permissions | Needed to synchronize settings and quicklinks with the user's private Cloudflare sync worker endpoint.           |

## Favicon Loading

Favicons are resolved in this order:

1. Gmail's official icon or the Google S2 Favicon API at 256 px.
2. Chrome's internal Favicon API (`_favicon`) with `size=1024`, which Chrome fits to the displayed icon size.
3. An uppercase first-letter icon rendered locally when neither image source succeeds.

Successful images are cached locally for 14 days. Clearing the favicon cache triggers the same priority order again.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Distribution

**Visibility**: Public
**Regions**: All regions

## Version History

| Version | Date       | Changes                                                                                                                                                                                                                                                   | Status |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.0.5   | 2026-08-17 | Fixed "Service worker registration failed" on Android Chromium by converting the background worker to a self-contained classic script (no ES module imports, no `type: module`) with guarded `chrome.*` API access; added background SW regression tests. | Draft  |
| 1.0.4   | 2026-07-22 | Handled cloud sync network/fetch errors gracefully, suppressed console warnings on transient errors, normalized Worker URLs with protocol scheme, and added unit tests for sync resilience and profile fallback.                                          | Draft  |
| 1.0.3   | 2026-06-20 | Fixed Chrome favicon loading to load directly (bypassing background fetch/cache) and improved fallback letter extraction for Unicode/emojis and whitespace.                                                                                               | Draft  |
| 1.0.2   | 2026-06-19 | Added Google-first, Chrome-second favicon loading with a local uppercase-letter fallback and 14-day cache.                                                                                                                                                | Draft  |
| 1.0.1   | 2026-06-19 | Added synchronized per-link favicon URLs with a simple Google S2 fallback and 14-day local image cache.                                                                                                                                                   | Draft  |
| 1.0.0   | 2026-06-19 | Initial release with customizable groups, Cloudflare sync, and crisp icon support.                                                                                                                                                                        | Draft  |

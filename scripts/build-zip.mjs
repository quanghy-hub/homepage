/**
 * Cross-platform packaging script for the Chrome extension.
 *
 * Copies the extension payload into `dist/` and zips it as `homepage.zip`
 * (zip on macOS/Linux, PowerShell Compress-Archive on Windows).
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ZIP_PATH = path.join(ROOT, 'homepage.zip');
const ITEMS = ['src', 'assets', 'manifest.json', 'README.md'];

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const item of ITEMS) {
    const source = path.join(ROOT, item);
    if (!existsSync(source)) {
      console.error(`Missing required item: ${source}`);
      process.exit(1);
    }
    await cp(source, path.join(DIST, item), { recursive: true });
  }

  if (existsSync(ZIP_PATH)) {
    await rm(ZIP_PATH, { force: true });
  }

  let result;
  if (process.platform === 'win32') {
    const script = `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${ZIP_PATH}' -Force`;
    result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'inherit'
    });
  } else {
    result = spawnSync('zip', ['-r', ZIP_PATH, ...ITEMS], { cwd: DIST, stdio: 'inherit' });
  }

  if (result.status !== 0) {
    console.error('Packaging failed.');
    process.exit(result.status ?? 1);
  }
  console.log(`Built: ${ZIP_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

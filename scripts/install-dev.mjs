import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
const extensionId = manifest.browser_specific_settings?.gecko?.id;

if (!extensionId) {
  console.error('Không tìm thấy gecko.id trong manifest.json');
  process.exit(1);
}

console.log(`Building Homepage v${manifest.version} .xpi package for Firefox...`);
execSync('npm run build:firefox', { stdio: 'inherit', cwd: ROOT_DIR });

const artifactsDir = path.join(ROOT_DIR, 'web-ext-artifacts');
const xpiFiles = existsSync(artifactsDir)
  ? readdirSync(artifactsDir).filter((f) => f.endsWith('.xpi'))
  : [];
const xpiName = xpiFiles.find((f) => f.includes(manifest.version)) || xpiFiles[0];
const xpiFile = xpiName ? path.join(artifactsDir, xpiName) : null;
if (!xpiFile || !existsSync(xpiFile)) {
  console.error(`Không tìm thấy file .xpi trong ${artifactsDir}`);
  process.exit(1);
}

const profilesDir = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Firefox',
  'Profiles'
);
if (existsSync(profilesDir)) {
  const profiles = readdirSync(profilesDir).filter((dir) => dir.includes('dev-edition'));
  if (profiles.length === 0) {
    console.log('Không tìm thấy profile Firefox Developer Edition.');
  }
  for (const profile of profiles) {
    const extDir = path.join(profilesDir, profile, 'extensions');
    if (!existsSync(extDir)) {
      mkdirSync(extDir, { recursive: true });
    }
    const targetXpi = path.join(extDir, `${extensionId}.xpi`);
    copyFileSync(xpiFile, targetXpi);
    console.log(
      `\x1b[32m✔ Đã tự động cài đặt vào Firefox Developer Edition (${profile}):\n  -> ${targetXpi}\x1b[0m`
    );
  }
} else {
  console.log(`Không tìm thấy thư mục Profiles tại ${profilesDir}`);
}

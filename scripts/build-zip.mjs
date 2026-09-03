/**
 * Cross-platform packaging script for the Chrome extension.
 *
 * Copies the extension payload into `dist/` and zips it as `homepage.zip`
 * using a minimal spec-compliant ZIP writer that always uses forward-slash
 * (`/`) entry separators.
 *
 * Why not Compress-Archive or zip? PowerShell's Compress-Archive stores entry
 * names with Windows backslashes (`src\newtab\index.js`), which extractors on
 * Android/Linux treat as literal filename characters — the extracted folder
 * tree is broken and the extension fails to load there (e.g. "Service worker
 * registration failed. Status code: 10" even though the code is fine). A ZIP
 * package must use `/` separators universally.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ZIP_PATH = path.join(ROOT, 'homepage.zip');
const ITEMS = ['src', 'assets', 'manifest.json', 'README.md'];

// ---------------------------------------------------------------------------
// Minimal ZIP writer (deflate for files, store for directories).
// ---------------------------------------------------------------------------

let crcTable;
function getCrcTable() {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  return crcTable;
}

export function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Recursively lists files under `dir`. Entry names always use `/` separators,
 * independent of the host platform. Directories are included as `name/`.
 *
 * @param {string} dir Absolute directory path.
 * @param {string} base Relative path prefix (forward slashes).
 * @returns {Promise<Array<{name:string, directory:boolean, data?:Buffer}>>}
 */
export async function collectFiles(dir, base = '') {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const name = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ name: `${name}/`, directory: true });
      out.push(...(await collectFiles(fullPath, name)));
    } else {
      out.push({ name, directory: false, data: await readFile(fullPath) });
    }
  }
  return out;
}

/**
 * Writes a valid ZIP archive (local headers + central directory + EOCD).
 *
 * @param {string} zipPath Output path.
 * @param {Array<{name:string, directory:boolean, data?:Buffer}>} files
 */
export async function writeZip(zipPath, files) {
  const chunks = [];
  const centralRecords = [];
  let offset = 0;

  const timestamp = new Date();
  const dosTime =
    ((timestamp.getHours() << 11) |
      (timestamp.getMinutes() << 5) |
      Math.floor(timestamp.getSeconds() / 2)) &
    0xffff;
  const dosDate =
    (((timestamp.getFullYear() - 1980) << 9) |
      ((timestamp.getMonth() + 1) << 5) |
      timestamp.getDate()) &
    0xffff;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const raw = file.directory ? Buffer.alloc(0) : file.data;
    const compressed = file.directory ? Buffer.alloc(0) : deflateRawSync(raw);
    const method = file.directory ? 0 : 8;
    const crc = file.directory ? 0 : crc32(raw);
    const uncompressedSize = raw.length;
    const versionNeeded = method === 8 ? 20 : 10;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 file name flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuffer, compressed);

    centralRecords.push({
      nameBuffer,
      method,
      crc,
      versionNeeded,
      compressedSize: compressed.length,
      uncompressedSize,
      localOffset: offset,
      dosTime,
      dosDate,
      directory: file.directory
    });

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralOffset = offset;
  for (const record of centralRecords) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(record.versionNeeded, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(record.method, 10);
    header.writeUInt16LE(record.dosTime, 12);
    header.writeUInt16LE(record.dosDate, 14);
    header.writeUInt32LE(record.crc, 16);
    header.writeUInt32LE(record.compressedSize, 20);
    header.writeUInt32LE(record.uncompressedSize, 24);
    header.writeUInt16LE(record.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30); // extra field length
    header.writeUInt16LE(0, 32); // comment length
    header.writeUInt16LE(0, 34); // disk number start
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(record.directory ? 0x10 : 0, 38); // external attrs
    header.writeUInt32LE(record.localOffset, 42);

    chunks.push(header, record.nameBuffer);
    offset += header.length + record.nameBuffer.length;
  }
  const centralSize = offset - centralOffset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central directory disk
  eocd.writeUInt16LE(centralRecords.length, 8); // entries on this disk
  eocd.writeUInt16LE(centralRecords.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  await writeFile(zipPath, Buffer.concat(chunks));
}

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

  const files = await collectFiles(DIST);
  await writeZip(ZIP_PATH, files);
  console.log(`Built: ${ZIP_PATH} (${files.length} entries)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { collectFiles, writeZip } from '../scripts/build-zip.mjs';

/**
 * Parses entry names (and optionally inflates file payloads) from a ZIP file.
 * Regression guard for the packaging bug where PowerShell Compress-Archive
 * stored entry names with backslashes, breaking extraction on Android/Linux.
 */
function parseZip(filePath) {
  const buffer = readFileSync(filePath);

  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  assert.ok(eocd >= 0, 'EOCD signature not found');

  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = centralOffset;

  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central header signature');
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    // Local header follows the same layout up to the name.
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const extraLocalLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + extraLocalLen;
    const compressedSize = buffer.readUInt32LE(localOffset + 18);
    const method = buffer.readUInt16LE(localOffset + 8);
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method,
      payload: method === 8 ? inflateRawSync(payload) : payload
    });
  }
  return entries;
}

function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'home-zipfix-'));
  mkdirSync(path.join(dir, 'src', 'newtab'), { recursive: true });
  mkdirSync(path.join(dir, 'assets', 'icons'), { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), '{"manifest_version":3}');
  writeFileSync(path.join(dir, 'src', 'newtab', 'index.html'), '<html></html>');
  writeFileSync(path.join(dir, 'src', 'newtab', 'index.js'), 'console.log("hi");');
  writeFileSync(path.join(dir, 'assets', 'icons', 'icon.png'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(path.join(dir, 'empty.txt'), '');
  return dir;
}

test('zip entries use forward-slash separators (Android-safe)', async () => {
  const fixture = makeFixture();
  const output = path.join(fixture, 'out.zip');
  try {
    const files = await collectFiles(fixture);
    await writeZip(output, files);

    const entries = parseZip(output);
    const names = entries.map((entry) => entry.name);

    assert.ok(names.some((name) => name === 'manifest.json'));
    assert.ok(names.some((name) => name === 'src/newtab/index.html'));
    assert.ok(names.some((name) => name === 'src/newtab/index.js'));
    assert.equal(names.filter((name) => name.endsWith('/')).length, 4); // src/, src/newtab/, assets/, assets/icons/
    assert.ok(
      names.every((name) => !name.includes('\\')),
      `no entry name may contain a backslash, got: ${JSON.stringify(names)}`
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('file payloads round-trip through deflate', async () => {
  const fixture = makeFixture();
  const output = path.join(fixture, 'out.zip');
  try {
    const files = await collectFiles(fixture);
    await writeZip(output, files);

    const entries = parseZip(output);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    assert.equal(byName.get('manifest.json').payload.toString(), '{"manifest_version":3}');
    assert.equal(byName.get('src/newtab/index.js').payload.toString(), 'console.log("hi");');
    assert.deepEqual(Array.from(byName.get('assets/icons/icon.png').payload), [1, 2, 3, 4]);
    assert.equal(byName.get('empty.txt').payload.length, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

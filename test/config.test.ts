import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { currentDir, timestampForFilename } from '../src/config.js';

describe('timestampForFilename', () => {
  it('contains no character that is illegal in a Windows filename', () => {
    // ISO-8601 uses colons, which NTFS reads as an alternate-data-stream separator.
    assert.doesNotMatch(timestampForFilename(), /[:*?"<>|]/);
  });

  it('still round-trips to the original instant', () => {
    const stamp = timestampForFilename();
    const restored = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
    assert.equal(Number.isNaN(Date.parse(restored)), false);
  });
});

describe('module directory derivation', () => {
  it('resolves to an absolute directory that exists', () => {
    assert.equal(path.isAbsolute(currentDir), true);
    assert.equal(existsSync(currentDir), true);
  });

  // Only fails when the checkout path actually contains a character needing
  // percent-encoding (a space, most commonly), so it is a partial guard. The
  // technique assertion below is the one that holds regardless of checkout path.
  it('leaves no percent-encoding in the derived directory', () => {
    assert.doesNotMatch(currentDir, /%[0-9A-Fa-f]{2}/);
  });

  // This asserts the *technique*, not just the current value. Asserting only on
  // `currentDir` would pass against the old implementation too, because this
  // checkout's path happens to contain no character needing percent-encoding.
  it('decodes percent-encoding, unlike URL.pathname', () => {
    const url = new URL('file:///tmp/dir with space/config.ts');

    const fixed = path.dirname(fileURLToPath(url));
    const buggy = path.resolve(new URL(url).pathname, '..');

    assert.equal(fixed, path.join('/tmp', 'dir with space'));
    assert.equal(buggy, path.join('/tmp', 'dir%20with%20space'));
    assert.notEqual(fixed, buggy);
  });
});

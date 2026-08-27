import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFundConfigArg } from '../src/args.js';

describe('parseFundConfigArg', () => {
  it('returns null when the flag is absent, selecting interactive mode', () => {
    assert.equal(parseFundConfigArg([]), null);
    assert.equal(parseFundConfigArg(['--other', 'value']), null);
  });

  it('returns the path that follows the flag', () => {
    assert.equal(parseFundConfigArg(['--fund-config', './accounts.json']), './accounts.json');
  });

  it('reads the flag from any position', () => {
    assert.equal(parseFundConfigArg(['--verbose', '--fund-config', 'a.json']), 'a.json');
  });

  it('throws when the flag is last, rather than silently going interactive', () => {
    // Silently falling back would hang a CI job on the readline menu.
    assert.throws(() => parseFundConfigArg(['--fund-config']), /requires a path argument/);
  });

  it('throws when the next argument is another flag', () => {
    assert.throws(() => parseFundConfigArg(['--fund-config', '--verbose']), /requires a path argument/);
  });
});

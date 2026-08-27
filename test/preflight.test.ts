import assert from 'node:assert/strict';
import type { PathLike } from 'node:fs';
import { describe, it } from 'node:test';
import { dependencyProblem, ensureEnvFile, nodeVersionProblem } from '../scripts/preflight.mjs';

describe('nodeVersionProblem', () => {
  it('accepts the supported versions', () => {
    assert.equal(nodeVersionProblem('22.0.0'), null);
    assert.equal(nodeVersionProblem('24.16.0'), null);
  });

  it('rejects versions below 22 with actionable guidance', () => {
    const message = nodeVersionProblem('20.19.4');
    assert.match(String(message), /too old/);
    assert.match(String(message), /nvm use/);
  });

  it('does not block on an unparseable version', () => {
    assert.equal(nodeVersionProblem('not-a-version'), null);
  });
});

describe('dependencyProblem', () => {
  it('is satisfied once tsx is installed', () => {
    assert.equal(dependencyProblem(true), null);
  });

  it('explains the ts-node to tsx change for older clones', () => {
    const message = dependencyProblem(false);
    assert.match(String(message), /npm install/);
    assert.match(String(message), /ts-node/);
  });
});

describe('ensureEnvFile', () => {
  it('creates .env from the example on a first run', () => {
    const copied: string[][] = [];
    const result = ensureEnvFile('/repo', {
      exists: (p: PathLike) => String(p).endsWith('.env.example'),
      copy: (from: PathLike, to: PathLike): void => {
        copied.push([String(from), String(to)]);
      },
    });
    assert.equal(result, 'created');
    assert.equal(copied.length, 1);
  });

  it('never overwrites an existing .env', () => {
    let copies = 0;
    const result = ensureEnvFile('/repo', {
      exists: () => true,
      copy: (): void => {
        copies++;
      },
    });
    assert.equal(result, 'exists');
    assert.equal(copies, 0);
  });

  it('is a no-op when there is no example to copy', () => {
    const result = ensureEnvFile('/repo', { exists: () => false, copy: () => {} });
    assert.equal(result, 'no-example');
  });
});

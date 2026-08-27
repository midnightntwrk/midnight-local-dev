#!/usr/bin/env node
/**
 * Runs automatically before `npm start` via npm's `prestart` hook.
 *
 * Plain JavaScript with no dependencies on purpose: two of the three things it
 * checks are precisely the cases where the TypeScript entry point cannot start,
 * so it has to run before tsx is involved.
 */
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINIMUM_NODE_MAJOR = 22;

/**
 * @param {string} version a `process.versions.node` string
 * @returns {string | null} an actionable message, or null when the version is fine
 */
export function nodeVersionProblem(version) {
  const major = Number.parseInt(version.split('.')[0], 10);
  if (Number.isNaN(major) || major >= MINIMUM_NODE_MAJOR) return null;
  return [
    `Node v${version} is too old — this project needs Node >= ${MINIMUM_NODE_MAJOR}.`,
    '',
    '  If you use nvm:  nvm use',
    '  Otherwise, install Node 22 or newer from https://nodejs.org',
  ].join('\n');
}

/**
 * `npm start` runs through tsx. A clone made before that change has a
 * node_modules containing ts-node instead, and fails with a bare
 * "tsx: not found" that says nothing about the cause.
 *
 * @param {boolean} tsxInstalled
 * @returns {string | null}
 */
export function dependencyProblem(tsxInstalled) {
  if (tsxInstalled) return null;
  return [
    'Dependencies are missing or out of date.',
    '',
    '  If you cloned this project earlier, `npm start` now runs through tsx',
    '  rather than ts-node, so your node_modules needs refreshing:',
    '',
    '      npm install',
  ].join('\n');
}

/**
 * Create `.env` from `.env.example` so a first run needs no manual setup.
 *
 * @returns {'created' | 'exists' | 'no-example'}
 */
export function ensureEnvFile(root, { copy = copyFileSync, exists = existsSync } = {}) {
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  if (exists(envPath)) return 'exists';
  if (!exists(examplePath)) return 'no-example';
  copy(examplePath, envPath);
  return 'created';
}

function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const problem = nodeVersionProblem(process.versions.node) ??
    dependencyProblem(existsSync(path.join(projectRoot, 'node_modules', 'tsx')));

  if (problem !== null) {
    console.error(`\nError: ${problem}\n`);
    process.exit(1);
  }

  if (ensureEnvFile(projectRoot) === 'created') {
    console.log('Created .env from .env.example — edit it to override any defaults.');
  }
}

// Only run the checks when executed directly, so the helpers stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

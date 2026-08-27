#!/usr/bin/env node
/**
 * Tear down the Midnight local network containers.
 *
 * This mirrors the teardown in `src/network.ts` rather than shelling out to a
 * POSIX one-liner: `2>/dev/null`, `;` chaining and a trailing `true` are all
 * shell-specific, and npm routes scripts through ComSpec on Windows regardless
 * of which shell invoked them. Argument arrays with `execFileSync` are portable
 * and avoid a shell entirely.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTAINER_NAMES = ['midnight-node', 'midnight-indexer', 'midnight-proof-server'];
/** Must match COMPOSE_PROJECT_NAME in src/network.ts, which is what `up` used. */
const PROJECT_NAME = 'midnight-local-dev';

/** Best-effort: the containers or the compose project may simply not exist. */
function tryDocker(args) {
  try {
    execFileSync('docker', args, { cwd: projectRoot, stdio: 'ignore' });
  } catch {
    // ignore
  }
}

tryDocker(['rm', '-f', ...CONTAINER_NAMES]);
tryDocker(['compose', '-p', PROJECT_NAME, '-f', 'standalone.yml', 'down', '--remove-orphans']);

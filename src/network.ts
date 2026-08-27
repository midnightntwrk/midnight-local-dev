import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { type Config } from './config.js';
import { currentDir } from './config.js';
import { type Logger } from 'pino';

const CONTAINER_NAMES = ['midnight-node', 'midnight-indexer', 'midnight-proof-server'];

/** Compose project name. Kept explicit so teardown never depends on the checkout directory name. */
export const COMPOSE_PROJECT_NAME = 'midnight-local-dev';

/**
 * Ceiling for each per-service health wait.
 *
 * testcontainers defaults to 60s, but `standalone.yml` allows the indexer far
 * longer (10s start period plus 20 retries at 10s). Without this the two
 * budgets disagree and testcontainers gives up long before compose would — on a
 * cold runner the indexer, which boots its own storage and pub/sub, is the
 * likeliest service to exceed 60s.
 */
const STARTUP_TIMEOUT_MS = 240_000;

export const createDockerEnv = (): DockerComposeEnvironment => {
  return new DockerComposeEnvironment(path.resolve(currentDir, '..'), 'standalone.yml')
    .withProjectName(COMPOSE_PROJECT_NAME)
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .withWaitStrategy('midnight-proof-server', Wait.forHealthCheck())
    .withWaitStrategy('midnight-node', Wait.forHealthCheck())
    .withWaitStrategy('midnight-indexer', Wait.forHealthCheck());
};

/**
 * Report a container's health as docker sees it, or `'none'` when it declares
 * no healthcheck and `'missing'` when it cannot be inspected at all.
 */
const containerHealth = (name: string): string => {
  try {
    return execFileSync(
      'docker',
      ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name],
      { encoding: 'utf-8' },
    ).trim();
  } catch {
    return 'missing';
  }
};

/**
 * Check whether a usable Midnight local network is already running.
 *
 * Health is part of the question, not a detail: a container can sit in
 * `running` while its service is broken or still starting, and treating that as
 * a usable network makes the tool attach to a devnet that will never answer.
 */
export const isNetworkRunning = (): boolean => {
  try {
    const result = execFileSync(
      'docker',
      ['ps', '--filter', 'status=running', '--format', '{{.Names}}'],
      { encoding: 'utf-8' },
    );
    const running = result.trim().split('\n').filter(Boolean);
    if (!CONTAINER_NAMES.every((name) => running.includes(name))) {
      return false;
    }
    // `none` is accepted so removing a healthcheck cannot silently disable reuse.
    return CONTAINER_NAMES.every((name) => {
      const health = containerHealth(name);
      return health === 'healthy' || health === 'none';
    });
  } catch {
    return false;
  }
};

/**
 * Stop and remove existing Midnight containers, pull fresh images, and start.
 */
export const freshStart = async (config: Config, logger: Logger): Promise<StartedDockerComposeEnvironment> => {
  logger.info('Stopping existing containers...');
  const cwd = path.resolve(currentDir, '..');
  try {
    execFileSync('docker', ['rm', '-f', ...CONTAINER_NAMES], { cwd, stdio: 'ignore' });
  } catch {
    // ignore if containers don't exist
  }
  try {
    execFileSync('docker', ['compose', '-p', COMPOSE_PROJECT_NAME, '-f', 'standalone.yml', 'down', '--remove-orphans'], { cwd, stdio: 'ignore' });
  } catch {
    // ignore if compose isn't running
  }

  logger.info('Pulling latest images...');
  execFileSync('docker', ['compose', '-p', COMPOSE_PROJECT_NAME, '-f', 'standalone.yml', 'pull'], {
    cwd,
    stdio: 'inherit',
  });

  return startNetwork(config, logger);
};

export const startNetwork = async (config: Config, logger: Logger): Promise<StartedDockerComposeEnvironment> => {
  logger.info('Starting Midnight standalone network via docker compose...');
  const dockerEnv = createDockerEnv();
  const env = await dockerEnv.up();

  logger.info(`Node:         ${config.node}`);
  logger.info(`Indexer:      ${config.indexer}`);
  logger.info(`Indexer WS:   ${config.indexerWS}`);
  logger.info(`Proof Server: ${config.proofServer}`);
  logger.info('Midnight standalone network is running.');

  return env;
};

export const stopNetwork = async (env: StartedDockerComposeEnvironment, logger: Logger): Promise<void> => {
  logger.info('Stopping Midnight standalone network...');
  await env.down();
  logger.info('Network stopped.');
};

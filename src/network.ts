import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { type Config } from './config.js';
import { currentDir } from './config.js';
import { type Logger } from 'pino';

const CONTAINER_NAMES = ['midnight-node', 'midnight-indexer', 'midnight-proof-server'];

export const createDockerEnv = (): DockerComposeEnvironment => {
  return new DockerComposeEnvironment(path.resolve(currentDir, '..'), 'standalone.yml')
    .withProjectName('midnight-local-dev')
    .withWaitStrategy('midnight-proof-server', Wait.forLogMessage('Actix runtime found; starting in Actix runtime', 1))
    .withWaitStrategy('midnight-indexer', Wait.forLogMessage(/starting indexing/, 1));
};

/**
 * Check if the Midnight local network containers are already running.
 */
export const isNetworkRunning = (): boolean => {
  try {
    const result = execFileSync(
      'docker',
      ['ps', '--filter', 'status=running', '--format', '{{.Names}}'],
      { encoding: 'utf-8' },
    );
    const running = result.trim().split('\n').filter(Boolean);
    return CONTAINER_NAMES.every((name) => running.includes(name));
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
    execFileSync('docker', ['compose', '-f', 'standalone.yml', 'down', '--remove-orphans'], { cwd, stdio: 'ignore' });
  } catch {
    // ignore if compose isn't running
  }

  logger.info('Pulling latest images...');
  execFileSync('docker', ['compose', '-f', 'standalone.yml', 'pull'], {
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

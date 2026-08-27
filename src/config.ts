import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

export const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * A filesystem-safe timestamp. `Date.prototype.toISOString` emits colons, which
 * are illegal in NTFS filenames and are parsed as an alternate-data-stream
 * separator on Windows.
 */
export function timestampForFilename(): string {
  return new Date().toISOString().replace(/:/g, '-');
}

/**
 * Read an override from the environment, falling back to the local default.
 *
 * `index.ts` imports `dotenv/config` before anything else, so values in `.env`
 * are already loaded by the time a config is constructed.
 */
function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : fallback;
}

export interface Config {
  readonly logDir: string;
  readonly networkId: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly nodeWS: string;
  readonly proofServer: string;
  readonly faucet: string;
  envConfig(): EnvironmentConfiguration;
}

export class StandaloneConfig implements Config {
  readonly logDir = path.resolve(currentDir, '..', 'logs', `${timestampForFilename()}.log`);
  readonly networkId = 'undeployed';
  // Overridable so this can point at a stack published on different ports —
  // for example when another local devnet already holds the defaults.
  readonly indexer = fromEnv('MN_INDEXER_URL', 'http://127.0.0.1:8088/api/v4/graphql');
  readonly indexerWS = fromEnv('MN_INDEXER_WS', 'ws://127.0.0.1:8088/api/v4/graphql/ws');
  readonly node = fromEnv('MN_NODE_URL', 'http://127.0.0.1:9944');
  readonly nodeWS = fromEnv('MN_NODE_WS', 'ws://127.0.0.1:9944');
  readonly proofServer = fromEnv('MN_PROOF_SERVER_URL', 'http://127.0.0.1:6300');
  readonly faucet = '';

  constructor() {
    setNetworkId(this.networkId);
  }

  envConfig(): EnvironmentConfiguration {
    return {
      walletNetworkId: this.networkId,
      networkId: this.networkId,
      indexer: this.indexer,
      indexerWS: this.indexerWS,
      node: this.node,
      nodeWS: this.nodeWS,
      proofServer: this.proofServer,
      faucet: this.faucet,
    };
  }
}

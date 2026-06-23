import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

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
  readonly logDir = path.resolve(currentDir, '..', 'logs', `${new Date().toISOString()}.log`);
  readonly networkId = 'undeployed';
  readonly indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  readonly indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  readonly node = 'http://127.0.0.1:9944';
  readonly nodeWS = 'ws://127.0.0.1:9944';
  readonly proofServer = 'http://127.0.0.1:6300';
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

import 'dotenv/config';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type StartedDockerComposeEnvironment } from 'testcontainers';
import { type Logger } from 'pino';
import { StandaloneConfig } from './config.js';
import { createLogger } from './logger.js';
import { isNetworkRunning, startNetwork, freshStart, stopNetwork } from './network.js';
import {
  type WalletContext,
  setLogger as setWalletLogger,
  buildWalletFromHexSeed,
  registerNightForDust,
  displayWalletBalances,
  closeWallet,
} from './wallet.js';
import {
  type FundedAccount,
  setLogger as setFundingLogger,
  fundFromConfigFile,
  fundFromPublicKeys,
} from './funding.js';

/**
 * Genesis mint wallet seed — gives access to tokens minted in the genesis block
 * of a local development node.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const MENU = `
Choose an option:
  [1] Fund accounts from config file (NIGHT + DUST registration)
  [2] Fund accounts by public key (NIGHT transfer only)
  [3] Display wallets
  [4] Exit
> `;

function displayFundedAccounts(fundedAccounts: FundedAccount[], logger: Logger): void {
  if (fundedAccounts.length === 0) {
    logger.info('No funded accounts yet.');
    return;
  }

  logger.info(`\n--- Funded Accounts (${fundedAccounts.length}) ---`);
  for (const account of fundedAccounts) {
    logger.info(`  ${account.name}:`);
    logger.info(`    Unshielded (NIGHT): ${account.unshieldedAddr}`);
    logger.info(`    Shielded:           ${account.shieldedAddr}`);
    logger.info(`    DUST:               ${account.dustAddr}`);
    logger.info(`    NIGHT balance: ${account.nightBalance}`);
    logger.info(`    DUST balance:  ${account.dustBalance}`);
  }
}

async function mainMenu(
  masterWallet: WalletContext,
  config: StandaloneConfig,
  rli: Interface,
  logger: Logger,
): Promise<void> {
  const fundedAccounts: FundedAccount[] = [];

  while (true) {
    const choice = await rli.question(MENU);
    try {
      switch (choice.trim()) {
        case '1': {
          const configPath = await rli.question('Path to accounts JSON file (./accounts.json): ');
          const accounts = await fundFromConfigFile(masterWallet, configPath.trim() || './accounts.json', config);
          fundedAccounts.push(...accounts);
          break;
        }
        case '2': {
          const pubKeys = await rli.question('Enter Bech32 addresses (comma-separated): ');
          const accounts = await fundFromPublicKeys(masterWallet, pubKeys, config);
          fundedAccounts.push(...accounts);
          break;
        }
        case '3': {
          logger.info('\n--- Master Wallet ---');
          await displayWalletBalances(masterWallet, config);
          displayFundedAccounts(fundedAccounts, logger);
          break;
        }
        case '4': {
          logger.info('Exiting...');
          return;
        }
        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      if (e instanceof Error) {
        logger.error(`Operation failed: ${e.message}`);
        logger.debug(`${e.stack}`);
      } else {
        logger.error(`Operation failed: ${e}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const config = new StandaloneConfig();
  const logger = await createLogger(config.logDir);
  setWalletLogger(logger);
  setFundingLogger(logger);

  const rli = createInterface({ input, output, terminal: true });
  let env: StartedDockerComposeEnvironment | undefined;
  let masterWallet: WalletContext | null = null;

  try {
    // 1. Detect or start docker compose network
    if (isNetworkRunning()) {
      logger.info('Detected a running Midnight local network.');
      const startChoice = await rli.question(
        '\nA local dev network is already running:\n  [1] Use the existing network\n  [2] Stop containers, pull latest images, and restart\n> ',
      );
      if (startChoice.trim() === '2') {
        env = await freshStart(config, logger);
      } else {
        logger.info('Using existing network.');
      }
    } else {
      env = await startNetwork(config, logger);
    }

    // 2. Initialize master wallet from genesis seed
    logger.info('Initializing master wallet from genesis seed...');
    masterWallet = await buildWalletFromHexSeed(config, GENESIS_MINT_WALLET_SEED);

    // 3. Register DUST for master wallet
    logger.info('Registering DUST for master wallet...');
    await registerNightForDust(masterWallet);

    // 4. Show master wallet balances
    await displayWalletBalances(masterWallet, config);

    // 5. Interactive menu
    await mainMenu(masterWallet, config, rli, logger);
  } catch (e) {
    process.exitCode = 1;
    if (e instanceof Error) {
      logger.error(`Fatal error: ${e.message}`);
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logger.error(`Error closing readline interface: ${e}`);
    }
    try {
      if (masterWallet !== null) {
        await closeWallet(masterWallet);
      }
    } catch (e) {
      logger.error(`Error closing wallet: ${e}`);
    }
    try {
      if (env !== undefined) {
        await stopNetwork(env, logger);
      }
    } catch (e) {
      logger.error(`Error shutting down docker environment: ${e}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

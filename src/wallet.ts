import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { type DefaultConfiguration, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustAddress, MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { Buffer } from 'buffer';
import { type Config } from './config.js';

// @ts-expect-error: Needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

let logger: Logger;

export function setLogger(_logger: Logger): void {
  logger = _logger;
}

/**
 * Convert mnemonic phrase to seed buffer using BIP39 standard
 */
export const mnemonicToSeed = async (mnemonic: string): Promise<Buffer> => {
  const words = mnemonic.trim().split(/\s+/);
  if (!bip39.validateMnemonic(words.join(' '), english)) {
    throw new Error('Invalid mnemonic phrase');
  }
  const seed = await bip39.mnemonicToSeed(words.join(' '));
  return Buffer.from(seed);
};

/**
 * Initialize wallet with seed using the wallet SDK
 */
export const initWalletWithSeed = async (
  seed: Buffer,
  config: Config,
): Promise<WalletContext> => {
  const hdWallet = HDWallet.fromSeed(seed);

  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], config.networkId);

  const configuration: DefaultConfiguration = {
    networkId: config.networkId,
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, 'ws')),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  const facade: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        logger.info(`Waiting for wallet sync. Synced: ${state.isSynced}`);
      }),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const unshielded = state.unshielded?.balances[ledger.nativeToken().raw] ?? 0n;
        const shielded = state.shielded?.balances[ledger.nativeToken().raw] ?? 0n;
        logger.info(`Waiting for funds. Synced: ${state.isSynced}, Unshielded: ${unshielded}, Shielded: ${shielded}`);
      }),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => (s.unshielded?.balances[ledger.nativeToken().raw] ?? 0n) + (s.shielded?.balances[ledger.nativeToken().raw] ?? 0n)),
      Rx.filter((balance) => balance > 0n),
    ),
  );

/**
 * Display the three derived Midnight wallet types and their balances:
 * - Unshielded (NIGHT)
 * - Shielded
 * - DUST
 */
export interface WalletBalances {
  unshieldedAddr: string;
  shieldedAddr: string;
  dustAddr: string;
  unshielded: bigint;
  shielded: bigint;
  dust: bigint;
}

export const displayWalletBalances = async (walletContext: WalletContext, config: Config): Promise<WalletBalances> => {
  const state = await Rx.firstValueFrom(walletContext.wallet.state());
  const unshielded = state.unshielded?.balances[ledger.nativeToken().raw] ?? 0n;
  const shielded = state.shielded?.balances[ledger.nativeToken().raw] ?? 0n;
  const dust = state.dust?.balance(new Date()) ?? 0n;

  const unshieldedAddr = walletContext.unshieldedKeystore.getBech32Address().asString();
  const shieldedAddr = MidnightBech32m.encode(config.networkId, state.shielded.address).asString();
  const dustAddr = DustAddress.encodePublicKey(config.networkId, walletContext.dustSecretKey.publicKey);

  logger.info(`Unshielded (NIGHT): ${unshieldedAddr}`);
  logger.info(`Shielded:           ${shieldedAddr}`);
  logger.info(`DUST:               ${dustAddr}`);
  logger.info(`NIGHT balance: ${unshielded + shielded}`);
  logger.info(`DUST balance:  ${dust}`);

  return { unshieldedAddr, shieldedAddr, dustAddr, unshielded, shielded, dust };
};

/**
 * Register unshielded Night UTXOs for dust generation.
 * Required before the wallet can pay transaction fees.
 */
export const registerNightForDust = async (walletContext: WalletContext): Promise<boolean> => {
  const state = await Rx.firstValueFrom(walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  const unregisteredNightUtxos = state.unshielded?.availableCoins.filter(
    (coin) => coin.meta.registeredForDustGeneration === false
  ) ?? [];

  if (unregisteredNightUtxos.length === 0) {
    logger.info('No unshielded Night UTXOs available for dust registration, or all are already registered');

    const dustBalance = state.dust?.balance(new Date()) ?? 0n;
    logger.info(`Current dust balance: ${dustBalance}`);

    return dustBalance > 0n;
  }

  logger.info(`Found ${unregisteredNightUtxos.length} unshielded Night UTXOs not registered for dust generation`);
  logger.info('Registering Night UTXOs for dust generation...');

  try {
    const recipe = await walletContext.wallet.registerNightUtxosForDustGeneration(
      unregisteredNightUtxos,
      walletContext.unshieldedKeystore.getPublicKey(),
      (payload) => walletContext.unshieldedKeystore.signData(payload),
    );

    logger.info('Finalizing dust registration transaction...');
    const finalizedTx = await walletContext.wallet.finalizeRecipe(recipe);

    logger.info('Submitting dust registration transaction...');
    const txId = await walletContext.wallet.submitTransaction(finalizedTx);
    logger.info(`Dust registration submitted with tx id: ${txId}`);

    logger.info('Waiting for dust to be generated...');
    await Rx.firstValueFrom(
      walletContext.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.tap((s) => {
          const dustBalance = s.dust?.balance(new Date()) ?? 0n;
          logger.info(`Dust balance: ${dustBalance}`);
        }),
        Rx.filter((s) => (s.dust?.balance(new Date()) ?? 0n) > 0n),
      ),
    );

    logger.info('Dust registration complete!');
    return true;
  } catch (e) {
    logger.error(`Failed to register Night UTXOs for dust: ${e}`);
    return false;
  }
};

/**
 * Build wallet from hex seed (for genesis wallet)
 */
export const buildWalletFromHexSeed = async (
  config: Config,
  hexSeed: string,
): Promise<WalletContext> => {
  logger.info('Building wallet from hex seed...');
  const seed = Buffer.from(hexSeed, 'hex');
  const walletContext = await initWalletWithSeed(seed, config);

  logger.info(`Wallet address: ${walletContext.unshieldedKeystore.getBech32Address().asString()}`);

  logger.info('Waiting for wallet to sync...');
  await waitForSync(walletContext.wallet);

  const { unshielded, shielded } = await displayWalletBalances(walletContext, config);

  if (unshielded + shielded === 0n) {
    logger.info('Waiting to receive tokens...');
    await waitForFunds(walletContext.wallet);
    await displayWalletBalances(walletContext, config);
  }

  return walletContext;
};

/**
 * Build wallet from mnemonic and wait for funds
 */
export const buildWalletAndWaitForFunds = async (
  config: Config,
  mnemonic: string,
): Promise<WalletContext> => {
  logger.info('Building wallet from mnemonic...');

  const seed = await mnemonicToSeed(mnemonic);
  const walletContext = await initWalletWithSeed(seed, config);

  logger.info(`Wallet address: ${walletContext.unshieldedKeystore.getBech32Address().asString()}`);

  logger.info('Waiting for wallet to sync...');
  await waitForSync(walletContext.wallet);

  const { unshielded, shielded } = await displayWalletBalances(walletContext, config);

  if (unshielded + shielded === 0n) {
    logger.info('Waiting to receive tokens...');
    await waitForFunds(walletContext.wallet);
    await displayWalletBalances(walletContext, config);
  }

  return walletContext;
};

export const closeWallet = async (walletContext: WalletContext): Promise<void> => {
  try {
    await walletContext.wallet.stop();
  } catch (e) {
    logger.error(`Error closing wallet: ${e}`);
  }
};

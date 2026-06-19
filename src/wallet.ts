import {
  DustSecretKey,
  LedgerParameters,
  nativeToken,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  DustAddress,
  MidnightBech32m,
  WalletFacade,
  type FacadeState,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';
import {
  FluentWalletBuilder,
  type DustWalletOptions,
} from '@midnight-ntwrk/testkit-js';
import pino, { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { type Config } from './config.js';

// @ts-expect-error: Needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ZswapSecretKeys;
  dustSecretKey: DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

let logger: Logger = pino({ level: 'silent' });

export function setLogger(_logger: Logger): void {
  logger = _logger;
}

const DUST_OPTIONS: DustWalletOptions = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: 1_000n,
  feeBlocksMargin: 5,
};

/**
 * Build a wallet from a seed or mnemonic via the testkit FluentWalletBuilder.
 * The builder handles HD derivation and wires the WalletFacade against the
 * configured environment (indexer/node/proof-server).
 */
export const buildWallet = async (
  config: Config,
  secret: WalletSecret,
): Promise<WalletContext> => {
  const base = FluentWalletBuilder.forEnvironment(config.envConfig()).withDustOptions(DUST_OPTIONS);
  const builder = secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);

  const { wallet, seeds, keystore } = await builder.buildWithoutStarting();

  const shieldedSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  const dustSecretKey = DustSecretKey.fromSeed(seeds.dust);

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore: keystore };
};

function isStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') return false;
  const fn = (progress as { isStrictlyComplete?: unknown }).isStrictlyComplete;
  return typeof fn === 'function' && (fn as () => boolean).call(progress);
}

export const waitForSync = (wallet: WalletFacade, timeout = 300_000): Promise<FacadeState> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state) => {
        const shielded = isStrictlyComplete(state.shielded.state.progress);
        const unshielded = isStrictlyComplete(state.unshielded.progress);
        const dust = isStrictlyComplete(state.dust.state.progress);
        logger.info(`Wallet sync: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`);
      }),
      Rx.filter(
        (state) =>
          isStrictlyComplete(state.shielded.state.progress) &&
          isStrictlyComplete(state.unshielded.progress) &&
          isStrictlyComplete(state.dust.state.progress),
      ),
      Rx.timeout({
        each: timeout,
        with: () => Rx.throwError(() => new Error(`Wallet sync timeout after ${timeout}ms`)),
      }),
    ),
  );

export const waitForFunds = (wallet: WalletFacade, timeout = 300_000): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
        const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
        logger.info(`Waiting for funds. Unshielded: ${unshielded}, Shielded: ${shielded}`);
      }),
      Rx.map((s) => (s.unshielded?.balances[nativeToken().raw] ?? 0n) + (s.shielded?.balances[nativeToken().raw] ?? 0n)),
      Rx.filter((balance) => balance > 0n),
      Rx.timeout({
        each: timeout,
        with: () => Rx.throwError(() => new Error(`Wallet did not receive funds within ${timeout}ms`)),
      }),
    ),
  );

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
  const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
  const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
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
  const state = await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => isStrictlyComplete(s.unshielded.progress))),
  );

  const unregisteredNightUtxos = state.unshielded?.availableCoins.filter(
    (coin) => coin.meta.registeredForDustGeneration === false,
  ) ?? [];

  if (unregisteredNightUtxos.length === 0) {
    const dustBalance = state.dust?.balance(new Date()) ?? 0n;
    logger.info(`No NIGHT UTXOs need registration. Current DUST balance: ${dustBalance}`);
    return dustBalance > 0n;
  }

  logger.info(`Registering ${unregisteredNightUtxos.length} NIGHT UTXO(s) for DUST generation...`);
  const recipe = await walletContext.wallet.registerNightUtxosForDustGeneration(
    unregisteredNightUtxos,
    walletContext.unshieldedKeystore.getPublicKey(),
    (payload) => walletContext.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await walletContext.wallet.finalizeRecipe(recipe);
  const txId = await walletContext.wallet.submitTransaction(finalizedTx);
  logger.info(`DUST registration submitted: ${txId}`);

  logger.info('Waiting for DUST to be generated...');
  await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((s) => logger.info(`DUST balance: ${s.dust?.balance(new Date()) ?? 0n}`)),
      Rx.filter((s) => (s.dust?.balance(new Date()) ?? 0n) > 0n),
    ),
  );

  logger.info('DUST registration complete.');
  return true;
};

export const buildWalletFromHexSeed = async (config: Config, hexSeed: string): Promise<WalletContext> => {
  logger.info('Building wallet from hex seed...');
  const ctx = await buildWallet(config, { kind: 'seed', value: hexSeed });

  logger.info(`Wallet address: ${ctx.unshieldedKeystore.getBech32Address().asString()}`);

  logger.info('Waiting for wallet to sync...');
  await waitForSync(ctx.wallet);

  const { unshielded, shielded } = await displayWalletBalances(ctx, config);
  if (unshielded + shielded === 0n) {
    logger.info('Waiting to receive tokens...');
    await waitForFunds(ctx.wallet);
    await displayWalletBalances(ctx, config);
  }

  return ctx;
};

export const closeWallet = async (walletContext: WalletContext): Promise<void> => {
  try {
    await walletContext.wallet.stop();
  } catch (e) {
    logger.error(`Error closing wallet: ${e}`);
  }
};

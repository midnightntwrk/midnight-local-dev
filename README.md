# Midnight Local Network

A standalone tool for running a local Midnight development network and funding test accounts. It handles Docker container orchestration, genesis wallet initialization, NIGHT token transfers, and DUST registration — so your DApp projects can connect to a ready-to-use local blockchain without managing infrastructure themselves.

## Table of Contents

- [Midnight Local Network](#midnight-local-network)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [Headless / CI Usage](#headless--ci-usage)
    - [Useful scripts](#useful-scripts)
  - [Network Services](#network-services)
  - [Funding Options](#funding-options)
    - [Option 1: Fund from Config File (NIGHT + DUST)](#option-1-fund-from-config-file-night--dust)
    - [Option 2: Fund by Public Key (NIGHT Only)](#option-2-fund-by-public-key-night-only)
  - [Connecting Your DApp](#connecting-your-dapp)
    - [Example: ZKLoan Credit Scorer CLI](#example-zkloan-credit-scorer-cli)
    - [Example: Custom TypeScript DApp](#example-custom-typescript-dapp)
    - [Example: UI Development (React / Vite)](#example-ui-development-react--vite)
  - [Running the Network Standalone (Without the Funding CLI)](#running-the-network-standalone-without-the-funding-cli)
  - [Accounts Config File Format](#accounts-config-file-format)
  - [Environment Variables](#environment-variables)
  - [Architecture](#architecture)
    - [Startup Sequence](#startup-sequence)
    - [Key Concepts](#key-concepts)
  - [Troubleshooting](#troubleshooting)
    - [Port already in use](#port-already-in-use)
    - [Containers not starting](#containers-not-starting)
    - [Wallet sync takes too long](#wallet-sync-takes-too-long)
    - [`Insufficient Funds: could not balance dust` right after startup](#insufficient-funds-could-not-balance-dust-right-after-startup)
    - [DUST registration fails](#dust-registration-fails)
    - [Logs](#logs)

---

## Prerequisites

- **Node.js** >= 22.0.0
- **Docker** and **Docker Compose** (v2)

## Installation

```bash
cd midnight-local-dev
npm install
```

No further setup is needed. The first `npm start` creates `.env` from
`.env.example` automatically already filled in with working defaults and
checks your Node version and dependencies before it does anything else.

## Quick Start

```bash
npm start
```

This single command will:

1. **Detect** if a local Midnight network is already running
   - If running: prompt to **reuse** it or **restart** with fresh images
   - If not running: **pull** Docker images and **start** all containers
2. **Initialize** the genesis master wallet (seed `0x00...001`) which holds all minted NIGHT tokens
3. **Register DUST** for the master wallet (required to pay transaction fees)
4. **Display** the master wallet balance
5. **Present an interactive menu** for funding test accounts

If a network is already running, you'll first see:

```
A local dev network is already running:
  [1] Use the existing network
  [2] Stop containers, pull latest images, and restart
>
```

Then the main menu:

```
Choose an option:
  [1] Fund accounts from config file (NIGHT + DUST registration)
  [2] Fund accounts by public key (NIGHT transfer only)
  [3] Display master wallet balances
  [4] Exit
>
```

When you select `[4] Exit` or press `Ctrl+C`, the tool gracefully shuts down all wallets. Docker containers are only stopped if they were started by this session (reusing an existing network leaves containers running).

---

## Headless / CI Usage

`npm start` on its own is **interactive**: it presents a readline menu and waits
for input, so it will hang in any environment without a TTY.

Pass `--fund-config <path>` to run non-interactively instead. It is the only
headless entry point, and it does everything the menu's option 1 does:

```bash
cp accounts.example.json accounts.json
npm start -- --fund-config ./accounts.json
```

In this mode the tool will:

- reuse an already-running network instead of prompting to restart it,
- fund every account in the file with NIGHT and register DUST for each,
- print the funded account details, then tear the network down and exit.

Two constraints worth knowing:

- The config path must resolve **inside the project directory**. A file under a
  system temp directory is rejected, so write `accounts.json` into the repo root.
- Each account costs a full funding round-trip, so keep the file short in CI.

This is what [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs as its
devnet smoke test.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-check the project (`tsc --noEmit`). |
| `npm test` | Run the unit tests on Node's built-in test runner. |
| `npm run devnet:health` | Check all three containers are healthy and reachable from the host. Requires bash. |
| `npm run clean` | Stop and remove the devnet containers. |

## Network Services

The local network runs three Docker containers on fixed ports:

| Service | Container Name | Host Port | URL |
|---|---|---|---|
| **Midnight Node** | `midnight-node` | `9944` | `http://localhost:9944` |
| **Indexer** (GraphQL) | `midnight-indexer` | `8088` | `http://localhost:8088/api/v4/graphql` |
| **Indexer** (WebSocket) | `midnight-indexer` | `8088` | `ws://localhost:8088/api/v4/graphql/ws` |
| **Proof Server** | `midnight-proof-server` | `6300` | `http://localhost:6300` |

These ports match the defaults hardcoded by the **Lace wallet extension** when configured for the `undeployed` network type. This means Lace connects to the local network out of the box — no custom endpoint configuration required. Just select "Undeployed" in Lace's network settings and it will point to `localhost:9944`, `localhost:8088`, and `localhost:6300` automatically.

All services use the `undeployed` network ID with the `dev` node preset.

## Funding Options

Each funding operation transfers **50,000 NIGHT** (in smallest denomination: `50,000 * 10^6`) from the genesis master wallet. You can fund up to **10 accounts** per operation.

### Option 1: Fund from Config File (NIGHT + DUST)

Best for development setups where you control the test wallets. Provide a JSON file with BIP39 mnemonics. For each account, the tool will:

1. Derive a wallet from the mnemonic
2. Transfer 50,000 NIGHT from the master wallet
3. Wait for the recipient to see the funds
4. Register the recipient's NIGHT UTXOs for DUST generation
5. Wait for DUST to be available

After this, each account is **fully ready** to submit transactions (deploy contracts, call circuits, etc.) because they have both NIGHT (for value) and DUST (for fees).

```
> 1
Path to accounts JSON file: ./accounts.json
```

See [Accounts Config File Format](#accounts-config-file-format) for the JSON schema.

### Option 2: Fund by Public Key (NIGHT Only)

Best when you already have wallet addresses (e.g., from the Lace wallet or another DApp) and just need tokens. Provide one or more Bech32 addresses separated by commas.

```
> 2
Enter Bech32 addresses (comma-separated): mn1q..., mn1q...
```

Each address receives 50,000 NIGHT. **DUST is not registered** — recipients must register for DUST themselves before they can pay transaction fees.

---

## Connecting Your DApp

Once the network is running, any Midnight DApp can connect using the standard localhost endpoints. No special configuration needed.

### Example: ZKLoan Credit Scorer CLI

In a **separate terminal**, while the network is running:

```bash
cd ../zkloan-credit-scorer/zkloan-credit-scorer-cli
npm run standalone
```

The CLI's standalone mode connects to the same fixed ports (`9944`, `8088`, `6300`) without starting its own Docker containers.

### Example: Custom TypeScript DApp

```typescript
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

setNetworkId('undeployed');

const config = {
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  networkId: 'undeployed',
};

// Use these endpoints with the Midnight wallet SDK, contract deployment, etc.
```

### Example: UI Development (React / Vite)

Point your UI's environment variables to the local endpoints:

```env
VITE_INDEXER_URL=http://localhost:8088/api/v4/graphql
VITE_INDEXER_WS_URL=ws://localhost:8088/api/v4/graphql/ws
VITE_NODE_URL=http://localhost:9944
VITE_PROOF_SERVER_URL=http://localhost:6300
VITE_NETWORK_ID=undeployed
```

---

## Running the Network Standalone (Without the Funding CLI)

If you only need the Docker containers running (no wallet initialization or funding), you can use Docker Compose directly:

```bash
# Pull images and start all services
docker compose -f standalone.yml up -d

# Check service health
docker compose -f standalone.yml ps

# View logs
docker compose -f standalone.yml logs -f

# Stop everything
docker compose -f standalone.yml down
```

This is useful when:
- Your DApp handles its own wallet initialization
- You want to keep the network running across multiple test sessions
- You're debugging container-level issues

Note: In this mode you must handle genesis wallet funding and DUST registration yourself.

---

## Accounts Config File Format

Create a JSON file with the following structure:

```json
{
  "accounts": [
    {
      "name": "Alice",
      "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
    },
    {
      "name": "Bob",
      "mnemonic": "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `accounts` | `array` | List of accounts to fund (max 10) |
| `accounts[].name` | `string` | Display name for logging |
| `accounts[].mnemonic` | `string` | BIP39 mnemonic phrase (24 words) |

An example file is provided at `accounts.example.json`.

**Security note:** These mnemonics are for **local development only**. Never use real wallet mnemonics in config files.

---

## Environment Variables

`.env` is created from `.env.example` on your first `npm start`, so there is
nothing to copy by hand — it arrives populated with the values below, ready to
edit. An existing `.env` is never overwritten, and anything already set in your
shell takes precedence over it.

| Variable | Default | Description |
|---|---|---|
| `DEBUG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `MN_NODE_PORT` | `9944` | Host port the node is published on |
| `MN_INDEXER_PORT` | `8088` | Host port the indexer is published on |
| `MN_PROOF_SERVER_PORT` | `6300` | Host port the proof server is published on |
| `MN_NODE_URL` | `http://127.0.0.1:9944` | Node RPC endpoint the clients connect to |
| `MN_NODE_WS` | `ws://127.0.0.1:9944` | Node websocket endpoint |
| `MN_INDEXER_URL` | `http://127.0.0.1:8088/api/v4/graphql` | Indexer GraphQL endpoint |
| `MN_INDEXER_WS` | `ws://127.0.0.1:8088/api/v4/graphql/ws` | Indexer GraphQL subscription endpoint |
| `MN_PROOF_SERVER_URL` | `http://127.0.0.1:6300` | Proof server endpoint |

The `MN_*_PORT` values control what `docker compose` publishes; the URLs control
where the clients connect. Change both together when moving off the defaults.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              midnight-local-network              │
│                                                  │
│  src/index.ts     Entry point & interactive menu │
│  src/network.ts   Docker compose orchestration   │
│  src/wallet.ts    Wallet SDK operations          │
│  src/funding.ts   NIGHT transfer & DUST reg.     │
│  src/config.ts    Network endpoint config        │
│  src/logger.ts    Pino logger setup              │
└──────────┬──────────────────────────┬────────────┘
           │                          │
     testcontainers              Wallet SDK
           │                          │
           ▼                          ▼
┌──────────────────┐   ┌──────────────────────────┐
│  Docker Compose  │   │   Midnight Blockchain    │
│                  │   │                          │
│  ┌────────────┐  │   │  Genesis Wallet (master) │
│  │    Node    │◄─┼───┤  ├─ Transfer NIGHT       │
│  │   :9944    │  │   │  ├─ Register DUST        │
│  └────────────┘  │   │  └─ Fund recipients      │
│  ┌────────────┐  │   │                          │
│  │  Indexer   │  │   │  Recipient Wallets       │
│  │   :8088    │  │   │  ├─ From mnemonic        │
│  └────────────┘  │   │  └─ From Bech32 address  │
│  ┌────────────┐  │   └──────────────────────────┘
│  │   Proof    │  │
│  │  Server    │  │
│  │   :6300    │  │
│  └────────────┘  │
└──────────────────┘
```

### Startup Sequence

```
1. Network detection
   ├── Check if midnight-node, midnight-indexer, midnight-proof-server are running
   ├── If running → prompt: reuse existing or restart fresh
   └── If not running → docker compose up
       ├── midnight-node starts (waits for health: /health endpoint)
       ├── midnight-indexer starts (waits for: "starting indexing" log)
       └── midnight-proof-server starts (waits for: "Actix runtime found" log)

2. Master wallet initialization (WalletFacade.init)
   ├── Derive HD wallet from genesis seed (0x00...001)
   ├── Create unified DefaultConfiguration
   ├── Initialize WalletFacade with shielded, unshielded, and dust builders
   ├── Start wallet facade and wait for sync
   └── Display genesis NIGHT balance

3. DUST registration for master wallet
   ├── Find unregistered Night UTXOs
   ├── Submit registration transaction
   └── Wait for dust balance > 0

4. Interactive menu (fund accounts, check balances, exit)

5. Cleanup on exit
   ├── Close all wallet connections
   └── docker compose down (only if network was started by this session)
```

### Key Concepts

- **NIGHT**: The native token on Midnight. The genesis block mints a large supply accessible via the master wallet seed.
- **DUST**: Transaction fees on Midnight are paid in DUST, which is generated by registering NIGHT UTXOs. Without DUST registration, a wallet cannot submit transactions even if it holds NIGHT.
- **Master Wallet**: The genesis wallet (seed `0x00...001`) that holds all initially minted tokens. All funding transfers originate from this wallet.
- **Unshielded vs Shielded**: NIGHT can be held in unshielded (public) or shielded (private) form. This tool transfers unshielded NIGHT.

---

## Troubleshooting

### Port already in use

```
Error: Bind for 0.0.0.0:9944 failed: port is already allocated
```

Another process or a previous run is using the port. Stop it:

```bash
npm run clean
# or find and kill the process
lsof -i :9944
```

If the conflict is a second Midnight devnet you want to keep running, publish
this one elsewhere instead. Edit `.env` and change both the port and the URL
that goes with it:

```ini
MN_NODE_PORT=19944
MN_NODE_URL=http://127.0.0.1:19944
MN_NODE_WS=ws://127.0.0.1:19944
```

### Containers not starting

Check Docker is running and you have access to the Midnight Docker registry:

```bash
docker compose -f standalone.yml pull
docker compose -f standalone.yml up
```

Watch the logs for specific errors:

```bash
docker compose -f standalone.yml logs -f node
docker compose -f standalone.yml logs -f indexer
docker compose -f standalone.yml logs -f proof-server
```

### Wallet sync takes too long

The indexer needs time to catch up with the node after startup. If sync seems stuck:

1. Check the indexer logs: `docker compose -f standalone.yml logs -f indexer`
2. Verify the node is producing blocks: `curl http://localhost:9944/health`
3. Set `DEBUG_LEVEL=debug` in `.env` for more detailed wallet logs

### `Insufficient Funds: could not balance dust` right after startup

On a freshly started network the genesis wallet reports a full DUST balance and
several spendable coins within a second of the first block, but the transaction
balancer cannot cover a fee until the chain has advanced a little further.

Nothing in the wallet state distinguishes the two situations, so the funding code
simply retries the transfer until it succeeds (up to three minutes), logging
`DUST not spendable yet (attempt N)` while it waits. No action is needed — if you
see this scroll past once or twice, it is working as intended.

### DUST registration fails

DUST registration requires the wallet to have synced and found its NIGHT UTXOs. If it fails:

1. Ensure the wallet has a non-zero NIGHT balance
2. Check the proof server is healthy: `curl http://localhost:6300/version`
3. Try again — transient network issues during startup can cause one-time failures

### Logs

Logs are written to both the console and a timestamped file in the `logs/` directory:

```bash
ls logs/
# 2026-02-24T12:00:00.000Z.log
```

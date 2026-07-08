**Title**
`[Bug]: wallet-sdk-facade@4.1.0 fails to load — imports 'Clock' from wallet-sdk-utilities, which no stable release provides`

---

### Component
App/SDK — Wallet SDK (midnight-wallet)

### Network
Not applicable

### Severity
P3 Medium — Feature degraded, workaround available, non-critical bug. Response: 1 business day.

### First seen where?
Internal test / QA

### Bug Description
The published package `@midnight-ntwrk/wallet-sdk-facade@4.1.0` is broken on install. Its runtime code imports a named export `Clock` from `@midnight-ntwrk/wallet-sdk-utilities`, but no stable release of `wallet-sdk-utilities` provides that export — it only exists in the `1.2.1-canary.*` line. As a result, any project that resolves `wallet-sdk-facade@4.1.0` and value-imports from `@midnight-ntwrk/wallet-sdk` (or from any package that transitively loads facade) crashes at module load with a `SyntaxError`.

The root cause is a two-part packaging bug in the published `4.1.0`:

1. `dist/index.js:19` does `import { Clock } from '@midnight-ntwrk/wallet-sdk-utilities'`, but the `latest` dist-tag of `wallet-sdk-utilities` is `1.2.0`, which exports only `ArrayOps`, `BlobOps`, `DateOps`, `EitherOps`, `Fluent`, `HList`, `LedgerOps`, `ObservableOps`, `Poly`, `RecordOps`, `SafeBigInt`. `Clock` appears only in `1.2.1-canary.*` versions.
2. `package.json` lists `@midnight-ntwrk/wallet-sdk-utilities` under `devDependencies`, not `dependencies`. Because the constraint isn't enforced as a runtime dep, installers happily resolve `utilities@1.2.0` alongside `facade@4.1.0` with no warning.

`wallet-sdk-facade`'s `latest` dist-tag on npm is `4.0.1`, which works. But `wallet-sdk@1.2.0` transitively requires `wallet-sdk-facade@^4.1.0`, so any project pinning `wallet-sdk@1.2.0` pulls in the broken `4.1.0`.

### Expected Behavior
Installing `@midnight-ntwrk/wallet-sdk@1.2.0` into a fresh project and doing `import '@midnight-ntwrk/wallet-sdk'` should load without error. All named exports referenced by `wallet-sdk-facade`'s runtime code must be provided by whatever version of `wallet-sdk-utilities` the manifest allows to resolve.

### Actual Behavior
Module load fails with:

```
SyntaxError: The requested module '@midnight-ntwrk/wallet-sdk-utilities' does not provide an export named 'Clock'
```

### Steps to Reproduce
Minimal repro (any OS, Node ≥ 22):

```bash
mkdir /tmp/facade-repro && cd /tmp/facade-repro
npm init -y >/dev/null
npm pkg set type=module
npm install @midnight-ntwrk/wallet-sdk@1.2.0
node -e "import('@midnight-ntwrk/wallet-sdk').then(() => console.log('OK'))"
```

Observed on `node v24.16.0`, `npm 11.x`. Also reproduces with plain `import { WalletFacade } from '@midnight-ntwrk/wallet-sdk'` from a TS/ESM entry.

Verification of the underlying facts (all against the public npm registry):

```bash
# facade 4.1.0 imports Clock
npm view @midnight-ntwrk/wallet-sdk-facade@4.1.0 dist.tarball
curl -s "$(npm view @midnight-ntwrk/wallet-sdk-facade@4.1.0 dist.tarball)" | tar -xzO package/dist/index.js | sed -n '19p'
# → import { Clock } from '@midnight-ntwrk/wallet-sdk-utilities';

# facade 4.1.0 lists utilities in devDependencies, not dependencies
npm view @midnight-ntwrk/wallet-sdk-facade@4.1.0 devDependencies dependencies
# → devDependencies['@midnight-ntwrk/wallet-sdk-utilities'] = '^1.2.0'
# → dependencies does NOT contain wallet-sdk-utilities

# stable utilities does not export Clock
npm view @midnight-ntwrk/wallet-sdk-utilities dist-tags
# → latest: 1.2.0, canary: 1.2.1-canary.*
curl -s "$(npm view @midnight-ntwrk/wallet-sdk-utilities@1.2.0 dist.tarball)" | tar -xzO package/dist/index.js | grep '^export'
# → no Clock

# only the canary line exports Clock
curl -s "$(npm view @midnight-ntwrk/wallet-sdk-utilities@canary dist.tarball)" | tar -xzO package/dist/index.js | grep Clock
# → export * as Clock from './Clock.js';
```

### Logs and Error Messages
```
file:///.../node_modules/@midnight-ntwrk/wallet-sdk-facade/dist/index.js:19
import { Clock } from '@midnight-ntwrk/wallet-sdk-utilities';
         ^^^^^
SyntaxError: The requested module '@midnight-ntwrk/wallet-sdk-utilities' does not provide an export named 'Clock'
    at #asyncInstantiate (node:internal/modules/esm/module_job:327:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:431:5)
    at async ModuleLoader.executeModuleJob (node:internal/modules/esm/loader:227:20)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.16.0
```

### Operating System
Ubuntu 22.04 (WSL2 — Linux 6.6.87.2-microsoft-standard-WSL2, x86_64)

### Node Version (if applicable)
N/A (not midnight-node — Node.js runtime is v24.16.0)

### SDK Version (if applicable)
- `@midnight-ntwrk/wallet-sdk@1.2.0` (top-level pin)
- `@midnight-ntwrk/wallet-sdk-facade@4.1.0` (broken, resolved transitively)
- `@midnight-ntwrk/wallet-sdk-utilities@1.2.0` (does not export `Clock`)
- Also reproduces via `@midnight-ntwrk/testkit-js@4.1.1` when npm hoists facade to `4.1.0`.

### Compiler Version (if applicable)
N/A

### Build Environment
Native (cargo build / yarn build directly)

### Language Context
TypeScript / JavaScript

### Additional Context
Why some existing projects don't hit this even though they're on `wallet-sdk@1.2.0`:

- Projects that only use `import type` from `@midnight-ntwrk/wallet-sdk` never load facade at runtime (types are erased at compile time).
- Yarn-managed projects can end up with a nested `wallet-sdk-facade@4.0.1` under `testkit-js/node_modules/` (from the older `wallet-sdk@1.1.0` chain) that shadows the broken hoisted `4.1.0` for that entry point. npm's more aggressive deduplication points the same import at the broken `4.1.0`, so npm users see the failure sooner.

Suggested fixes (either alone unblocks consumers):

1. Republish `wallet-sdk-facade@4.1.1` that (a) moves `@midnight-ntwrk/wallet-sdk-utilities` from `devDependencies` into `dependencies`, and (b) either drops the `Clock` import until a stable `utilities` release ships it, or pins to a `wallet-sdk-utilities` version that does export `Clock`.
2. Cut a stable `@midnight-ntwrk/wallet-sdk-utilities@1.3.0` (or `1.2.1`) that exports `Clock`, and republish `wallet-sdk-facade` with a `dependencies` constraint pointing at it.

Also worth `npm deprecate @midnight-ntwrk/wallet-sdk-facade@4.1.0` so future installs don't resolve into it.

### Pre-submission Checklist
- [x] I have searched existing issues to ensure this is not a duplicate
- [x] I have provided enough information to reproduce the issue
- [x] This is not a security vulnerability
- [x] I am using a supported version of the software

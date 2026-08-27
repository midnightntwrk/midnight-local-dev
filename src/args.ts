/**
 * Command-line argument parsing.
 *
 * Kept out of `index.ts` so it can be imported by tests: `index.ts` invokes
 * `main()` at module scope, so importing it would start the whole application.
 */

/**
 * Read the `--fund-config <path>` flag, the only non-interactive entry point.
 *
 * @returns the path, or `null` when the flag is absent (interactive mode).
 * @throws if the flag is present without a following path.
 */
export function parseFundConfigArg(argv: readonly string[]): string | null {
  const idx = argv.indexOf('--fund-config');
  if (idx < 0) return null;
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--fund-config requires a path argument');
  }
  return value;
}

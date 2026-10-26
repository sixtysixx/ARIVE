/**
 * Single source of the reported server version. `tests/version.test.ts` asserts
 * that it matches `package.json` and the example config, so a release bump that
 * misses one of them fails CI instead of shipping three different versions.
 */
export const VERSION = "2.0.0";

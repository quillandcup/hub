/**
 * A uniform random integer in [0, max), from Web Crypto (`globalThis.crypto`, the same in Node and the browser).
 *
 * Used for ids. It replaces `randomInt` from `node:crypto` so that modules a client component can reach don't import a
 * Node built-in: the bundler would otherwise ship browser copies of Node's crypto and vm shims, and the vm one calls
 * eval(), which the Content-Security-Policy refuses (tests/lib/client-node-builtins.test.ts).
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError(`randomInt needs an integer from 1 to 2^32, got ${max}`);
  // Reject the top sliver of the 32-bit range so every value below `max` is equally likely.
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0]! >= limit);
  return buffer[0]! % max;
}

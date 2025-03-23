/* Converts ms to nanoseconds to work with LK Golang APIs */
export function msToNanosecondsBigInt(ms: number) {
  return BigInt(ms * 1_000_000);
}

/** Safely convert nanoseconds to ms */
export function nanosecondsBigIntToMs(nanoseconds: bigint) {
  if (!nanoseconds) {
    return 0;
  }

  const ms = Math.floor(Number(nanoseconds / BigInt(1_000_000)));

  if (ms > Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid ms value, too large");
  }

  return ms;
}

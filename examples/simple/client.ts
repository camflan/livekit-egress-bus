import { ensureError } from "@uplift-ltd/ts-helpers";

import { getLogger } from "@/helpers/logger.ts";
import { sleep } from "@/helpers/sleep.ts";

import { makeEgressClient } from "../shared/egress-client.js";
import { DEFAULT_TEST_URL } from "../shared/test-urls.js";

const logger = getLogger("simple-client");
logger.enableAll();

async function main() {
  const url = process.argv[2] || DEFAULT_TEST_URL;
  const client = makeEgressClient();

  logger.info("Sending StartEgress command to egress node…");
  const egress = await client.startEgress({
    sourceUrl: url,
    destinationUrls: [],
  });

  logger.info(`Egress started: ${egress.egressId}`);
  logger.info("Press Ctrl-C to stop egress");

  await new Promise((resolve) => process.on("SIGINT", resolve));

  logger.info("Sending StopEgress command…");
  try {
    await Promise.race([
      client.stopEgress(egress.egressId),
      rejectAfterMs(10_000),
    ]);
    logger.info("Egress stopped");
  } catch (err) {
    const error = ensureError(err);
    logger.error("Failed to stop egress gracefully:", error.message);
    logger.info("Forcing exit…");
  }

  process.exit(0);
}

main().catch(console.error);

async function rejectAfterMs(delayMs: number) {
  await sleep(delayMs);
  throw new Error("Time out");
}

import { getLogger } from "@/helpers/logger.ts";

import { makeEgressClient } from "./start-stop-shared.ts";

const logger = getLogger("start-egress");
logger.enableAll();

(async function main() {
  const client = makeEgressClient();
  logger.info("Client created");

  return await client.startEgress({
    sourceUrl:
      "https://videojs.github.io/autoplay-tests/videojs/attr/autoplay-playsinline.html",
    destinationUrls: [],
  });
})()
  .then(logger.info)
  .catch(logger.error)
  .finally(() => process.exit(0));

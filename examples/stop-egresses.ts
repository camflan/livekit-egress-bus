import { getLogger } from "@/helpers/logger.ts";

import { makeEgressClient } from "./start-stop-shared.ts";

const logger = getLogger("stop-egress");
logger.enableAll();

(async function main() {
  const client = makeEgressClient();
  logger.info("Client created");

  return await Promise.allSettled(
    ["EG_GPx7C6gkFg", "EG_ohmkfYoZdt"].map((egressId) => {
      return client.stopEgress(egressId);
    }),
  );
})()
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit(0));

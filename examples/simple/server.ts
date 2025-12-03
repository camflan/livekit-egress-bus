import { MessageBus } from "@/bus.ts";
import { getLogger } from "@/helpers/logger.ts";

import { createEgressServer } from "../shared/egress-server.js";
import { getValkeyClient } from "../shared/valkey.js";

const logger = getLogger("simple-server");
logger.enableAll();

function main() {
  const valkey = getValkeyClient({ lazyConnect: false });
  const bus = new MessageBus(valkey);
  const server = createEgressServer({ bus });

  logger.info("RPC server starting (listens for egress events)...");
  server.start(() => logger.info("RPC server ready"));
}

process.on("SIGINT", () => {
  logger.info("Shutting down...");
  process.exit(0);
});

main();

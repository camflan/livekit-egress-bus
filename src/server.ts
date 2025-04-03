import { ensureError } from "@uplift-ltd/ts-helpers";

import {
  EgressInfo,
  EgressStatus,
  ListEgressRequest,
  ListEgressResponse,
} from "./generated/livekit_egress";
import { Empty } from "./generated/google/protobuf/empty";
import { GetEgressRequest, UpdateMetricsRequest } from "./generated/rpc/io";
import { MessageBus } from "./bus";
import { ErrorCode, isLiveKitError } from "./errors";
import { getLogger } from "./helpers/logger";
import {
  listEgress,
  loadEgress,
  storeEgress,
  updateEgress,
} from "./redis-store";
import { RPCServer } from "./rpc-server";
import { getValkeyClient } from "./valkey";

const logger = getLogger("server");
let stopServer: (() => void) | undefined = undefined;

function exit(err?: string | Error) {
  stopServer?.();

  const error = err ? ensureError(err) : null;
  let exitCode = 0;

  if (error) {
    exitCode = 1;
    if (err !== "SIGINT") {
      logger.error(error);
    }
  }

  process.exit(exitCode);
}

process.once("SIGINT", function () {
  logger.debug("SIGINT received…");
  exit("SIGINT");
});

main();

function main() {
  try {
    const valkey = getValkeyClient({ lazyConnect: false });
    const bus = new MessageBus(valkey);

    const server = createServer({ bus });

    logger.info("Starting server…");
    server.start(() => logger.info("Server running"));
  } catch (err) {
    exit(ensureError(err));
  }
}

export function createServer({ bus }: { bus: MessageBus }) {
  const server = new RPCServer({ bus });
  stopServer = server.stop;

  registerIOHandlers(server);

  return server;
}

function registerIOHandlers(server: RPCServer) {
  server.registerHandler({
    async handlerFn(egressInfo) {
      const existingEgress = await loadEgress(egressInfo.egressId).catch(
        (err) => {
          const error = ensureError(err);
          if (isLiveKitError(error) && error.code === ErrorCode.NotFound) {
            return null;
          }

          throw error;
        },
      );
      if (existingEgress) {
        return Empty;
      }

      await storeEgress(egressInfo);
      // TODO: telemetry?

      return Empty;
    },

    rpc: "CreateEgress",
    requestMessageFns: EgressInfo,
    responseMessageFns: Empty,
    service: "IOInfo",
    topic: [],
  });

  server.registerHandler({
    async handlerFn(egressInfo) {
      await updateEgress(egressInfo);

      if (egressInfo.status === EgressStatus.EGRESS_FAILED) {
        logger.error(
          `Egress [${egressInfo.egressId}] failed: `,
          egressInfo.errorCode,
          egressInfo.error,
        );
      }

      // TODO: report telemetry?

      return Empty;
    },
    rpc: "UpdateEgress",
    requestMessageFns: EgressInfo,
    responseMessageFns: Empty,
    service: "IOInfo",
    topic: [],
  });

  server.registerHandler({
    async handlerFn(req) {
      return await loadEgress(req.egressId);
    },
    rpc: "GetEgress",
    requestMessageFns: GetEgressRequest,
    responseMessageFns: EgressInfo,
    service: "IOInfo",
    topic: [],
  });

  server.registerHandler({
    rpc: "ListEgress",
    service: "IOInfo",
    topic: [],
    requestMessageFns: ListEgressRequest,
    responseMessageFns: ListEgressResponse,
    async handlerFn(listRequest) {
      const egresses = await listEgress(
        listRequest.roomName,
        listRequest.active,
      );

      return {
        $type: "livekit.ListEgressResponse",
        items: egresses,
      };
    },
  });

  server.registerHandler({
    rpc: "UpdateMetrics",
    service: "IOInfo",
    topic: [],
    requestMessageFns: UpdateMetricsRequest,
    responseMessageFns: Empty,
    async handlerFn(metrics) {
      logger.info("received egress metrics", {
        egressId: metrics.info?.egressId,
        avgCpu: metrics.avgCpuUsage,
        maxCpu: metrics.maxCpuUsage,
      });

      return Empty;
    },
  });
}

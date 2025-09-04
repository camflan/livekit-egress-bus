import { ensureError } from "@uplift-ltd/ts-helpers";

import { MessageBus } from "@/bus.ts";
import { ErrorCode, isLiveKitError } from "@/helpers/errors.ts";
import { getLogger } from "@/helpers/logger.ts";
import {
  Empty,
  EgressInfo,
  EgressStatus,
  ListEgressRequest,
  ListEgressResponse,
  GetEgressRequest,
  UpdateMetricsRequest,
} from "@/protobufs.ts";
import { makeRedisStore } from "@/redis-store.ts";
import { RPCServer } from "@/rpc-server.ts";

import { getValkeyClient } from "./valkey.js";

const logger = getLogger("server");
logger.enableAll();

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
    const valkey = getValkeyClient({
      host: "127.0.0.1",
      port: 6379,
      lazyConnect: false,
    });
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
  const { loadEgress, updateEgress, listEgress, storeEgress } =
    makeRedisStore(getValkeyClient());

  server.registerHandler({
    async handlerFn(egressInfo) {
      logger.debug("CreateEgress", egressInfo);

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
      logger.debug("UpdateEgress", egressInfo);
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

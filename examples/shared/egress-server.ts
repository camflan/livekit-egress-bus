import { ensureError } from "@uplift-ltd/ts-helpers";

import { telemetry } from "@/telemetry.ts";
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
import { RPCServer } from "@/rpc-server.ts";

import { makeRedisStore } from "./redis-store.ts";
import { getValkeyClient } from "./valkey.ts";

const logger = getLogger("egress-server");

export function createEgressServer({ bus }: { bus: MessageBus }) {
  const server = new RPCServer({ bus });
  registerIOHandlers(server);
  return server;
}

telemetry.on("bus.message:received", trace("bus.message:received"));
telemetry.on("bus.message:dispatched", trace("bus.message:dispatched"));
telemetry.on("bus.subscriber:added", trace("bus.subscriber:added"));
telemetry.on("bus.subscriber:removed", trace("bus.subscriber:removed"));
telemetry.on("bus.queue:skip", trace("bus.queue:skip"));

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

function trace(tag: string) {
  return logger.info.bind(logger, tag);
}

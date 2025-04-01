import { getValkeyClient } from "./valkey";

import {
  EgressInfo,
  EncodingOptionsPreset,
  ListEgressRequest,
  ListEgressResponse,
} from "./generated/livekit_egress";
import { StartEgressRequest } from "./generated/rpc/egress";
import { formatID } from "./helpers/ids";
import { ensureError } from "@uplift-ltd/ts-helpers";
import { RPCClient } from "./rpc-client";
import { MessageBus } from "./bus";
import { getLogger } from "./helpers/logger";
import { RPCServer } from "./rpc-server";
import { Empty } from "./generated/google/protobuf/empty";
import {
  listEgress,
  loadEgress,
  storeEgress,
  updateEgress,
} from "./redis-store";
import { GetEgressRequest, UpdateMetricsRequest } from "./generated/rpc/io";
import { NotFoundError } from "./errors";

const logger = getLogger("cli");

const DEFAULT_EXPIRY_MS = 1_000 * 60 * 60; // 1 minute

const abort = new AbortController();

function exit(err?: string | Error) {
  const error = err ? ensureError(err) : null;
  let exitCode = 0;

  if (error) {
    exitCode = 1;
    logger.error(error);
  }

  abort.abort(error);
  process.exit(exitCode);
}

process.once("SIGINT", function () {
  logger.debug("SIGINT received…");
  exit("SIGINT");
});

main()
  .then(logger.debug)
  .catch(async (err) => {
    exit(await err);
  })
  .then(() => exit());

async function main() {
  const valkey = getValkeyClient({ lazyConnect: false });
  const bus = new MessageBus(valkey);

  const server = new RPCServer({
    abort,
    bus,
  });

  // TODO: pull out of here
  server.registerHandler({
    async handlerFn(egressInfo) {
      const existingEgress = await loadEgress(egressInfo.egressId);
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

  const serverPromise = server.start();

  const client = new RPCClient({
    abort,
    bus,
  });
  const egressId = formatID("EG_");

  logger.debug(`Calling server for egressId: ${egressId}`);
  const response = await client.requestSingle({
    msg: StartEgressRequest.create({
      egressId,
      web: {
        preset: EncodingOptionsPreset.H264_1080P_60,
        streamOutputs: [
          {
            urls: [
              "rtmps://12b43280e4c2.global-contribute.live-video.net:443/app/sk_us-east-1_Zyl6qUz90C1L_Kof1rfclunFfJ9UdhiaXv02zJ8ltDA",
            ],
          },
        ],
        url: "https://videojs.github.io/autoplay-tests/plain/attr/autoplay-playsinline.html",
      },
    }),
    requestMessageFns: StartEgressRequest,
    rpc: "StartEgress",
    service: "EgressInternal",
    topic: [],
    options: {
      timeoutMs: 500,
    },
  });

  logger.debug("RPC Response!", response);

  await serverPromise;
}

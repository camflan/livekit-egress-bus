import { getValkeyClient } from "./valkey";

import {
  EgressInfo,
  EncodingOptionsPreset,
  ListEgressRequest,
  ListEgressResponse,
  StopEgressRequest,
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
import { ErrorCode, isLiveKitError } from "./errors";

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

  registerIOHandlers(server);

  const serverPromise = server.start();

  const client = makeEgressClient(
    new RPCClient({
      abort,
      bus,
    }),
  );

  const response = await client.startEgress();

  logger.debug("RPC Response!", response);

  await serverPromise;
}

function makeEgressClient(client: RPCClient) {
  return {
    async startEgress() {
      const egressId = formatID("EG_");

      logger.debug(`Requesting StartEgress: ${egressId}`);
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
        // TODO: remove this duplicate requirement. Either take from msg or make msg JSON
        requestMessageFns: StartEgressRequest,
        rpc: "StartEgress",
        service: "EgressInternal",
        topic: [],
        options: {
          timeoutMs: 500,
        },
      });

      return response;
    },

    async stopEgress(egressId: string) {
      logger.debug("Requesting StopEgress");

      return await client.requestSingle({
        msg: StopEgressRequest.create({
          egressId,
        }),
        requestMessageFns: StopEgressRequest,
        options: {
          timeoutMs: 500,
        },
        topic: [],
        rpc: "StopEgress",
        service: "EgressInternal",
      });
    },
  };
}

function registerIOHandlers(server: RPCServer) {
  server.registerHandler({
    async handlerFn(egressInfo) {
      const existingEgress = await loadEgress(egressInfo.egressId).catch(
        (err) => {
          const error = ensureError(err);
          logger.debug("LOAD EGRESS", error);

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

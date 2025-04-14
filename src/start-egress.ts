import { MessageBus } from "./bus";
import { RPCClient } from "./rpc-client";
import { newEgressID } from "./helpers/ids";
import { getLogger } from "./helpers/logger";
import {
  EgressInfo,
  EncodingOptionsPreset,
  StopEgressRequest,
  StartEgressRequest,
} from "./protobufs.ts";
import { getValkeyClient } from "./valkey";

const DEFAULT_EXPIRY_MS = 500;
const logger = getLogger("run-egresses");
logger.enableAll();

(async function main() {
  const client = makeEgressClient();
  logger.info("Client created");

  const result = await client.startEgress({
    sourceUrl:
      "https://videojs.github.io/autoplay-tests/videojs/attr/autoplay-playsinline.html",
    destinationUrls: ["http://localhost:8000"],
  });

  logger.info("StartEgress", result);
})()
  .then(logger.info)
  .catch(logger.error);

type StartEgressOptions = {
  destinationUrls: string[];
  sourceUrl: string;
};

export function makeEgressClient() {
  const valkey = getValkeyClient({ lazyConnect: false });
  const bus = new MessageBus(valkey);

  const client = new RPCClient({
    bus,
  });

  logger.info("Client");

  return {
    async startEgress({ sourceUrl, destinationUrls }: StartEgressOptions) {
      const egressId = newEgressID();

      logger.debug(`Requesting StartEgress: ${egressId}`);
      const response = await client.requestSingle({
        msg: StartEgressRequest.create({
          egressId,
          web: {
            preset: EncodingOptionsPreset.H264_1080P_60,
            streamOutputs: [
              {
                urls: destinationUrls,
              },
            ],
            url: sourceUrl,
          },
        }),
        // TODO: remove this duplicate requirement. Either take from msg or make msg JSON
        requestMessageFns: StartEgressRequest,
        responseMessageFns: EgressInfo,
        service: "EgressInternal",
        rpc: "StartEgress",
        options: {
          timeoutMs: DEFAULT_EXPIRY_MS,
        },
      });

      return response;
    },

    async stopEgress(egressId: string) {
      logger.debug(`Requesting StopEgress: ${egressId}`);

      return await client.requestSingle({
        msg: StopEgressRequest.create({
          egressId,
        }),
        requestMessageFns: StopEgressRequest,
        responseMessageFns: EgressInfo,
        options: {
          timeoutMs: DEFAULT_EXPIRY_MS,
        },
        rpc: "StopEgress",
        service: "EgressInternal",
      });
    },
  };
}

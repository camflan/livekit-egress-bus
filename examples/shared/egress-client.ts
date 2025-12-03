import { MessageBus } from "@/bus.ts";
import { newEgressID } from "@/helpers/ids.ts";
import { getLogger } from "@/helpers/logger.ts";
import {
  EgressInfo,
  EncodingOptionsPreset,
  StopEgressRequest,
  StartEgressRequest,
} from "@/protobufs.ts";
import { RPCClient } from "@/rpc-client.ts";

import { getValkeyClient } from "./valkey.js";

const DEFAULT_TIMEOUT_MS = 500;
const logger = getLogger("egress-client");

export type StartEgressOptions = {
  destinationUrls: string[];
  sourceUrl: string;
};

export function makeEgressClient() {
  const valkey = getValkeyClient({
    lazyConnect: false,
  });
  valkey.ping();
  const bus = new MessageBus(valkey);

  const client = new RPCClient({
    bus,
  });

  logger.info("Client initialized");

  return {
    async startEgress({ sourceUrl, destinationUrls }: StartEgressOptions) {
      const egressId = newEgressID();

      logger.debug(`Requesting StartEgress: ${egressId}`);
      const response = await client.requestSingle({
        msg: StartEgressRequest.create({
          egressId,
          web: {
            preset: EncodingOptionsPreset.H264_1080P_60,
            fileOutputs: destinationUrls.length
              ? undefined
              : [
                  {
                    filepath: "/data/test.mp4",
                  },
                ],
            streamOutputs: destinationUrls.length
              ? [
                  {
                    urls: destinationUrls,
                  },
                ]
              : undefined,
            url: sourceUrl,
          },
        }),
        requestMessageFns: StartEgressRequest,
        responseMessageFns: EgressInfo,
        service: "EgressInternal",
        rpc: "StartEgress",
        options: {
          timeoutMs: DEFAULT_TIMEOUT_MS,
        },
      });
      console.log("🪵 response:", response);

      return response;
    },

    async stopEgress(egressId: string) {
      logger.debug(`Requesting StopEgress: ${egressId}`);

      const response = await client.requestSingle({
        msg: StopEgressRequest.create({
          egressId,
        }),
        requestMessageFns: StopEgressRequest,
        responseMessageFns: EgressInfo,
        options: {
          timeoutMs: DEFAULT_TIMEOUT_MS * 3,
        },
        rpc: "StopEgress",
        service: "EgressHandler",
        topic: [egressId],
      });
      console.log("🪵 response:", response);

      return response;
    },
  };
}

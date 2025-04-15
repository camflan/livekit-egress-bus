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

const DEFAULT_EXPIRY_MS = 500;
const logger = getLogger("shared");

export type StartEgressOptions = {
  destinationUrls: string[];
  sourceUrl: string;
};

export function makeEgressClient() {
  const valkey = getValkeyClient({
    host: "127.0.0.1",
    port: 6379,
    lazyConnect: false,
  });
  valkey.ping();
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
            fileOutputs: destinationUrls.length
              ? undefined
              : [
                  {
                    filepath: "/dev/null",
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
          selectionOptions: {
            affinityTimeout: DEFAULT_EXPIRY_MS * 10,
            acceptFirstAvailable: true,
          },
          timeoutMs: DEFAULT_EXPIRY_MS * 10,
        },
        rpc: "StopEgress",
        service: "EgressHandler",
        topic: [egressId],
      });
    },
  };
}

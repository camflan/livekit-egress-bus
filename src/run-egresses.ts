import { ensureError } from "@uplift-ltd/ts-helpers";
import {
  EgressInfo,
  EncodingOptionsPreset,
  StopEgressRequest,
} from "./generated/livekit_egress";
import { StartEgressRequest } from "./generated/rpc/egress";
import { formatID } from "./helpers/ids";
import { getLogger } from "./helpers/logger";
import { MessageBus } from "./services/bus";
import { RPCClient } from "./services/rpc-client";
import { getValkeyClient } from "./services/valkey";

const logger = getLogger("run-egresses");

const EGRESSES = new Map<string, EgressInfo>();

const DEFAULT_EXPIRY_MS = 500;

const valkey = getValkeyClient({ lazyConnect: false });
const bus = new MessageBus(valkey);

const client = makeEgressClient(
  new RPCClient({
    bus,
  }),
);

async function exit(err?: string | Error) {
  const error = err ? ensureError(err) : null;
  let exitCode = 0;

  for await (const egress of EGRESSES.values()) {
    logger.info(`Stopping ${egress.egressId}`);
    await client.stopEgress(egress.egressId);
  }

  if (error) {
    exitCode = 1;
    logger.error(error);
  }

  process.exit(exitCode);
}

process.once("SIGINT", async function () {
  logger.debug("SIGINT received");

  await exit("SIGINT");
});

main()
  .then(logger.debug)
  .catch(async (err) => {
    exit(await err);
  })
  .then(() => exit());

async function main() {
  const egresses: StartEgressOptions[] = [
    {
      destinationUrls: [
        "rtmps://12b43280e4c2.global-contribute.live-video.net:443/app/sk_us-east-1_cZl8JsBYryQy_dOQ9gF24MiErpeQUVj7r9CZM52Aau7",
      ],
      sourceUrl:
        "https://pauljadam.com/demos/autoplay-loop-muted-controls.html",
    },
    // {
    //   destinationUrls: [
    //     "rtmps://12b43280e4c2.global-contribute.live-video.net:443/app/sk_us-east-1_e9DkUxy7ZSC5_VniGqn67cIUdfFzLgpdlz8AsHfNVLG",
    //   ],
    //   sourceUrl: "https://soundcloud.com/sc-playlists/sets/lo-fi-chill-beats",
    // },
  ];

  for await (const config of egresses) {
    logger.info(`Starting egress for ${config.sourceUrl}`);
    const egress = await client.startEgress(config);
    logger.debug("RESPONSE", egress);
  }
}

type StartEgressOptions = {
  destinationUrls: string[];
  sourceUrl: string;
};

function makeEgressClient(client: RPCClient) {
  return {
    async startEgress({ sourceUrl, destinationUrls }: StartEgressOptions) {
      const egressId = formatID("EG_");

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
      logger.debug("Requesting StopEgress");

      return await client.requestSingle({
        msg: StopEgressRequest.create({
          egressId,
        }),
        requestMessageFns: StopEgressRequest,
        options: {
          timeoutMs: DEFAULT_EXPIRY_MS,
        },
        rpc: "StopEgress",
        service: "EgressInternal",
      });
    },
  };
}

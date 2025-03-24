import { getValkeyClient } from "./valkey";

import { EgressInfo, EncodingOptionsPreset } from "./generated/livekit_egress";
import { StartEgressRequest } from "./generated/rpc/egress";
import {
  ClaimRequest,
  ClaimResponse,
  Msg,
  Request,
  Response,
} from "./generated/internal";
import { formatID, newClientID, NewRequestID } from "./helpers/ids";
import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  startEgressRequestChannel,
} from "./helpers/channels";
import { decodeMsg, decodeProtobuf } from "./serdes";
import { parseMsgFromAllTypes } from "./helpers/parse-from-all";
import { ensureError } from "@uplift-ltd/ts-helpers";
import { loadEgress, storeEgress, updateEgress } from "./redis-store";
import { msToNanosecondsBigInt } from "./helpers/datetimes";
import { RPCClient } from "./rpc-client";
import { MessageBus } from "./bus";

const DEFAULT_EXPIRY_MS = 1_000 * 60 * 60; // 1 minute

const abort = new AbortController();

function exit(err?: string | Error) {
  const error = err ? ensureError(err) : null;
  let exitCode = 0;

  if (error) {
    exitCode = 1;
    console.error(error);
  }

  abort.abort(error);
  process.exit(exitCode);
}

process.once("SIGINT", function () {
  console.log("SIGINT received…");
  exit("SIGINT");
});

main()
  .then(console.log)
  .catch(async (err) => {
    exit(await err);
  })
  .then(() => exit());

async function main() {
  const valkey = getValkeyClient({ lazyConnect: false });
  const bus = new MessageBus(valkey);

  const client = new RPCClient({
    abort,
    bus,
  });
  const egressId = formatID("EG_");

  console.log(`Calling server for egressId: ${egressId}`);
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
    topic: [],
    options: {
      timeoutMs: 500,
    },
  });

  console.log("RPC Response!", response);
}

// STEPS
// 1. Create EgressID
// 2. Store Egress data to egress.egressID field
// 3. Start Egress
async function main2() {
  console.log("Starting…");
  // const valkey = getValkeyClient({});

  const clientId = newClientID();
  const egressId = formatID("EG_");

  handleIoInfoRequests();

  // 1. Send StartEgressRequest, wait for response from LK Egress workers
  const channel = startEgressRequestChannel;
  // Encode content for the Request, which gets wrapped into a Msg
  const req = Buffer.from(
    StartEgressRequest.encode(
      StartEgressRequest.create({
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
    ).finish(),
  );
  const encodedMsg = encodeRequestMsg(req, clientId);

  // Publish the Msg and wait for an Egress worker to respond with a ClaimRequest
  // Egress workers send an affinity. I think this can be used by our process to pick
  // which Egress worker gets it?
  //
  const decodedResponseMsg = await publishWithResponse(
    channel.Legacy,
    clientId,
    Buffer.from(encodedMsg),
  );

  if (decodedResponseMsg.$type !== "internal.ClaimRequest") {
    throw new Error("Unexpected response: " + decodedResponseMsg.$type);
  }

  console.log("file: index.ts~line: 57~decodedResponseMsg", decodedResponseMsg);

  // 2. After we get responses from the E workers, we'll pick one and publish that
  // RequestId + ServerId pair back to the channel
  const claimResponseResponse = await publishWithResponse(
    getClaimResponseChannel({
      topic: [],
      service: "EgressInternal",
      method: "StartEgress",
    }).Legacy,
    clientId,
    encodeClaimResponseMsg(
      decodedResponseMsg.requestId,
      decodedResponseMsg.serverId,
    ),
  );

  if (claimResponseResponse.$type !== "internal.Response") {
    throw new Error("Unexpected response: " + claimResponseResponse.$type);
  }

  console.log(claimResponseResponse);
  console.log(parseMsgFromAllTypes(claimResponseResponse.rawResponse));
}

// TODO: Replace with single listener and a req/res map?
async function publishWithResponse<
  T extends Request | Response | ClaimRequest | ClaimResponse,
>(channel: string, clientId: string, msg: Buffer) {
  const publisher = getValkeyClient({});
  const subscriber = getValkeyClient({});

  const responsePromise = new Promise<T>(async (resolve) => {
    subscriber.on("messageBuffer", (channel: Buffer, msg: Buffer) => {
      const msgString = msg.toString("utf-8");
      console.log(`[${channel.toString("utf-8")}]: ${msgString}`);

      subscriber.unsubscribe();
      resolve(decodeMsg(msg) as T);
    });

    const claimRequestChannel = getClaimRequestChannel(
      "EgressInternal",
      clientId,
    ).Legacy;

    await subscriber.subscribe(claimRequestChannel, (err, count) => {
      if (err) {
        console.error("ERR: ", err);
      } else {
        console.log(`Subscribed to ${count} channels`);
      }
    });
  });

  console.log(`Publishing msg to ${channel}`);
  await publisher.publish(channel, msg);

  return responsePromise;
}

function encodeRequestMsg(msg: Buffer, clientId: string) {
  const sentAt = Date.now();
  const request = Request.create({
    $type: "internal.Request",
    metadata: {},
    request: undefined,
    clientId,
    requestId: NewRequestID(),
    multi: false,
    sentAt: msToNanosecondsBigInt(sentAt),
    expiry: msToNanosecondsBigInt(sentAt + DEFAULT_EXPIRY_MS),
    rawRequest: msg,
  });
  const requestReq = Buffer.from(Request.encode(request).finish());

  return Buffer.from(
    Msg.encode(
      Msg.create({
        channel: "",
        // pull this type from the value's protobuf?
        typeUrl: `type.googleapis.com/${request.$type}`,
        value: requestReq,
      }),
    ).finish(),
  );
}

function encodeClaimResponseMsg(requestId: string, serverId: string) {
  const request = ClaimResponse.create({
    requestId,
    serverId,
  });
  const requestReq = Buffer.from(ClaimResponse.encode(request).finish());

  return Buffer.from(
    Msg.encode(
      Msg.create({
        channel: "",
        // pull this type from the value's protobuf?
        typeUrl: `type.googleapis.com/${request.$type}`,
        value: requestReq,
      }),
    ).finish(),
  );
}

function handleIoInfoRequests() {
  const sub = getValkeyClient({ lazyConnect: false });

  sub.on("pmessageBuffer", async (pattern, channel, msg) => {
    const channelName = channel.toString("utf-8");
    const [service, method, _topic] = channelName.split("|");
    if (service != "IOInfo") {
      console.warn(`Unknown pattern for msg: ${pattern}`);
      return;
    }

    console.info(`MSG recieved on ${channelName}`, msg.toString("utf-8"));

    const valkey = getValkeyClient({ lazyConnect: false });
    const decodedMsg = decodeMsg(msg);

    switch (method) {
      case "UpdateEgress": {
        const info =
          decodedMsg.$type === "internal.Request"
            ? decodeProtobuf(EgressInfo, decodedMsg.rawRequest)
            : null;

        if (!info) {
          console.warn("Unable to load EgressInfo from req");
          break;
        }

        await updateEgress(info, valkey);

        break;
      }
      case "CreateEgress": {
        const info =
          decodedMsg.$type === "internal.Request"
            ? decodeProtobuf(EgressInfo, decodedMsg.rawRequest)
            : null;

        if (!info) {
          console.warn("Unable to load EgressInfo from req");
          break;
        }

        const egress = await loadEgress(info?.egressId, valkey);

        if (!egress) {
          await storeEgress(info, valkey);
        }

        break;
      }
      default:
        console.warn(`Unhandled method: ${method}`);
    }
  });

  sub.psubscribe("IOInfo*", (err, count) => {
    if (err) {
      console.error(ensureError(err).message);
    } else {
      console.info(`Now subscribed to ${count} channels`);
    }
  });

  return async function () {
    console.info("Shutting down IOInfo handler…");
    await sub.punsubscribe();
  };
}

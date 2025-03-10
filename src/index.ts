import { getValkeyClient } from "./valkey";

import { EncodingOptionsPreset } from "./generated/livekit_egress";
import { StartEgressRequest } from "./generated/rpc/egress";
import {
  ClaimRequest,
  ClaimResponse,
  Msg,
  Request,
  Response,
} from "./generated/internal";
import { newClientID, NewRequestID } from "./helpers/ids";
import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  startEgressRequestChannel,
} from "./helpers/channels";
import { decodeMsg } from "./serdes";
import { MessageType, UnknownMessage } from "./generated/typeRegistry";
import { parseMsgFromAllTypes } from "./subscriber";

const DEFAULT_EXPIRY_MS = 1_000 * 60 * 60; // 1 minute

main()
  .then(console.log)
  .catch((err) => {
    console.error(err);

    process.exit(1);
  })
  .then(() => process.exit(0));

// STEPS
// 1. Create EgressID
// 2. Store Egress data to egress.egressID field
// 3. Start Egress
async function main() {
  console.log("Starting…");
  const valkey = getValkeyClient({});

  const config = {
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
  };

  const channel = startEgressRequestChannel;
  const req = Buffer.from(
    StartEgressRequest.encode(StartEgressRequest.create(config)).finish(),
  );
  const clientId = newClientID();
  const encodedMsg = encodeRequestMsg(req, clientId);

  const decodedResponseMsg = await publishWithResponse(
    channel,
    clientId,
    Buffer.from(encodedMsg),
  );

  if (decodedResponseMsg.$type !== "internal.ClaimRequest") {
    throw new Error("Unexpected response: " + decodedResponseMsg.$type);
  }

  console.log("file: index.ts~line: 57~decodedResponseMsg", decodedResponseMsg);

  const claimResponseResponse = await publishWithResponse(
    getClaimResponseChannel("EgressInternal", "StartEgress").Legacy,
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

function msToNanosecondsBigInt(ms: number) {
  return BigInt(ms * 1_000_000);
}

import {
  ClaimRequest,
  ClaimResponse,
  Msg,
  Request,
  Response,
  Stream,
  StreamOpen,
} from "./generated/internal";
import {
  GetEgressRequest,
  UpdateIngressStateRequest,
} from "./generated/rpc/io";
import { StartEgressRequest } from "./generated/rpc/egress";
import { getValkeyClient } from "./valkey";
import { startEgressRequestChannel } from "./helpers/channels";
import { decodeMsg, decodeProtobuf } from "./serdes";
import {
  EgressInfo,
  StopEgressRequest,
  StreamOutput,
  WebEgressRequest,
} from "./generated/livekit_egress";
import { KeepalivePing } from "./generated/rpc/keepalive";

const DEFAULT_PATTERNS = [
  // "Keepalive|Ping*",
  "*Egress*",
  "*IO*",
];

process.once("SIGINT", function () {
  console.log("SIGINT received…");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main(patterns = DEFAULT_PATTERNS) {
  const valkey = getValkeyClient({ name: "LK_test_subscriber" });
  console.info("Subscribing to patterns: ", patterns);

  // Using patterns, so we don't get these events
  // valkey.on("message", handleMessage);
  // valkey.on("messageBuffer", handleMessageBuffer);

  // Working with protobufs, so we'll listen to the raw buffers
  // valkey.on("pmessage", handlePMessage);
  valkey.on("pmessageBuffer", handlePMessageBuffer);

  valkey.on("error", (err) => {
    throw err;
  });

  valkey.psubscribe(...patterns, (err, count) => {
    if (err) {
      console.error("Failed to subscribe: ", err.message);
    } else {
      console.info(`Now subscribed to ${count} patterns.`);
    }
  });

  const pong = await valkey.ping();
  console.log("Pong: ", pong);
}

function handleMessage(channel: string, msg: string) {
  console.log(`message [${channel}]: ${msg}`);
}

function handleMessageBuffer(channelBuffer: Buffer, msgBuffer: Buffer) {
  const channel = channelBuffer.toString("utf-8");
  console.log(`messageBuffer [${channel}]: ${msgBuffer.toString("utf-8")}`);
}

function handlePMessage(pattern: string, channel: string, msg: string) {
  console.log(`pmessage (${pattern}) [${channel}]: ${msg}`);
}

function handlePMessageBuffer(
  pattern: string,
  channelBuffer: Buffer,
  msgBuffer: Buffer,
) {
  const channel = channelBuffer.toString("utf-8");
  console.group(`pmessagebuffer (${pattern}) [${channel}]`);

  const decodedRequest = decodeMsg(msgBuffer);
  console.log("file: subscriber.ts~line: 87~decodedRequest", decodedRequest);

  if (decodedRequest.$type === "internal.Request") {
    const decodedRequestRawRequest = decodeProtobuf(
      getMessageTypeForChannel(channel),
      decodedRequest.rawRequest,
    );

    console.log("DECODED VALUE: ", decodedRequestRawRequest);
  }

  if (decodedRequest.$type === "internal.Response") {
    console.log(
      `DECODED RAWRESPONSE [${decodedRequest.rawResponse.length}]: `,
      decodedRequest.rawResponse.toString("utf-8"),
    );
  }

  console.groupEnd();
}

function getMessageTypeForChannel(channel: string) {
  if (channel === startEgressRequestChannel.Legacy) {
    return StartEgressRequest;
  }

  if (channel.endsWith("CLAIM")) {
    return ClaimRequest;
  }

  throw new Error(`Unknown channel: ${channel}`);
}

const ALL_PROTOS = {
  ClaimRequest,
  ClaimResponse,
  EgressInfo,
  Msg,
  KeepalivePing,
  Request,
  Response,
  StartEgressRequest,
  StopEgressRequest,
  Stream,
  StreamOpen,
  StreamOutput,
  WebEgressRequest,
};

export function parseMsgFromAllTypes(msg: Buffer, type?: string) {
  const results = {};

  for (const [key, proto] of Object.entries(ALL_PROTOS)) {
    try {
      if (type && !type.includes(key)) {
        continue;
      }

      let decoded = proto.decode(msg);

      // if ("token" in decoded) {
      //   decoded.token = parseMsgFromAllTypes(
      //     typeof decoded.token === "string"
      //       ? Buffer.from(decoded.token)
      //       : decoded.token,
      //   );
      // }
      //
      // if ("value" in decoded && typeof decoded.value !== "string") {
      //   decoded.value = parseMsgFromAllTypes(decoded.value);
      // }
      //
      // if ("rawRequest" in decoded && typeof decoded.rawRequest !== "string") {
      //   decoded.rawRequestString = decoded.rawRequest.toString("utf-8");
      //   // decoded.rawRequest = parseMsgFromAllTypes(decoded.rawRequest);
      // }

      results[key] = decoded;
    } catch (err) {
      results[key] = err instanceof Error ? err.message : String(err);
    }
  }

  return results;
}

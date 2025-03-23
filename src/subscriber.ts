import { ClaimRequest } from "./generated/internal";
import { StartEgressRequest } from "./generated/rpc/egress";
import { getValkeyClient } from "./valkey";
import { startEgressRequestChannel } from "./helpers/channels";
import { decodeMsg, decodeProtobuf } from "./serdes";
import { decodeIOInfoMsg } from "./ioinfo-msg";
import { EgressInfo } from "./generated/livekit_egress";
import {
  EgressInfo as ProtocolEgressInfo,
  SIPParticipantInfo,
} from "@livekit/protocol";
import { typedIncludes } from "@uplift-ltd/ts-helpers";

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

// function handleMessage(channel: string, msg: string) {
//   console.log(`message [${channel}]: ${msg}`);
// }
//
// function handleMessageBuffer(channelBuffer: Buffer, msgBuffer: Buffer) {
//   const channel = channelBuffer.toString("utf-8");
//   console.log(`messageBuffer [${channel}]: ${msgBuffer.toString("utf-8")}`);
// }
//
// function handlePMessage(pattern: string, channel: string, msg: string) {
//   console.log(`pmessage (${pattern}) [${channel}]: ${msg}`);
// }

function handlePMessageBuffer(
  pattern: string,
  channelBuffer: Buffer,
  msgBuffer: Buffer,
) {
  const channel = channelBuffer.toString("utf-8");
  console.group(`pmessagebuffer (${pattern}) [${channel}]`);

  const decodedRequest = decodeMsg(msgBuffer);
  console.log("file: subscriber.ts~line: 87~decodedRequest", decodedRequest);

  const [service, method, _topic] = channel.split("|");

  if (decodedRequest.$type === "internal.Request") {
    try {
      if (
        service === "IOInfo" &&
        typedIncludes(["CreateEgress", "UpdateIngress"], method) &&
        "rawRequest" in decodedRequest &&
        decodedRequest.rawRequest
      ) {
        console.log(
          `@livekit/protocol decoding for ${method}: `,
          ProtocolEgressInfo.fromBinary(decodedRequest.rawRequest),
        );
      } else {
        console.log("Unable to decode using @livekit/protocol");
      }

      const decodedRequestRawRequest = decodeProtobuf(
        // @ts-expect-error
        getMessageTypeForChannel(channel),
        decodedRequest.rawRequest,
      );
      console.log("DECODED VALUE: ", decodedRequestRawRequest);
    } catch (err) {
      console.error(err);
    }
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

  const [service, method, _topic] = channel.split("|");
  if (service === "IOInfo") {
    switch (method) {
      case "UpdateEgress":
      case "CreateEgress":
        return EgressInfo;
    }
  }

  if (channel.endsWith("CLAIM")) {
    return ClaimRequest;
  }

  throw new Error(`Unknown channel: ${channel}`);
}

import { Msg } from "./generated/internal.proto";
import { StartEgressRequest } from "./generated/rpc/egress.proto";
import { getValkeyClient } from "./valkey";

process.once("SIGINT", function () {
  console.log("SIGINT received…");
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main(patterns = ["*Egress*"]) {
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
  // console.info(`raw msg: ${msgBuffer.toString("utf-8")}`);

  const { value, ...decoded } = Msg.decode(msgBuffer);
  console.log("decoded msg: ", { ...decoded, value: "DECODED BELOW" });
  console.log("");
  // console.log("decoded value: ", value.toString("utf-8"));
  // console.log("");
  const valueDecodedFromProtobuf = StartEgressRequest.decode(value);
  console.log("decoded as proto: ", valueDecodedFromProtobuf);
  console.log("");

  if ("token" in valueDecodedFromProtobuf) {
    console.log(
      "Token as buffer?: ",
      Buffer.from(valueDecodedFromProtobuf.token).toString("utf-8"),
    );
    console.log("");
  }

  console.groupEnd();
}

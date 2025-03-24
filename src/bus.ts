import Redis from "iovalkey";
import { getValkeyClient } from "./valkey";
import { messageTypeRegistry, UnknownMessage } from "./generated/typeRegistry";
import { Chan } from "ts-chan";
import { MessageFns, Msg } from "./generated/internal";
import { ensureError } from "@uplift-ltd/ts-helpers";

const GOOGLE_TYPEURL_PREFIX = "type.googleapis.com/";

export class MessageBus {
  #client: Redis;
  #subscriber: Redis;

  #subscriptions = new Map<
    string,
    // TODO: spell out possible types in Mapped Type?
    { channel: Chan<unknown>; msgFns: MessageFns<UnknownMessage, string> }
  >();

  constructor(valkey: Redis = getValkeyClient({ lazyConnect: true })) {
    this.#client = valkey;
    this.#subscriber = this.#client.duplicate();

    this.#subscriber.on(
      "messageBuffer",
      this.#handleMessageBuffer.bind(this),
      // (channelBuffer: Buffer, messageBuffer: Buffer) => {
      //   const channel = channelBuffer.toString("utf-8");
      //   const decodedMsg = Msg.decode(messageBuffer);
      //   const msgValueType = messageTypeRegistry.get(
      //     decodedMsg.typeUrl.slice(GOOGLE_TYPEURL_PREFIX.length),
      //   );
      //
      //   if (!msgValueType) {
      //     throw new Error(`Unsupported message type: ${decodedMsg.typeUrl}!`);
      //   }
      //
      //   const decodedValue = msgValueType.decode(decodedMsg.value);
      //
      //   try {
      //     const valueToDecode = getInnerValue(decodedValue);
      //     if (Buffer.isBuffer(valueToDecode)) {
      //       const decoded = messageFns.decode(valueToDecode);
      //       console.log("file: bus.ts~line: 65~decoded", decoded);
      //       msgChannel.trySend(decoded);
      //       return;
      //     }
      //
      //     msgChannel.trySend(decodedValue as T);
      //   } catch (err) {
      //     const error = ensureError(err);
      //     console.log("file: bus.ts~line: 64~error", error);
      //   }
      // },
    );
  }

  publish<T extends UnknownMessage>(channel: string, msg: T) {
    const msgType = messageTypeRegistry.get(msg.$type);
    // console.debug("PUBLISH", { channel, msgType });

    if (!msgType) {
      throw new Error(`Unsupported message type: ${msg.$type}!`);
    }

    return this.#client.publish(
      channel,
      Buffer.from(
        Msg.encode(
          Msg.create({
            channel: "",
            typeUrl: `${GOOGLE_TYPEURL_PREFIX}${msg.$type}`,
            value: Buffer.from(msgType.encode(msg).finish()),
          }),
        ).finish(),
      ),
    );
  }

  async #handleMessageBuffer(channelBuffer: Buffer, messageBuffer: Buffer) {
    const channel = channelBuffer.toString("utf-8");

    const channelData = this.#subscriptions.get(channel);

    if (!channelData) {
      console.error("No callback for channel", channel);
      return;
    }

    const decodedMsg = Msg.decode(messageBuffer);
    const msgValueType = messageTypeRegistry.get(
      decodedMsg.typeUrl.slice(GOOGLE_TYPEURL_PREFIX.length),
    );

    if (!msgValueType) {
      throw new Error(`Unsupported message type: ${decodedMsg.typeUrl}!`);
    }

    const decodedValue = msgValueType.decode(decodedMsg.value);

    try {
      const valueToDecode = getInnerValue(decodedValue);
      if (Buffer.isBuffer(valueToDecode)) {
        const decoded = channelData.msgFns.decode(valueToDecode);
        console.log("file: bus.ts~line: 65~decoded", decoded);
        channelData.channel.trySend(decoded);
        return;
      }

      channelData.channel.trySend(decodedValue);
    } catch (err) {
      const error = ensureError(err);
      console.log("file: bus.ts~line: 64~error", error);
    }
  }

  subscribe<T, V extends string>(
    channel: string,
    messageFns: MessageFns<T, V>,
  ) {
    let msgChannel: Chan<T>;
    const existingSubscription = this.#subscriptions.get(channel);

    if (!existingSubscription) {
      msgChannel = new Chan<T>(25);
      console.log("file: bus.ts~line: 45~msgChannel", channel, msgChannel);

      this.#subscriptions.set(channel, {
        // @ts-expect-error
        channel: msgChannel,
        // @ts-expect-error
        msgFns: messageFns,
      });

      // this.#subscriber.on(
      //   "messageBuffer",
      //   (channelBuffer: Buffer, messageBuffer: Buffer) => {
      //     const channel = channelBuffer.toString("utf-8");
      //     const decodedMsg = Msg.decode(messageBuffer);
      //     const msgValueType = messageTypeRegistry.get(
      //       decodedMsg.typeUrl.slice(GOOGLE_TYPEURL_PREFIX.length),
      //     );
      //
      //     if (!msgValueType) {
      //       throw new Error(`Unsupported message type: ${decodedMsg.typeUrl}!`);
      //     }
      //
      //     const decodedValue = msgValueType.decode(decodedMsg.value);
      //
      //     try {
      //       const valueToDecode = getInnerValue(decodedValue);
      //       if (Buffer.isBuffer(valueToDecode)) {
      //         const decoded = messageFns.decode(valueToDecode);
      //         console.log("file: bus.ts~line: 65~decoded", decoded);
      //         msgChannel.trySend(decoded);
      //         return;
      //       }
      //
      //       msgChannel.trySend(decodedValue as T);
      //     } catch (err) {
      //       const error = ensureError(err);
      //       console.log("file: bus.ts~line: 64~error", error);
      //     }
      //   },
      // );

      this.#subscriber.subscribe(channel, (err, count) => {
        if (err) {
          console.error(`Unable to subscribe to ${channel}`, err);
        } else {
          console.debug(
            `Now subscribed to [${channel}], total of ${count} channels`,
          );
        }
      });
    } else {
      msgChannel = existingSubscription.channel as Chan<T>;
    }

    return {
      close: () => {
        this.unsubscribe(channel);
        msgChannel.close();
      },
      channel,
      msgChannel,
    } as const;
  }

  unsubscribe(topic: string) {
    return this.#subscriber.unsubscribe(topic);
  }
}

function getInnerValue(msg: UnknownMessage) {
  if ("rawRequest" in msg) {
    return msg.rawRequest;
  }

  if ("rawResponse" in msg) {
    return msg.rawResponse;
  }

  if ("raw" in msg) {
    return msg.raw;
  }

  if ("value" in msg) {
    return msg.value;
  }

  if ("content" in msg) {
    return msg.content;
  }

  return null;
}

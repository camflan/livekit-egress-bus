import Redis from "iovalkey";
import { getValkeyClient } from "./valkey";
import { messageTypeRegistry, UnknownMessage } from "./generated/typeRegistry";
import { Chan } from "ts-chan";
import { MessageFns } from "./generated/internal";

export class MessageBus {
  #client: Redis;
  #subscriber: Redis;

  constructor(valkey: Redis = getValkeyClient({ lazyConnect: true })) {
    this.#client = valkey;
    this.#subscriber = this.#client.duplicate();
  }

  publish<T extends UnknownMessage>(channel: string, msg: T) {
    const msgType = messageTypeRegistry.get(msg.$type);

    if (!msgType) {
      throw new Error(`Unsupported message type: ${msg.$type}!`);
    }

    return this.#client.publish(
      channel,
      Buffer.from(msgType.encode(msg).finish()),
    );
  }

  subscribe<T, V extends string>(
    channel: string,
    messageFns: MessageFns<T, V>,
  ) {
    const msgChannel = new Chan<T>();

    this.#subscriber.on(
      "messageBuffer",
      (channelBuffer: Buffer, messageBuffer: Buffer) => {
        const channel = channelBuffer.toString("utf-8");
        const msg = messageBuffer.toString("utf-8");

        const decoded = messageFns.decode(messageBuffer);

        console.log(`handleMessageBuffer [${channel}]: ${msg}`, decoded);
      },
    );

    this.#subscriber.subscribe(channel, (err, count) => {
      if (err) {
        console.error(`Unable to subscribe to ${channel}`, err);
      } else {
        console.debug(`Now subscribed to ${count} channels`);
      }
    });

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

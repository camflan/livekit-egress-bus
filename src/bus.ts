import { ensureError } from "@uplift-ltd/ts-helpers";
import Redis from "iovalkey";
import { Chan } from "ts-chan";

import { getLogger } from "./helpers/logger";
import {
  Empty,
  MessageFns,
  Msg,
  messageTypeRegistry,
  UnknownMessage,
} from "./protobufs.ts";

const logger = getLogger("bus");

const GOOGLE_TYPEURL_PREFIX = "type.googleapis.com/";

export type MessageBusSubscription<T extends UnknownMessage = UnknownMessage> =
  {
    id: string;
    close: () => void;
    channel: string;
    msgChannel: Chan<T>;
    queue: boolean;
  };

type MessageBusSubscriptionList<
  T extends UnknownMessage = UnknownMessage,
  K extends string = string,
> = {
  msgFns: MessageFns<T, K>;
  subs: MessageBusSubscription<T>[];
  next: number;
};

const MessageBusSubscriptionListMap = Map<string, MessageBusSubscriptionList>;

export class MessageBus {
  #client: Redis;
  #subscriber: Redis;

  #queues = new MessageBusSubscriptionListMap();
  #subscriptions = new MessageBusSubscriptionListMap();

  constructor(valkey: Redis) {
    this.#client = valkey;
    this.#subscriber = this.#client.duplicate();

    this.#subscriber.on("messageBuffer", this.#handleMessageBuffer.bind(this));
  }

  publish<T extends UnknownMessage>(channel: string, msg: T) {
    const msgType = messageTypeRegistry.get(msg.$type);
    logger.trace("PUBLISH", { channel, msgType, msg });

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

  async #dispatch<T extends UnknownMessage>(
    subList: MessageBusSubscriptionList,
    payload: T,
  ) {
    const data = Buffer.isBuffer(payload)
      ? subList.msgFns.decode(payload)
      : payload;

    subList.subs.forEach((sub) => {
      sub.msgChannel.trySend(data);
    });
  }

  async #dispatchQueue<T extends UnknownMessage>(
    subList: MessageBusSubscriptionList,
    payload: T,
  ) {
    let next = subList.next;
    let sub = subList.subs.at(subList.next);

    if (!sub) {
      sub = subList.subs.at(0);
      next = 0;
    }

    const data = Buffer.isBuffer(payload)
      ? subList.msgFns.decode(payload)
      : payload;

    subList.next = next + 1;
    if (sub) {
      sub.msgChannel.trySend(data);
    } else {
      logger.warn("No sub?");
    }
  }

  async #handleMessageBuffer(channelBuffer: Buffer, messageBuffer: Buffer) {
    const channel = channelBuffer.toString("utf-8");

    const decodedMsg = Msg.decode(messageBuffer);
    logger.trace("#handleMessageBuffer:DECODED MSG", channel, decodedMsg);
    const msgValueType = messageTypeRegistry.get(
      decodedMsg.typeUrl.slice(GOOGLE_TYPEURL_PREFIX.length),
    );
    logger.trace(
      `#handleMessageBuffer: [${channel}] msgValueType`,
      msgValueType,
    );

    if (!msgValueType) {
      throw new Error(`Unsupported message type: ${decodedMsg.typeUrl}!`);
    }

    const payload = msgValueType.decode(decodedMsg.value) as UnknownMessage;

    try {
      const subList = this.#subscriptions.get(channel);
      if (subList) {
        this.#dispatch(subList, payload);
      }

      const queueSubList = this.#queues.get(channel);
      if (queueSubList) {
        this.#dispatchQueue(queueSubList, payload);
      }
    } catch (err) {
      const error = ensureError(err);
      logger.error("file: bus.ts~line: 64~error", error);
    }
  }

  // TODO: update bus subscriptions to support multiple bus topics => 1 msg channel
  subscribe<T extends UnknownMessage, V extends string>(
    channel: string,
    messageFns: MessageFns<T, V>,
    size = 25,
  ) {
    return this.#subscribe(
      channel,
      messageFns,
      this.#subscriptions,
      size,
      false,
    );
  }

  subscribeQueue<T extends UnknownMessage, V extends string>(
    channel: string,
    messageFns: MessageFns<T, V>,
    size = 25,
  ) {
    return this.#subscribe(channel, messageFns, this.#queues, size, true);
  }

  #subscribe<T extends UnknownMessage, V extends string>(
    channel: string,
    messageFns: MessageFns<T, V>,
    subLists: InstanceType<typeof MessageBusSubscriptionListMap>,
    size = 25,
    queue = false,
  ): MessageBusSubscription<T> {
    const msgChannel = new Chan<T>(size);

    const id = crypto.randomUUID();
    const newSubscription = {
      close: () => {
        this.unsubscribe(channel, queue, id);
        msgChannel.close();
      },
      channel,
      id,
      msgChannel,
      queue,
    } satisfies MessageBusSubscription<T>;

    let subList: MessageBusSubscriptionList<T, V>;

    if (!subLists.has(channel)) {
      subList = {
        msgFns: messageFns,
        next: 0,
        subs: [],
      } satisfies MessageBusSubscriptionList<T, V>;

      // @ts-expect-error: type doesn't fully match but its OK here
      subLists.set(channel, subList);

      this.#subscriber.subscribe(channel, (err, count) => {
        if (err) {
          logger.error(`Unable to subscribe to ${channel}`, err);
        } else {
          logger.debug(
            `Now subscribed to [${channel}], total of ${count} channels`,
          );
        }
      });
    } else {
      subList = subLists.get(channel) as unknown as MessageBusSubscriptionList<
        T,
        V
      >;
    }

    subList.subs.push(newSubscription);
    return newSubscription;
  }

  async unsubscribe(topic: string, queue: boolean, id: string) {
    const subList = queue
      ? this.#queues.get(topic)
      : this.#subscriptions.get(topic);

    if (!subList) {
      logger.warn("Nothing to unsubscribe");
      return;
    }

    subList.subs.filter((sub) => sub.id !== id);

    if (subList.subs.length < 1) {
      await this.#subscriber.unsubscribe(topic);
    }
  }

  emptySubscription<
    T extends UnknownMessage = Empty,
  >(): MessageBusSubscription<T> {
    return {
      channel: "",
      close: () => {
        /**/
      },
      id: crypto.randomUUID(),
      msgChannel: new Chan<T>(0),
      queue: false,
    };
  }
}

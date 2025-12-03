import { EventEmitter } from "events";

import { sleep } from "@/helpers/sleep";

type ListenerFn = (ch: Buffer, msg: Buffer) => void;

type RedisEventMap = {
  messageBuffer: Parameters<ListenerFn>;
  ready: [];
  close: [];
  error: [Error];
  reconnecting: [];
};

export class MockRedis extends EventEmitter {
  private subscriptions = new Map<string, Set<ListenerFn>>();
  private messageHandlers: Array<ListenerFn> = [];
  private connected = true;
  private latencyMs = 0;

  emit<K extends keyof RedisEventMap>(
    event: K,
    ...args: RedisEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof RedisEventMap>(
    event: K,
    listener: (...args: RedisEventMap[K]) => void,
  ): this {
    if (event === "messageBuffer") {
      this.messageHandlers.push(listener as ListenerFn);
    }
    return super.on(event, listener);
  }

  async publish(channel: string | Buffer, message: Buffer): Promise<number> {
    await this.delay();
    if (!this.connected) throw new Error("Connection lost");

    const channelStr =
      typeof channel === "string" ? channel : channel.toString("utf-8");

    const channelBuf = Buffer.from(channelStr);

    this.messageHandlers.forEach((handler) => {
      handler(channelBuf, message);
    });

    const subs = this.subscriptions.get(channelStr);
    return subs ? subs.size : 0;
  }

  subscribe(
    channel: string,
    callback?: (err: Error | null, count: number) => void,
  ): this {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    const count = this.subscriptions.size;
    if (callback) {
      callback(null, count);
    }
    return this;
  }

  unsubscribe(channel: string): Promise<void> {
    this.subscriptions.delete(channel);
    return Promise.resolve();
  }

  duplicate(): MockRedis {
    const dup = new MockRedis();
    dup.latencyMs = this.latencyMs;
    dup.connected = this.connected;
    dup.messageHandlers = this.messageHandlers;
    dup.subscriptions = this.subscriptions;
    return dup;
  }

  async ping(): Promise<string> {
    await this.delay();
    if (!this.connected) throw new Error("Connection lost");
    return "PONG";
  }

  simulateDisconnect() {
    this.connected = false;
    this.emit("close");
  }

  simulateReconnect() {
    this.connected = true;
    this.emit("ready");
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  private async delay() {
    if (this.latencyMs > 0) {
      await sleep(this.latencyMs);
    }
  }

  async quit(): Promise<string> {
    this.connected = false;
    return "OK";
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

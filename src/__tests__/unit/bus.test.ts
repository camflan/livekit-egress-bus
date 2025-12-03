import Redis from "iovalkey";
import { describe, it, expect, beforeEach } from "vitest";

import { MessageBus } from "@/bus.js";
import { Empty } from "@/protobufs.js";

import { sleep } from "../../../sleep.js";
import { MockRedis } from "../fixtures/redis-mock.js";
import { collectFromChannel } from "../fixtures/test-helpers.js";

describe("MessageBus", () => {
  let redis: MockRedis;
  let bus: MessageBus;

  beforeEach(() => {
    redis = new MockRedis();
    bus = new MessageBus(redis as unknown as Redis);
  });

  describe("subscription lifecycle", () => {
    it("should add subscription successfully", async () => {
      const sub = bus.subscribe("test-channel", Empty);

      expect(sub).toBeDefined();
      expect(sub.channel).toBe("test-channel");
      expect(sub.queue).toBe(false);
    });

    it("should add queue subscription successfully", async () => {
      const sub = bus.subscribeQueue("test-queue", Empty);

      expect(sub).toBeDefined();
      expect(sub.channel).toBe("test-queue");
      expect(sub.queue).toBe(true);
    });

    it("should remove subscription on unsubscribe", async () => {
      const sub1 = bus.subscribe("test-channel", Empty);
      const sub2 = bus.subscribe("test-channel", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(50);

      await bus.unsubscribe("test-channel", false, sub1.id);

      await bus.publish("test-channel", Empty.create());

      await sleep(50);

      expect(received1.length).toBe(0);
      expect(received2.length).toBe(1);

      sub1.close();
      sub2.close();
    });

    it("should remove queue subscription on unsubscribe", async () => {
      const sub1 = bus.subscribeQueue("test-queue", Empty);
      const sub2 = bus.subscribeQueue("test-queue", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(50);

      await bus.unsubscribe("test-queue", true, sub1.id);

      await bus.publish("test-queue", Empty.create());

      await sleep(50);

      // Queue delivery so only one gets it
      expect(received1.length + received2.length).toBe(1);
      // Sub1 was unsubscribed, so sub2 should get all messages
      expect(received2.length).toBe(1);
      expect(received1.length).toBe(0);

      sub1.close();
      sub2.close();
    });

    it("should handle multiple subscriptions correctly", async () => {
      const sub1 = bus.subscribe("test-channel", Empty);
      const sub2 = bus.subscribe("test-channel", Empty);
      const sub3 = bus.subscribe("test-channel", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);
      const received3 = collectFromChannel(sub3.msgChannel);

      await sleep(50);

      await bus.publish("test-channel", Empty.create());

      await sleep(50);

      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);
      expect(received3.length).toBe(1);

      sub1.close();
      sub2.close();
      sub3.close();
    });

    it("should clean up Redis subscription when last subscriber removed", async () => {
      const sub = bus.subscribe("test-channel", Empty);

      await bus.unsubscribe("test-channel", false, sub.id);

      // @ts-expect-error: We're digging into a private property of MockRedis for testing
      expect(redis.subscriptions.has("test-channel")).toBe(false);
    });
  });

  describe("queue delivery", () => {
    it("should deliver to one subscriber in queue mode", async () => {
      const sub1 = bus.subscribeQueue("test-queue", Empty);
      const sub2 = bus.subscribeQueue("test-queue", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(100);

      for (let i = 0; i < 10; i++) {
        await bus.publish("test-queue", Empty.create());
      }

      await sleep(100);

      expect(received1.length + received2.length).toBe(10);
      expect(received1.length).toBeGreaterThan(0);
      expect(received2.length).toBeGreaterThan(0);

      sub1.close();
      sub2.close();
    });

    it("should round-robin between subscribers", async () => {
      const sub1 = bus.subscribeQueue("test-queue", Empty);
      const sub2 = bus.subscribeQueue("test-queue", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(50);

      for (let i = 0; i < 4; i++) {
        await bus.publish("test-queue", Empty.create());
      }

      await sleep(100);

      expect(received1.length).toBe(2);
      expect(received2.length).toBe(2);

      sub1.close();
      sub2.close();
    });
  });

  describe("broadcast delivery", () => {
    it("should deliver to all subscribers", async () => {
      const sub1 = bus.subscribe("test-channel", Empty);
      const sub2 = bus.subscribe("test-channel", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(50);

      for (let i = 0; i < 5; i++) {
        await bus.publish("test-channel", Empty.create());
      }

      await sleep(100);

      expect(received1.length).toBe(5);
      expect(received2.length).toBe(5);

      sub1.close();
      sub2.close();
    });
  });

  describe("publish", () => {
    it("should publish successfully to subscribed channel", async () => {
      const sub1 = bus.subscribe("test-channel", Empty);
      const sub2 = bus.subscribe("test-channel", Empty);

      const received1 = collectFromChannel(sub1.msgChannel);
      const received2 = collectFromChannel(sub2.msgChannel);

      await sleep(50);

      await bus.publish("test-channel", Empty.create());

      await sleep(50);

      expect(received1.length + received2.length).toBe(2);

      sub1.close();
      sub2.close();
    });

    it("should return 0 for channel with no subscribers", async () => {
      const count = await bus.publish("no-subscribers", Empty.create());

      expect(count).toBe(0);
    });
  });
});

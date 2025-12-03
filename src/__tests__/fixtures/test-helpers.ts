import { Chan } from "ts-chan";

/**
 * Exhausts a channel and collects messages into an array
 * Useful for testing message delivery and verifying count/content
 */
export function collectFromChannel<T>(channel: Chan<T>): T[] {
  const collection: T[] = [];

  collect();

  return collection;

  async function collect() {
    for await (const msg of channel) {
      collection.push(msg);
    }
  }
}

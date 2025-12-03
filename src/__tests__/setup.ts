import log from "loglevel";
import { beforeAll, afterAll } from "vitest";

beforeAll(() => {
  if (!process.env.DEBUG) {
    log.disableAll();
  }
});

afterAll(() => {
  // Cleanup
});

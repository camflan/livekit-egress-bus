import { GenericLiveKitRpcError } from "@/helpers/errors";
import { Chan } from "ts-chan";

export type AbortChannel<T = Error> = {
  abort: (reason: GenericLiveKitRpcError | T) => void;
  channel: Chan<GenericLiveKitRpcError | T>;
  delayedAbort: (delayMs: number, timeoutReason?: string) => void;
  onAbort: (fn: (reason: GenericLiveKitRpcError | T) => void) => void;
};

export function makeAbortChannel<T = Error>(channelSize = 1) {
  const channel = new Chan<GenericLiveKitRpcError | T>(channelSize);

  const listeners: Array<{
    id: string;
    fn: (reason: GenericLiveKitRpcError | T) => void;
  }> = [];

  const abort = (reason: GenericLiveKitRpcError | T) => {
    channel.trySend(reason);
    listeners.forEach((listener) => {
      try {
        listener?.fn(reason);
      } catch (err) {
        //
      }
    });
  };

  return {
    abort,
    channel,
    /** Abort after a delay, useful for timeouts */
    delayedAbort(delayMs: number, timeoutReason: string = "timeout") {
      const timeout = AbortSignal.timeout(delayMs);

      timeout.onabort = () => {
        abort(new GenericLiveKitRpcError("deadline_exceeded", timeoutReason));
      };

      // cancel delayedAbort
      return () => {
        timeout.onabort = null;
      };
    },
    onAbort(fn: (reason: GenericLiveKitRpcError | T) => void) {
      const id = crypto.randomUUID();
      listeners.push({ id, fn });

      return () => {
        listeners.filter((listener) => listener.id !== id);
      };
    },
  } as const;
}

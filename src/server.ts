import { newClientID } from "./helpers/ids";
import { UnknownMessage } from "./generated/typeRegistry";
import { getRPCChannel, LivekitRequestInfo } from "./helpers/channels";
import { MessageBus } from "./bus";

export function createServer({ bus }: { bus: MessageBus }) {
  const clientId = newClientID();

  const claimRequests = new Map();
  const responseChannels = new Map();

  const handlers = {};

  return {
    async createRPCHandler(info: LivekitRequestInfo) {
      const requestSub = await bus.subscribe(getRPCChannel(info).Legacy);

      return async function () {};
    },
    async publish<T extends UnknownMessage>(
      rpc: string,
      topic: string[],
      msg: T,
    ) {
      return bus.publish<T>(
        getRPCChannel({
          method: "",
          service: rpc,
          topic,
        }).Legacy,
        msg,
      );
    },
  };
}

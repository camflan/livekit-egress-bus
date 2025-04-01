import { MessageBusSubscription, MessageBus } from "./bus";
import { Empty } from "./generated/google/protobuf/empty";
import {
  ClaimResponse as InternalClaimResponse,
  MessageFns,
  Request as InternalRequest,
} from "./generated/internal";
import { UnknownMessage } from "./generated/typeRegistry";
import {
  getClaimResponseChannel,
  getHandlerKey,
  getRPCChannel,
} from "./helpers/channels";
import { getLogger } from "./helpers/logger";
import { getInfo, RequestInfo, RPCKey, ServerRPCKey } from "./info";
import { getValkeyClient } from "./valkey";

const logger = getLogger("rpc.server");

type AffinityFunc<RequestType extends UnknownMessage, V extends string> = (
  req: MessageFns<RequestType, V>,
) => number;

type RPCHandler = {
  close(force: boolean): void;
};

export class RPCServer {
  #bus: MessageBus;
  #handlers = new Map<string, RPCHandlerImpl>();

  constructor({ bus, abort }: { bus: MessageBus; abort: AbortController }) {
    this.#bus = bus ?? getValkeyClient();
  }

  registerHandler<
    RequestType extends UnknownMessage,
    RequestTypeKey extends string,
    ResponseType extends UnknownMessage,
    ResponseTypeKey extends string,
  >({
    requestMessageFns,
    responseMessageFns,
    handlerFn,
    affinityFn,
  }: {
    rpc: ServerRPCKey;
    topic: string[];
    requestMessageFns: MessageFns<RequestType, ResponseTypeKey>;
    responseMessageFns: MessageFns<ResponseType, ResponseTypeKey>;
    handlerFn: (req: RequestType) => Promise<ResponseType>;
    affinityFn?: AffinityFunction<RequestType, RequestTypeKey>;
  }) {
    const info = getInfo("CreateEgress", []);
    const key = getHandlerKey(info);

    if (this.#handlers.has(key)) {
      throw new Error("Handler already registered");
    }

    const handler = this.newRPCHandler({
      info,
      handlerFn,
      affinityFn,
      requestMessageFns,
      responseMessageFns,
    });

    // TODO: Need to fix this type?
    // @ts-expect-error: Fix this?
    this.#handlers.set(key, handler);
  }

  newRPCHandler<
    RequestType extends UnknownMessage,
    RequestTypeKey extends string,
    ResponseType extends UnknownMessage,
    ResponseTypeKey extends string,
  >({
    affinityFn,
    info,
    handlerFn,
    requestMessageFns,
    responseMessageFns,
  }: {
    info: RequestInfo;
    requestMessageFns: MessageFns<RequestType, ResponseTypeKey>;
    responseMessageFns: MessageFns<ResponseType, ResponseTypeKey>;
    handlerFn: (req: RequestType) => Promise<ResponseType>;
    affinityFn?: AffinityFunction<RequestType, RequestTypeKey>;
  }): RPCHandlerImpl<RequestType, RequestTypeKey, ResponseType> {
    let requestSub: MessageBusSubscription<InternalRequest>;
    let claimSub:
      | MessageBusSubscription<InternalClaimResponse>
      | MessageBusSubscription<Empty>;

    if (info.queue) {
      requestSub = this.#bus.subscribeQueue(
        getRPCChannel(info).Legacy,
        InternalRequest,
      );
    } else {
      requestSub = this.#bus.subscribe(
        getRPCChannel(info).Legacy,
        InternalRequest,
      );
    }

    if (info.requireClaim) {
      claimSub = this.#bus.subscribe(
        getClaimResponseChannel(info).Legacy,
        InternalClaimResponse,
      );
    } else {
      claimSub = this.#bus.emptySubscription<InternalClaimResponse>();
    }

    return {
      affinityFn,
      handlerFn,
      info,
      claims: new Map<string, InternalClaimResponse>(),
      claimSub,
      requestSub,
    };
  }
}

type AffinityFunction<T extends UnknownMessage, K extends string> = (
  req: MessageFns<T, K>,
) => number;

type RPCHandlerImpl<
  RequestType extends UnknownMessage = UnknownMessage,
  RequestTypeKey extends string = string,
  ResponseType extends UnknownMessage = UnknownMessage,
> = {
  affinityFn?: AffinityFunction<RequestType, RequestTypeKey>;
  handlerFn: (req: RequestType) => Promise<ResponseType>;
  info: RequestInfo;
  requestSub: MessageBusSubscription<InternalRequest>;
  claimSub: MessageBusSubscription<InternalClaimResponse>;
  claims: Map<string, InternalClaimResponse>;
  // TODO: Do we need to implement these clean up functions?
  // handling
  // closeOnce
  // complete: Chan(1)
  // onCompleted: () => void;
};

import { ensureError } from "@uplift-ltd/ts-helpers";
import { MessageBusSubscription, MessageBus } from "./bus";
import { Empty } from "./generated/google/protobuf/empty";
import {
  ClaimRequest as InternalClaimRequest,
  ClaimResponse as InternalClaimResponse,
  MessageFns,
  Response as InternalResponse,
  Request as InternalRequest,
} from "./generated/internal";
import { UnknownMessage } from "./generated/typeRegistry";
import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  getHandlerKey,
  getResponseChannel,
  getRPCChannel,
} from "./helpers/channels";
import { getLogger } from "./helpers/logger";
import { getInfo, RequestInfo, ServerRPCKey, Service } from "./info";
import { getValkeyClient } from "./valkey";
import { Chan, recv, Select } from "ts-chan";
import {
  msToNanosecondsBigInt,
  nanosecondsBigIntToMs,
} from "./helpers/datetimes";
import { ErrorCode } from "./errors";
import { NewServerID } from "./helpers/ids";

const logger = getLogger("rpc.server");

type AffinityFunc<RequestType extends UnknownMessage> = (
  req: RequestType,
) => number;

export class RPCServer {
  #bus: MessageBus;
  #handlers = new Map<string, RPCHandlerImpl>();
  serverId: string;

  constructor({ bus, abort }: { bus: MessageBus; abort: AbortController }) {
    this.serverId = NewServerID();
    this.#bus = bus ?? getValkeyClient({ connectionName: this.serverId });
  }

  async start() {
    logger.info("Starting server…");

    try {
      return Promise.all(this.#handlers.values().map((fn) => fn.run()));
    } catch (err) {
      const error = ensureError(err);
      logger.error("ERROR: ", error);
      throw error;
    }
  }

  async stop() {
    logger.info("Shutting down…");
  }

  registerHandler<
    RequestType extends UnknownMessage,
    RequestTypeKey extends string,
    ResponseType extends UnknownMessage,
    ResponseTypeKey extends string,
  >({
    affinityFn,
    handlerFn,
    requestMessageFns,
    responseMessageFns,
    service,
    rpc,
    topic,
  }: Pick<
    RPCHandlerImpl<RequestType, ResponseType>,
    "affinityFn" | "handlerFn"
  > & {
    requestMessageFns: MessageFns<RequestType, RequestTypeKey>;
    responseMessageFns: MessageFns<ResponseType, ResponseTypeKey>;
    rpc: ServerRPCKey;
    service: Service;
    topic: string[];
  }) {
    const info = getInfo({ service, rpc, topic });
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
  }: Pick<
    RPCHandlerImpl<RequestType, ResponseType>,
    "affinityFn" | "handlerFn"
  > & {
    info: RequestInfo;
    requestMessageFns: MessageFns<RequestType, RequestTypeKey>;
    responseMessageFns: MessageFns<ResponseType, ResponseTypeKey>;
  }): RPCHandlerImpl<RequestType, ResponseType> {
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

    const claims = new Map<string, Chan<InternalClaimResponse>>();

    const claimRequest = async (req: InternalRequest) => {
      let affinity: number = 0;

      if (affinityFn) {
        affinity = affinityFn(req);

        if (affinity < 0) {
          return false;
        }
      } else {
        affinity = 1;
      }

      const claimResponseChan = new Chan<InternalClaimResponse>(1);
      claims.set(req.requestId, claimResponseChan);

      const close = () => {
        claims.delete(req.requestId);
        claimResponseChan.close();
      };

      await this.#bus.publish(
        getClaimRequestChannel(info.service, req.clientId).Legacy,
        InternalClaimRequest.create({
          affinity,
          requestId: req.requestId,
          serverId: this.serverId,
        }),
      );

      const defaultClaimTimeoutMs = 2_000;

      const timeout = AbortSignal.timeout(
        (req.expiry
          ? nanosecondsBigIntToMs(req.expiry)
          : defaultClaimTimeoutMs) - Date.now(),
      );
      const { value: claim } = await claimResponseChan.recv(timeout);

      const claimed = claim?.serverId === this.serverId;
      close();

      return claimed;
    };

    const sendResponse = async (
      req: InternalRequest,
      res: ResponseType | Error,
    ) => {
      const response = InternalResponse.create({
        requestId: req.requestId,
        sentAt: msToNanosecondsBigInt(Date.now()),
        serverId: this.serverId,
      });

      if (res instanceof Error) {
        response.error = res.message;
        // TODO: hook up proper error codes?
        response.code = ErrorCode.Unknown;
        response.errorDetails = [];
      } else if (!res) {
        const bytes = Buffer.from(
          responseMessageFns
            .encode(responseMessageFns.fromPartial(res))
            .finish(),
        );
        response.rawResponse = bytes;
      }

      return this.#bus.publish(
        getResponseChannel(info.service, req.clientId).Legacy,
        response,
      );
    };

    const handleRequest = async (req: InternalRequest) => {
      // TODO: headers?

      // TODO: gracefully handle this?
      // TODO: send error response when fails?
      const data = requestMessageFns.decode(req.rawRequest);

      if (info.requireClaim) {
        const claimed = await claimRequest(req);

        if (!claimed) {
          return;
        }
      }

      try {
        const response = await handlerFn(data);
        logger.trace("Sending response: ", response);

        return await sendResponse(req, response);
      } catch (err) {
        const error = ensureError(err);
        logger.error(error);
        return await sendResponse(req, error);
      }
    };

    const abortController = new AbortController();

    const stop = () => {
      abortController.abort();
      requestSub.close();
      claimSub.close();
    };

    return {
      affinityFn,
      claimSub,
      claims,
      handlerFn,
      info,
      requestSub,
      stop,
      async run() {
        logger.debug(`Running handler for: ${JSON.stringify(info.rpcInfo)}…`);
        const select = new Select([
          recv(requestSub.msgChannel),
          recv(claimSub.msgChannel),
        ]);

        while (true) {
          const resultIdx = await select.wait(abortController.signal);
          logger.trace("file: rpc-server.ts~line: 263~resultIdx", resultIdx);

          switch (resultIdx) {
            // request
            case 0:
              const request = select.recv(select.cases[resultIdx]).value;
              logger.trace("REQUEST", request);

              if (!request) {
                logger.trace("No request?", request);
                continue;
              }

              const nowNano = msToNanosecondsBigInt(Date.now());
              if (!request.expiry || nowNano < request.expiry) {
                handleRequest(request).catch((err) => {
                  const error = ensureError(err);
                  logger.error(error);
                  return;
                });
              }

              break;

            // claim
            case 1:
              const claim = select.recv(select.cases[resultIdx]).value;
              logger.trace("CLAIM", claim);
              if (!claim) continue;

              const claimChannel = claims.get(claim.requestId);
              if (claimChannel) {
                claimChannel.trySend(claim);
              }

              break;

            default:
              logger.warn(`Unsupported result: ${resultIdx}`);
              break;
          }
        }
      },
    };
  }
}

type RPCHandlerImpl<
  RequestType extends UnknownMessage = UnknownMessage,
  ResponseType extends UnknownMessage = UnknownMessage,
> = {
  affinityFn?: AffinityFunc<InternalRequest>;
  claimSub: MessageBusSubscription<InternalClaimResponse>;
  claims: Map<string, Chan<InternalClaimResponse>>;
  handlerFn: (req: RequestType) => Promise<ResponseType>;
  // Omit<ResponseType, "$type"> & Partial<Pick<ResponseType, "$type">>
  info: RequestInfo;
  requestSub: MessageBusSubscription<InternalRequest>;
  run: () => Promise<void>;
  stop: () => void;
  //
  //
  // TODO: Do we need to implement these clean up functions?
  // handling
  // closeOnce
  // complete: Chan(1)
  // onCompleted: () => void;
};

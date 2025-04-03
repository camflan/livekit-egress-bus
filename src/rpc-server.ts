import { ensureError } from "@uplift-ltd/ts-helpers";
import { setInterval } from "node:timers";
import { Chan, recv, Select } from "ts-chan";

import { MessageBusSubscription, MessageBus } from "./bus";
import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  getHandlerKey,
  getResponseChannel,
  getRPCChannel,
} from "./helpers/channels";
import {
  msToNanosecondsBigInt,
  nanosecondsBigIntToMs,
} from "./helpers/datetimes";
import { ErrorCode, isLiveKitError } from "./helpers/errors";
import { NewServerID } from "./helpers/ids";
import { getInfo, RequestInfo, ServerRPCKey, RPCService } from "./helpers/info";
import { getLogger } from "./helpers/logger";
import {
  Any,
  Empty,
  ClaimRequest as InternalClaimRequest,
  ClaimResponse as InternalClaimResponse,
  MessageFns,
  Response as InternalResponse,
  Request as InternalRequest,
  UnknownMessage,
} from "./protobufs.ts";
import { makeAbortChannel } from "./rpc-abort-channel";

const logger = getLogger("rpc.server");

type AffinityFunc<RequestType extends UnknownMessage> = (
  req: RequestType,
) => number;

type RPCHandlerImpl<
  RequestType extends UnknownMessage = UnknownMessage,
  ResponseType extends UnknownMessage = UnknownMessage,
> = {
  affinityFn?: AffinityFunc<InternalRequest>;
  claimSub: MessageBusSubscription<InternalClaimResponse>;
  claims: Map<string, Chan<InternalClaimResponse>>;
  handlerFn: (req: RequestType) => Promise<ResponseType>;
  info: RequestInfo;
  requestSub: MessageBusSubscription<InternalRequest>;
  run: () => () => void;
  stop: () => void;
  //
  //
  // TODO: Do we need to implement these clean up functions?
  // handling
  // closeOnce
  // complete: Chan(1)
  // onCompleted: () => void;
};

export class RPCServer {
  #bus: MessageBus;
  #handlers = new Map<string, RPCHandlerImpl>();
  #interval = setInterval(() => {
    /* noop */
  }, 1_000_000_000);
  serverId: string;

  constructor({
    // TODO: support global abort?
    // abort
    bus,
  }: {
    // abort: AbortController;
    bus: MessageBus;
  }) {
    this.serverId = NewServerID();
    this.#bus = bus;

    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
  }

  start(onSuccess?: () => void) {
    logger.info("Starting server…");

    try {
      // start all the handlers
      this.#handlers.values().forEach((fn) => fn.run());
      onSuccess?.();
    } catch (err) {
      const error = ensureError(err);
      logger.error("ERROR: ", error);
      throw error;
    }
  }

  stop() {
    logger.info("Shutting down…");
    clearInterval(this.#interval);
    this.#handlers.forEach((handler) => handler.stop());
    logger.info("done");
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
    topic = [],
  }: Pick<
    RPCHandlerImpl<RequestType, ResponseType>,
    "affinityFn" | "handlerFn"
  > & {
    requestMessageFns: MessageFns<RequestType, RequestTypeKey>;
    responseMessageFns: MessageFns<ResponseType, ResponseTypeKey>;
    rpc: ServerRPCKey;
    service: RPCService;
    topic?: string[];
  }) {
    const info = getInfo(service, rpc, topic);
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

    /** handle claim request/response cycle */
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

      /** close claims channel */
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

      const timeoutSignal = AbortSignal.timeout(
        (req.expiry
          ? nanosecondsBigIntToMs(req.expiry)
          : defaultClaimTimeoutMs) - Date.now(),
      );
      const { value: claim } = await claimResponseChan.recv(timeoutSignal);

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
        response.code = isLiveKitError(res) ? res.code : ErrorCode.Unknown;
        response.errorDetails = [
          ...response.errorDetails,
          Any.create({ value: Buffer.from(res.message) }),
        ];
      } else if (!res) {
        const rawResponse = Buffer.from(
          responseMessageFns.encode(responseMessageFns.create(res)).finish(),
        );
        response.rawResponse = rawResponse;
      }

      return this.#bus.publish(
        getResponseChannel(info.service, req.clientId).Legacy,
        response,
      );
    };

    const handleRequest = async (req: InternalRequest) => {
      try {
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

        const response = await handlerFn(data);
        logger.trace("Sending response: ", response);

        return await sendResponse(req, response);
      } catch (err) {
        const error = ensureError(err);
        logger.error(error);
        return await sendResponse(req, error);
      }
    };

    // holds promise so that the handler continues to run
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let _promise: Promise<void> | null = null;

    const runHandler = async () => {
      logger.debug(`Running handler for: ${JSON.stringify(info.rpcInfo)}…`);
      const select = new Select([
        recv(abortChannel.channel),
        recv(requestSub.msgChannel),
        recv(claimSub.msgChannel),
      ]);

      while (true) {
        const resultIdx = await select.wait();
        logger.trace("file: rpc-server.ts~line: 263~resultIdx", resultIdx);

        switch (resultIdx) {
          // abort
          case 0: {
            const abortReason = select.recv(select.cases[resultIdx]).value;
            if (!abortReason) break;
            throw abortReason;
          }

          // request
          case 1: {
            const request = select.recv(select.cases[resultIdx]).value;
            logger.trace("REQUEST", request);

            if (!request) {
              break;
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
          }

          // claim
          case 2: {
            const claim = select.recv(select.cases[resultIdx]).value;
            logger.trace("CLAIM", claim);
            if (!claim) continue;

            const claimChannel = claims.get(claim.requestId);
            if (claimChannel) {
              claimChannel.trySend(claim);
            }

            break;
          }

          default:
            logger.warn(`Unsupported result: ${resultIdx}`);
            break;
        }
      }
    };

    const abortChannel = makeAbortChannel();

    // TODO: Support draining/finish handling current request?
    const stop = () => {
      abortChannel.channel.close();
      requestSub.close();
      claimSub.close();
      _promise = null;
    };

    return {
      affinityFn,
      claimSub,
      claims,
      handlerFn,
      info,
      requestSub,
      stop,
      run() {
        _promise = runHandler();
        return stop;
      },
    };
  }
}

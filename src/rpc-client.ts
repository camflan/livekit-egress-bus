import { ensureError } from "@uplift-ltd/ts-helpers";
import { Chan, recv, Select } from "ts-chan";

import { MessageBus } from "./bus";
import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  getResponseChannel,
  getRPCChannel,
} from "./helpers/channels";
import { msToNanosecondsBigInt } from "./helpers/datetimes";
import { GenericLiveKitRpcError } from "./helpers/errors";
import { newClientID, newRequestID } from "./helpers/ids";
import { getInfo, ClientRPCService, ClientRPCForService } from "./helpers/info";
import { getLogger } from "./helpers/logger";
import {
  ClaimRequest as InternalClaimRequest,
  Response as InternalResponse,
  MessageFns,
  Request as InternalRequest,
  ClaimResponse as InternalClaimResponse,
} from "./protobufs.ts";
import { AbortChannel, makeAbortChannel } from "./rpc-abort-channel";

const logger = getLogger("rpc.client");

// copied from LK, converted to ms
const DefaultClientTimeoutMs = 3_000;
const DefaultAffinityTimeoutMs = 1_000;
const DefaultAffinityShortCircuitMs = 200;

type ClaimRequestChannel = Chan<InternalClaimRequest>;
type ResponseChannel = Chan<InternalResponse>;

export class RPCClient {
  #abortChannel: AbortChannel;
  #bus: MessageBus;
  #claimRequests = new Map<string, ClaimRequestChannel>();
  #clientID = newClientID();
  #responseChannels = new Map<string, ResponseChannel>();

  constructor({ bus }: { bus: MessageBus }) {
    this.#abortChannel = makeAbortChannel();
    this.#bus = bus;

    this.work();
  }

  async work() {
    try {
      // NOTE: This needs to subscribe to all client request services for Responses/ClaimRequests
      // TODO: update bus subscriptions to support multiple bus topics => 1 msg channel
      const [
        egressInternalResponses,
        egressHandlerResponses,
        egressInternalClaims,
        egressHandlerClaims,
      ] = await Promise.all([
        this.#bus.subscribe(
          getResponseChannel("EgressInternal", this.#clientID).Legacy,
          InternalResponse,
        ),
        this.#bus.subscribe(
          getResponseChannel("EgressHandler", this.#clientID).Legacy,
          InternalResponse,
        ),
        this.#bus.subscribe(
          getClaimRequestChannel("EgressInternal", this.#clientID).Legacy,
          InternalClaimRequest,
        ),
        this.#bus.subscribe(
          getClaimRequestChannel("EgressHandler", this.#clientID).Legacy,
          InternalClaimRequest,
        ),
      ]);

      const select = new Select([
        recv(this.#abortChannel.channel),
        recv(egressInternalResponses.msgChannel),
        recv(egressHandlerResponses.msgChannel),
        recv(egressInternalClaims.msgChannel),
        recv(egressHandlerClaims.msgChannel),
      ]);

      while (true) {
        const resultIdx = await select.wait();

        switch (resultIdx) {
          // Abort
          case 0: {
            const reason = select.recv(select.cases[resultIdx]).value;
            logger.debug("file: rpc-client.ts~line: 76~reason", reason);

            if (reason) {
              egressInternalResponses.close();
              egressInternalClaims.close();
            }
            break;
          }

          // responses
          case 1:
          case 2: {
            const res = select.recv(select.cases[resultIdx]).value;
            logger.debug("Response", res);

            if (!res) {
              this.close();
              continue;
            }

            const resChannel = this.#responseChannels.get(res.requestId);
            if (resChannel) {
              resChannel.send(res);
            }

            break;
          }

          // claims
          case 3:
          case 4: {
            const claim = select.recv(select.cases[resultIdx]).value;
            logger.debug("Claim", claim);

            if (!claim) {
              this.close();
              continue;
            }

            const claimChannel = this.#claimRequests.get(claim.requestId);
            if (claimChannel) {
              claimChannel.send(claim);
            }

            break;
          }

          default:
            throw new Error(`Unreachable [${resultIdx}]`);
        }
      }
    } catch (err) {
      const error = ensureError(err);
      logger.error("Error caught", error);
      throw err;
    }
  }

  close() {
    this.#abortChannel.channel.close();
  }

  async requestSingle<
    RequestMsg,
    ResponseMsg,
    RequestType extends string,
    ResponseType extends string,
    Service extends ClientRPCService,
  >({
    requestMessageFns,
    responseMessageFns,
    msg,
    rpc,
    service,
    topic = [],
    options: providedOptions,
  }: {
    service: Service;
    rpc: ClientRPCForService<Service>;
    topic?: string[];
    msg: RequestMsg;
    requestMessageFns: MessageFns<RequestMsg, RequestType>;
    responseMessageFns?: MessageFns<ResponseMsg, ResponseType>;
    options: RequestOptions;
  }) {
    const options = { ...DEFAULT_REQUEST_OPTIONS, ...providedOptions };
    const info = getInfo(service, rpc, topic);
    logger.debug("Request info: ", info);

    const requestId = newRequestID();
    const rawRequest = Buffer.from(requestMessageFns.encode(msg).finish());
    const now = Date.now();

    const req = InternalRequest.create({
      clientId: this.#clientID,
      requestId,
      sentAt: msToNanosecondsBigInt(now),
      expiry: msToNanosecondsBigInt(now + DefaultClientTimeoutMs),
      multi: false,
      rawRequest,
    });

    const claimChannel = new Chan<InternalClaimRequest>();
    const resChannel = new Chan<InternalResponse>(1);

    const close = () => {
      this.#claimRequests.delete(requestId);
      this.#responseChannels.delete(requestId);
      claimChannel.close();
      resChannel.close();
    };

    if (info.requireClaim) {
      this.#claimRequests.set(requestId, claimChannel);
    }

    this.#responseChannels.set(requestId, resChannel);

    const rpcChannel = getRPCChannel(info).Legacy;
    logger.debug("RpcChannel", rpcChannel);

    const result = await this.#bus.publish(rpcChannel, req).catch((err) => {
      if (err instanceof Error) {
        return err;
      }

      return new Error("Unknown error occurred", { cause: err });
    });

    logger.debug(
      "RPC publish result",
      typeof result === "number" ? { receivedBy: result } : result,
    );

    if (result instanceof Error) {
      close();
      throw result;
    }

    const abortChannel = makeAbortChannel();
    // abort if parent aborts
    this.#abortChannel.onAbort((reason) => abortChannel.abort(reason));

    // We have a deadline to make a server selection before we fail
    const cancelTimeout = abortChannel.delayedAbort(options.timeoutMs);

    if (info.requireClaim) {
      const response = await selectServer(
        claimChannel,
        resChannel,
        options.selectionOptions,
      );

      if (typeof response !== "string") {
        throw response;
      }

      const claimResChannel = getClaimResponseChannel(info).Legacy;

      await this.#bus.publish(
        claimResChannel,
        InternalClaimResponse.create({
          requestId,
          serverId: response,
        }),
      );
    }

    cancelTimeout();

    const select = new Select([recv(abortChannel.channel), recv(resChannel)]);

    while (true) {
      const resultIdx = await select.wait();

      switch (resultIdx) {
        // abort
        case 0: {
          const abort = select.recv(select.cases[resultIdx]).value;
          if (!abort) break;
          logger.trace("file: rpc-client.ts~line: 261~abort", abort);
          throw abort;
        }

        // responses
        case 1: {
          const res = select.recv(select.cases[resultIdx]).value;
          logger.trace("file: rpc-client.ts~line: 254~res", res);
          if (!res) break;

          if (res.rawResponse && responseMessageFns) {
            const response = responseMessageFns.decode(res.rawResponse);
            logger.debug("file: rpc-client.ts~line: 258~response", response);
            return response;
          }

          return res;
        }
      }
    }
  }
}

type Claim = {
  serverId: string;
  affinity: number;
};

type RequestOptions = {
  selectionOptions?: Partial<SelectionOptions>;
  timeoutMs: number;
};

type SelectionOptions = {
  /** server selection deadline */
  affinityTimeout?: number;

  /** if > 0, any server returning a max score will be selected immediately */
  maximumAffinity?: number;

  /** minimum affinity for a server to be considered a valid handler */
  minimumAffinity?: number;

  /** deadline imposed after receiving first response */
  shortCircuitTimeout?: number;

  /** go fast */
  acceptFirstAvailable?: boolean;

  /**
   * @returns {string} selectedServerId
   */
  selectionFunction?: (claims: Claim[]) => string;
};

const DEFAULT_REQUEST_OPTIONS = {
  timeoutMs: DefaultClientTimeoutMs,
} satisfies RequestOptions;

const DEFAULT_SELECTION_OPTIONS = {
  acceptFirstAvailable: false,
  affinityTimeout: DefaultAffinityTimeoutMs,
  minimumAffinity: 0,
  maximumAffinity: 1,
  shortCircuitTimeout: DefaultAffinityShortCircuitMs,
} satisfies SelectionOptions;

async function selectServer(
  claimChannel: ClaimRequestChannel,
  resChannel: ResponseChannel,
  opts: Partial<SelectionOptions> = {},
) {
  const localAbortChannel = makeAbortChannel();

  const {
    acceptFirstAvailable,
    affinityTimeout,
    maximumAffinity,
    minimumAffinity,
    shortCircuitTimeout,
    selectionFunction,
  } = { ...DEFAULT_SELECTION_OPTIONS, ...opts };

  const claims: Claim[] = [];
  let claimCount = 0;

  // track selected/best server so far
  let affinity = 0;
  let serverId = "";

  let resError: Error | undefined = undefined;
  let shorted = false;

  const select = new Select([
    recv(localAbortChannel.channel),
    recv(claimChannel),
    recv(resChannel),
  ]);

  // force selection after timeout
  localAbortChannel.delayedAbort(affinityTimeout);

  while (true) {
    const resultIdx = await select.wait();

    switch (resultIdx) {
      // abort
      case 0: {
        const abortReason = select.recv(select.cases[resultIdx]).value;
        logger.debug("Abort reason", {
          abortReason,
          claims,
          resError,
          serverId,
        });

        if (selectionFunction) {
          return selectionFunction(claims);
        }

        if (serverId) {
          return serverId;
        }

        if (resError) {
          return resError;
        }

        if (claimCount > 0) {
          return new GenericLiveKitRpcError(
            "unavailable",
            `No servers available (recieved ${claimCount} responses)`,
          );
        }

        return "";
      }

      // claims
      case 1: {
        const claim = select.recv(select.cases[resultIdx]).value;
        logger.debug("Claim", claim);

        if (!claim) break;
        claimCount += 1;

        if (
          (minimumAffinity > 0 && claim.affinity >= minimumAffinity) ||
          minimumAffinity <= 0
        ) {
          if (
            acceptFirstAvailable ||
            (maximumAffinity > 0 && claim.affinity >= maximumAffinity)
          ) {
            return claim.serverId;
          }

          if (selectionFunction) {
            claims.push({ affinity: claim.affinity, serverId: claim.serverId });
          } else if (claim.affinity > affinity) {
            serverId = claim.serverId;
            affinity = claim.affinity;
          }

          if (shortCircuitTimeout > 0 && !shorted) {
            shorted = true;
            // if we haven't returned in this window,
            // then the abort handler will be called
            localAbortChannel.delayedAbort(shortCircuitTimeout);
          }
        }
        break;
      }

      // responses
      case 2: {
        // will only happen with malformed requests
        const response = select.recv(select.cases[resultIdx]).value;
        logger.debug("Response", response);
        resError = new GenericLiveKitRpcError(
          "malformed_result",
          "Invalid response",
          { cause: response },
        );
        break;
      }
    }
  }
}

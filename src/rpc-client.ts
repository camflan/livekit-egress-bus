import {
  getClaimRequestChannel,
  getClaimResponseChannel,
  getResponseChannel,
  getRPCChannel,
} from "./helpers/channels";
import { newClientID, NewRequestID } from "./helpers/ids";
import { msToNanosecondsBigInt } from "./helpers/datetimes";
import { MessageBus } from "./bus";
import { Chan, recv, Select } from "ts-chan";
import {
  ClaimRequest as InternalClaimRequest,
  Response as InternalResponse,
  MessageFns,
  Request as InternalRequest,
  ClaimResponse as InternalClaimResponse,
} from "./generated/internal";
import { getInfo, RPCKey } from "./info";
import { ensureError } from "@uplift-ltd/ts-helpers";

// copied from LK, converted to ms
const DefaultClientTimeoutMs = 3 * 1000;
const DefaultAffinityTimeoutMs = 1000;
const DefaultAffinityShortCircuitMs = 200;

type ClaimRequestChannel = Chan<InternalClaimRequest>;
type ResponseChannel = Chan<InternalResponse>;

export class RPCClient {
  #abortController: AbortController;
  #abortChannel: Chan<string>;
  #bus: MessageBus;
  #claimRequests = new Map<string, ClaimRequestChannel>();
  #clientID = newClientID();
  #responseChannels = new Map<string, ResponseChannel>();

  constructor({ bus, abort }: { bus: MessageBus; abort: AbortController }) {
    // this.#abortController = abort;
    this.#abortController = new AbortController();
    this.#abortChannel = new Chan<string>(1);

    // const { channel } = makeAbortChannel(this.#abortController);
    // const { channel } = makeAbortChannel();

    // this.#abortChannel = channel;
    this.#bus = bus;

    this.work();
  }

  async work() {
    console.debug("Starting work");
    try {
      const responses = this.#bus.subscribe(
        getResponseChannel("EgressInternal", this.#clientID).Legacy,
        InternalResponse,
      );
      const claims = this.#bus.subscribe(
        getClaimRequestChannel("EgressInternal", this.#clientID).Legacy,
        InternalClaimRequest,
      );

      responses.msgChannel.addReceiver((msg, done) => {
        console.debug("RESPONSES", { msg, done });
      });

      claims.msgChannel.addReceiver((msg, done) => {
        console.debug("CLAIMS", { msg, done });
      });

      const select = new Select([
        recv(this.#abortChannel),
        recv(responses.msgChannel),
        recv(claims.msgChannel),
      ]);

      while (true) {
        const resultIdx = await select.wait(/* this.#abortController.signal */);

        switch (resultIdx) {
          // Abort
          case 0: {
            const reason = select.recv(select.cases[resultIdx]).value;
            console.log("file: rpc-client.ts~line: 76~reason", reason);

            if (reason) {
              responses.close();
              claims.close();
            }
            break;
          }

          // responses
          case 1: {
            const res = select.recv(select.cases[resultIdx]).value;
            console.log("file: rpc-client.ts~line: 88~res", res);

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
          case 2: {
            const claim = select.recv(select.cases[resultIdx]).value;
            console.log("file: rpc-client.ts~line: 106~claim", claim);

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
      console.log("file: rpc-client.ts~line: 122~error", error);
      throw err;
    }
  }

  close() {
    // TODO: close all channels?
    this.#abortController.abort();
    this.#abortChannel.close();
  }

  async requestSingle<
    RequestMsg,
    ResponseMsg,
    RequestType extends string,
    ResponseType extends string,
  >({
    requestMessageFns,
    responseMessageFns,
    msg,
    rpc,
    topic,
    options: providedOptions,
  }: {
    rpc: RPCKey;
    topic: string[];
    msg: Partial<RequestMsg>;
    requestMessageFns: MessageFns<RequestMsg, RequestType>;
    responseMessageFns?: MessageFns<ResponseMsg, ResponseType>;
    options: RequestOptions;
  }) {
    if (this.#abortController.signal.aborted) {
      throw new Error("ClientClosed");
    }

    const options = { ...DEFAULT_REQUEST_OPTIONS, ...providedOptions };
    const info = getInfo(rpc, topic);

    const requestId = NewRequestID();
    const b = Buffer.from(
      // @ts-expect-error: Upset about type not matching? Fix with moving req/res types to HOF?
      requestMessageFns.encode(requestMessageFns.fromPartial(msg)).finish(),
    );
    const now = Date.now();

    console.log(`REQ [${requestId}]`, { info, options });
    const req = InternalRequest.create({
      clientId: this.#clientID,
      requestId,
      sentAt: msToNanosecondsBigInt(now),
      expiry: msToNanosecondsBigInt(now + DefaultClientTimeoutMs),
      multi: false,
      rawRequest: b,
    });

    const claimChannel = new Chan<InternalClaimRequest>();
    const resChannel = new Chan<InternalResponse>(1);

    const close = () => {
      console.debug("CLOSING UP SHOP");
      this.#claimRequests.delete(requestId);
      this.#responseChannels.delete(requestId);
      claimChannel.close();
      resChannel.close();
      this.close();
    };

    if (info.requireClaim) {
      this.#claimRequests.set(requestId, claimChannel);
    }

    this.#responseChannels.set(requestId, resChannel);

    console.debug(`Publishing req [${requestId}]`);
    const result = await this.#bus
      .publish(getRPCChannel(info).Legacy, req)
      .catch((err) => {
        if (err instanceof Error) {
          return err;
        }

        if (typeof err === "string") {
          return new Error("err");
        }

        return new Error("Unknown error occurred", { cause: err });
      });

    if (result instanceof Error) {
      close();
      throw result;
    }

    // TODO: Set/manage timeout
    // const { channel: abortChannel, abort: cancel } = makeAbortChannel();
    // this.#abortController,

    const cancel = AbortSignal.timeout(options.timeoutMs * 3);
    const abortChannel = new Chan<string>(1);

    cancel.addEventListener("abort", () => {
      abortChannel.trySend("timeoutMs");
    });

    if (info.requireClaim) {
      console.debug("REQUIRES CLAIM");
      const response = await selectServer(
        this.#abortController.signal,
        claimChannel,
        resChannel,
        options.selectionOptions,
      );
      console.log("file: rpc-client.ts~line: 239~response", response);

      if (typeof response !== "string") {
        throw response;
      }

      await this.#bus.publish(
        getClaimResponseChannel(info).Legacy,
        InternalClaimResponse.create({
          requestId,
          serverId: response,
        }),
      );
    }

    const select = new Select([recv(abortChannel), recv(resChannel)]);

    while (true) {
      const resultIdx = await select.wait();

      switch (resultIdx) {
        // abort
        case 0: {
          const abort = select.recv(select.cases[resultIdx]).value;
          console.log("file: rpc-client.ts~line: 261~abort", abort);
          break;
        }

        // responses
        case 1: {
          const res = select.recv(select.cases[resultIdx]).value;
          console.log("file: rpc-client.ts~line: 254~res", res);
          if (!res) break;

          if (res.rawResponse && responseMessageFns) {
            const response = responseMessageFns.decode(res.rawResponse);
            console.log("file: rpc-client.ts~line: 258~response", response);
          }
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
  parentSignal: AbortSignal,
  claimChannel: ClaimRequestChannel,
  resChannel: ResponseChannel,
  opts: Partial<SelectionOptions> = {},
) {
  // const controller = new AbortController();
  const localAbortChannel = new Chan<string>(1);
  // const cancel = controller.abort;
  // const signal = controller.signal;

  // const {
  //   channel: localAbortChannel,
  //   abort: cancel,
  //   signal,
  // } = makeAbortChannel();
  // parentSignal
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
    recv(localAbortChannel),
    recv(claimChannel),
    recv(resChannel),
  ]);

  // force selection after timeout
  const cancel = AbortSignal.timeout(affinityTimeout);
  cancel.addEventListener("abort", () => {
    localAbortChannel.trySend("affinityTimeout");
  });
  // timers.setTimeout(() => {
  //   cancel();
  // }, affinityTimeout);

  while (true) {
    // TODO: maybe remove the signal and just use the abortChannel?
    const resultIdx = await select.wait();
    console.log("file: rpc-client.ts~line: 378~resultIdx", resultIdx);

    switch (resultIdx) {
      // abort
      case 0: {
        const abortReason = select.recv(select.cases[resultIdx]).value;
        console.log("file: rpc-client.ts~line: 384~abortReason", abortReason);

        if (selectionFunction) {
          return selectionFunction(claims);
        }

        if (resError) {
          return resError;
        }

        if (serverId) {
          return serverId;
        }

        if (claimCount > 0) {
          return new NoServersAvailableError(
            "No servers available (recieved ${claimCount} responses)",
          );
        }

        return "";
      }

      // claims
      case 1: {
        const claim = select.recv(select.cases[resultIdx]).value;
        console.log("file: rpc-client.ts~line: 407~claim", claim);

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

            const cancel = AbortSignal.timeout(shortCircuitTimeout);
            cancel.addEventListener("abort", () => {
              localAbortChannel.trySend("shortCircuitTimeout");
            });
          }
        }
        break;
      }

      // responses
      case 2: {
        // will only happen with malformed requests
        const response = select.recv(select.cases[resultIdx]).value;
        console.log("file: rpc-client.ts~line: 446~response", response);
        resError = new Error("Invalid response recieved", { cause: response });

        break;
      }
    }
  }
}

class NoServersAvailableError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args);

    this.name = "NoServersAvailable";
  }
}

function makeAbortChannel() {
  // parentControllerOrSignal?: AbortController | AbortSignal,
  try {
    const controller = new AbortController();
    const channel = new Chan<string>(1);

    // if (parentControllerOrSignal) {
    //   const signal = (parentControllerOrSignal =
    //     "signal" in parentControllerOrSignal
    //       ? parentControllerOrSignal.signal
    //       : parentControllerOrSignal);
    //
    //   signal.addEventListener("abort", () => {
    //     controller.abort("Parent controller was aborted");
    //   });
    // }

    controller.signal.addEventListener("abort", function () {
      channel.trySend(`parentAborted: ${this.reason}`);
    });

    return {
      abort: controller.abort,
      channel,
      controller,
      signal: controller.signal,
    };
  } catch (err) {
    const error = ensureError(err);
    console.log("file: rpc-client.ts~line: 465~error", error);
    throw error;
  }
}

// RequestClient
// 1. Serialize message payload
// 2. If claim, Start listening to response channel
// 3. Send request
// 4. If claim,
//      a. Wait for X ms for claim requests
//      b. Select claim
//      c. Send claim response
// 3. Send response (if claimed, send to selected server)
//

// export async function newRPC<
//   RequestType extends UnknownMessage,
//   ResponseType extends UnknownMessage,
// >(info: LivekitRequestInfo) {
//   const requestClient = getValkeyClient({ lazyConnect: true });
//   const responseClient = getValkeyClient({ lazyConnect: true });
//
//   const requestChannel = getRPCChannel(info);
//   requestClient.subscribe(requestChannel.Legacy, (err) => {
//     if (err) {
//       const error = ensureError(err);
//       console.error(error);
//       throw error;
//     }
//   });
//
//   return async function (request: RequestType) {
//     const requestID = NewRequestID();
//     const nowMs = Date.now();
//
//     const req = {
//       nowNano: msToNanosecondsBigInt(nowMs),
//       expiryNano: msToNanosecondsBigInt(nowMs + DefaultClientTimeoutMs),
//       multi: false,
//       rawRequest: request, // TODO: NEEDS TO BE ENCODED!
//       metadata: {},
//     };
//
//     const claimChannel = undefined;
//     const responseChannel = {};
//
//     if (info.requireClaim) {
//       claimChannel = {};
//       claimRequests.set(requestID, claimChannel);
//     }
//     responseChannels.set(requestID, responseChannel);
//
//     claimRequests.delete(requestID);
//     responseChannels.delete(requestID);
//     return;
//   };
// }

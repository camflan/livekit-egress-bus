import { ensureError } from "@uplift-ltd/ts-helpers";
import { UnknownMessage } from "./generated/typeRegistry";
import {
  getClaimRequestChannel,
  getResponseChannel,
  getRPCChannel,
  LivekitRequestInfo,
} from "./helpers/channels";
import { newClientID, NewRequestID } from "./helpers/ids";
import { getValkeyClient } from "./valkey";
import { msToNanosecondsBigInt } from "./helpers/datetimes";
import { MessageBus } from "./bus";
import { Chan, recv, Select } from "ts-chan";
import {
  ClaimRequest as InternalClaimRequest,
  Response as InternalResponse,
  MessageFns,
  Request as InternalRequest,
} from "./generated/internal";
import { getInfo, RPCKey } from "./info";

// copied from LK, converted to ms
const DefaultClientTimeoutMs = 3 * 1000;
const DefaultAffinityTimeoutMs = 1000;
const DefaultAffinityShortCircuitMs = 200;

const clientId = newClientID();

type ClaimRequestChannel = Chan<InternalClaimRequest>;
type ResponseChannel = Chan<InternalResponse>;

class RPCClient {
  #abortController: AbortController;
  #abortChannel: Chan<boolean>;
  #bus: MessageBus;
  #claimRequests = new Map<string, ClaimRequestChannel>();
  #clientID = newClientID();
  #responseChannels = new Map<string, ResponseChannel>();

  constructor({ bus, abort }: { bus: MessageBus; abort: AbortController }) {
    this.#abortController = abort;
    this.#abortChannel = new Chan<boolean>();
    this.#bus = bus;

    this.#abortController.signal.addEventListener("abort", () => {
      this.#abortChannel.trySend(true);
    });

    this.work();
  }

  async work() {
    const responses = this.#bus.subscribe(
      getResponseChannel("EgressInternal", this.#clientID).Legacy,
      InternalResponse,
    );
    const claims = this.#bus.subscribe(
      getClaimRequestChannel("EgressInternal", this.#clientID).Legacy,
      InternalClaimRequest,
    );

    const select = new Select([
      recv(this.#abortChannel),
      recv(responses.msgChannel),
      recv(claims.msgChannel),
    ]);

    while (true) {
      const resultIdx = await select.wait(this.#abortController.signal);

      switch (resultIdx) {
        // Abort
        case 0: {
          const result = select.recv(select.cases[resultIdx]).value;
          console.log("file: rpc-client.ts~line: 70~result", result);

          if (result === true) {
            responses.close();
            claims.close();
          }
          break;
        }

        // responses
        case 1: {
          const res = select.recv(select.cases[resultIdx]).value;
          console.log("file: rpc-client.ts~line: 70~res", res);

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
          console.log("file: rpc-client.ts~line: 77~claim", claim);

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
          throw new Error("Unreachable");
      }
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
  }: {
    rpc: RPCKey;
    topic: string[];
    msg: RequestMsg;
    requestMessageFns: MessageFns<RequestMsg, RequestType>;
    responseMessageFns: MessageFns<ResponseMsg, ResponseType>;
  }) {
    if (this.#abortController.signal.aborted) {
      throw new Error("ClientClosed");
    }

    const info = getInfo(rpc, topic);

    const requestId = NewRequestID();
    const b = Buffer.from(requestMessageFns.encode(msg).finish());
    const now = Date.now();

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

    if (info.requireClaim) {
      // TODO: do opts
      const serverId = selectServer(
        this.#abortChannel,
        this.#abortController.signal,
        claimChannel,
        resChannel /*, opts */,
      );
    }
  }
}

async function selectServer(
  abortChannel: Chan<boolean>,
  signal: AbortSignal,
  claimChannel: ClaimRequestChannel,
  resChannel: ResponseChannel,
  {
    affinityTimeout = DefaultAffinityTimeoutMs,
    selectionFunction,
    maximumAffinity = 1,
    shortCircuitTimeout = 500_000,
  }: {
    affinityTimeout?: number;
    selectionFunction?: () => void;
    maximumAffinity?: number;
    shortCircuitTimeout?: number;
  } = {},
) {
  let serverId = "";

  const select = new Select([
    recv(abortChannel),
    recv(claimChannel),
    recv(resChannel),
  ]);

  while (true) {
    // TODO: maybe remove the signal and just use the abortChannel?
    const resultIdx = await select.wait(signal);

    switch (resultIdx) {
      // abort
      case 0:
        return serverId || "";
        break;

      // claims
      case 1: {
        const claim = await select.recv(select.cases[resultIdx]).value;

        break;
      }

      // responses
      case 2: {
        const response = await select.recv(select.cases[resultIdx]).value;

        break;
      }
    }
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

export async function newRPC<
  RequestType extends UnknownMessage,
  ResponseType extends UnknownMessage,
>(info: LivekitRequestInfo) {
  const requestClient = getValkeyClient({ lazyConnect: true });
  const responseClient = getValkeyClient({ lazyConnect: true });

  const requestChannel = getRPCChannel(info);
  requestClient.subscribe(requestChannel.Legacy, (err) => {
    if (err) {
      const error = ensureError(err);
      console.error(error);
      throw error;
    }
  });

  return async function (request: RequestType) {
    const requestID = NewRequestID();
    const nowMs = Date.now();

    const req = {
      nowNano: msToNanosecondsBigInt(nowMs),
      expiryNano: msToNanosecondsBigInt(nowMs + DefaultClientTimeoutMs),
      multi: false,
      rawRequest: request, // TODO: NEEDS TO BE ENCODED!
      metadata: {},
    };

    const claimChannel = undefined;
    const responseChannel = {};

    if (info.requireClaim) {
      claimChannel = {};
      claimRequests.set(requestID, claimChannel);
    }
    responseChannels.set(requestID, responseChannel);

    claimRequests.delete(requestID);
    responseChannels.delete(requestID);
    return;
  };
}

/**
 * Adapted from LiveKit psrpc channels.go
 */
import { safeJoin } from "@uplift-ltd/strings";

type LKService = "EgressInternal";

type LivekitRequestInfo = {
  service: string;
  method: string;
  topic: string[];
  queue?: boolean;
  multi?: boolean;
};

const safeJoinWithPeriod = safeJoin(".");

const CHANNEL_PREFIXES = {
  SERVER: "SRV",
  CLIENT: "CLI",
} as const;

const CHANNEL_SUFFIXES = {
  REQUEST: "REQ",
  RESPONSE: "RES",
  CLAIM_REQUEST: "CLAIM",
  CLAIM_RESPONSE: "RCLAIM",
  STREAM: "STR",
} as const;

export const startEgressRequestChannel = getRPCChannel({
  service: "EgressInternal",
  method: "StartEgress",
  topic: [],
});

export function getClaimRequestChannel(service: LKService, clientId: string) {
  return {
    Legacy: formatChannel(
      "|",
      service,
      clientId,
      CHANNEL_SUFFIXES.CLAIM_REQUEST,
    ),
    Server: formatClientChannel(
      service,
      clientId,
      CHANNEL_SUFFIXES.CLAIM_REQUEST,
    ),
  };
}

export function getStreamChannel(service: LKService, clientId: string) {
  return {
    Legacy: formatChannel("|", service, clientId, CHANNEL_SUFFIXES.STREAM),
    Server: formatClientChannel(service, clientId, CHANNEL_SUFFIXES.STREAM),
  };
}

export function getResponseChannel(service: LKService, clientId: string) {
  return {
    Legacy: formatChannel("|", service, clientId, CHANNEL_SUFFIXES.RESPONSE),
    Server: formatClientChannel(service, clientId, CHANNEL_SUFFIXES.RESPONSE),
  };
}

export function getRPCChannel({
  topic,
  method,
  queue = false,
  service,
}: LivekitRequestInfo) {
  return {
    Legacy: formatChannel(
      "|",
      service,
      method,
      topic,
      CHANNEL_SUFFIXES.REQUEST,
    ),
    Server: formatServerChannel(service, topic, queue),
    Local: formatLocalChannel(method, CHANNEL_SUFFIXES.REQUEST),
  };
}

export function getHandlerKey({ method, topic }: LivekitRequestInfo) {
  return formatChannel(".", method, topic);
}

export function getClaimResponseChannel({
  service,
  method,
  topic,
}: LivekitRequestInfo) {
  return {
    Legacy: formatChannel(
      "|",
      service,
      method,
      topic,
      CHANNEL_SUFFIXES.CLAIM_RESPONSE,
    ),
    Server: formatServerChannel(service, topic, false),
    Local: formatLocalChannel(method, CHANNEL_SUFFIXES.CLAIM_RESPONSE),
  };
}

export function getStreamServerChannel({
  service,
  method,
  topic,
}: LivekitRequestInfo) {
  return {
    Legacy: formatChannel("|", service, method, topic, CHANNEL_SUFFIXES.STREAM),
    Server: formatServerChannel(service, topic, false),
    Local: formatLocalChannel(method, CHANNEL_SUFFIXES.STREAM),
  };
}

export function formatClientChannel(
  service: string,
  clientId: string,
  channel: string,
) {
  return safeJoinWithPeriod(
    CHANNEL_PREFIXES.CLIENT,
    service,
    clientId,
    channel,
  );
}

export function formatLocalChannel(method: string, channel: string) {
  return safeJoinWithPeriod(method, channel);
}

export function formatServerChannel(
  service: string,
  topic: string[],
  queue: boolean,
) {
  return safeJoinWithPeriod(
    CHANNEL_PREFIXES.SERVER,
    service,
    ...topic,
    ...(queue ? ["Q"] : []),
  );
}

function formatChannel(
  delim: string,
  ...parts: Parameters<ReturnType<typeof safeJoin>>
) {
  return safeJoin(delim)(parts);
}

import { safeJoin } from "@uplift-ltd/strings";

/**
 * Adapted from LiveKit psrpc channels.go
 */
import { RPCService, RequestInfo } from "./info";

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

export function getClaimRequestChannel(service: RPCService, clientId: string) {
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

export function getStreamChannel(service: RPCService, clientId: string) {
  return {
    Legacy: formatChannel("|", service, clientId, CHANNEL_SUFFIXES.STREAM),
    Server: formatClientChannel(service, clientId, CHANNEL_SUFFIXES.STREAM),
  };
}

export function getResponseChannel(service: RPCService, clientId: string) {
  return {
    Legacy: formatChannel("|", service, clientId, CHANNEL_SUFFIXES.RESPONSE),
    Server: formatClientChannel(service, clientId, CHANNEL_SUFFIXES.RESPONSE),
  };
}

export function getRPCChannel({
  topic,
  method,
  queue,
  service,
}: Pick<RequestInfo, "method" | "service"> &
  Partial<Pick<RequestInfo, "queue" | "topic">>) {
  return {
    Legacy: formatChannel(
      "|",
      service,
      method,
      topic,
      CHANNEL_SUFFIXES.REQUEST,
    ),
    Server: formatServerChannel(service, topic, queue ?? false),
    Local: formatLocalChannel(method, CHANNEL_SUFFIXES.REQUEST),
  };
}

export function getHandlerKey({ method, topic }: RequestInfo) {
  return formatChannel(".", method, topic);
}

export function getClaimResponseChannel({
  service,
  method,
  topic,
}: RequestInfo) {
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
}: RequestInfo) {
  return {
    Legacy: formatChannel("|", service, method, topic, CHANNEL_SUFFIXES.STREAM),
    Server: formatServerChannel(service, topic, false),
    Local: formatLocalChannel(method, CHANNEL_SUFFIXES.STREAM),
  };
}
function formatClientChannel(
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

function formatLocalChannel(method: string, channel: string) {
  return safeJoinWithPeriod(method, channel);
}

function formatServerChannel(
  service: string,
  topic: string[] = [],
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
  return safeJoin(delim)(...parts);
}

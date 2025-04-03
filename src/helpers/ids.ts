/**
 * functionality sourced from LiveKit rand-ids
 */

const entityPrefixes = {
  client: "CLI",
  egress: "EG",
  request: "REQ",
  server: "SRV",
  stream: "STR",
} as const;

export function newRequestID() {
  return formatID(entityPrefixes.request);
}

export function newServerID() {
  return formatID(entityPrefixes.server);
}

export function newStreamID() {
  return formatID(entityPrefixes.stream);
}

export function newClientID() {
  return formatID(entityPrefixes.client);
}

export function newEgressID() {
  return formatID(entityPrefixes.egress);
}

export function formatID(prefix: string) {
  return `${prefix}_${readIDChars(10)}`;
}

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function readIDChars(length: number) {
  return Array.from({ length }, () => {
    return alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }).join("");
}

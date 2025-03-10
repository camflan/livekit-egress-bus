/**
 * functionality sourced from LiveKit rand-ids
 */
export function newClientID() {
  return formatID("CLI_");
}

export function NewServerID() {
  return formatID("SRV_");
}

export function NewRequestID() {
  return formatID("REQ_");
}

export function NewStreamID() {
  return formatID("STR_");
}

function formatID(prefix: string) {
  return prefix + readIDChars(10);
}

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function readIDChars(length: number) {
  return Array.from({ length }, () => {
    return alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }).join("");
}

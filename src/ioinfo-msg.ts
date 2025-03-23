import { EgressInfo } from "./generated/livekit_egress";

export function decodeIOInfoMsg(method: string) {
  switch (method) {
    case "UpdateEgress":
    case "CreateEgress":
      return EgressInfo;
    default:
      throw new Error(`Unhandled method: ${method}`);
  }
}

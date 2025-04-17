import { egressStatusToJSON } from "@/generated/livekit_egress";
import { EgressStatus } from "@/protobufs";

/** Converts the integer enum value into a human readable string (the key of the enum) */
export function egressStatusToEgressStatusString(status: EgressStatus) {
  return egressStatusToJSON(status) as keyof typeof EgressStatus;
}

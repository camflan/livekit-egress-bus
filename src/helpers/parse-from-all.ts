import {
  ClaimRequest,
  ClaimResponse,
  Msg,
  Request,
  Response,
  Stream,
  StreamOpen,
} from "../generated/internal";
import {
  GetEgressRequest,
  UpdateIngressStateRequest,
} from "../generated/rpc/io";
import { StartEgressRequest } from "../generated/rpc/egress";
import {
  EgressInfo,
  StopEgressRequest,
  StreamOutput,
  WebEgressRequest,
} from "../generated/livekit_egress";
import { KeepalivePing } from "../generated/rpc/keepalive";

const ALL_PROTOS = {
  ClaimRequest,
  ClaimResponse,
  EgressInfo,
  GetEgressRequest,
  KeepalivePing,
  Msg,
  Request,
  Response,
  StartEgressRequest,
  StopEgressRequest,
  Stream,
  StreamOpen,
  StreamOutput,
  UpdateIngressStateRequest,
  WebEgressRequest,
};

export function parseMsgFromAllTypes(msg: Buffer, type?: string) {
  const results = {};

  for (const [key, proto] of Object.entries(ALL_PROTOS)) {
    try {
      if (type && !type.includes(key)) {
        continue;
      }

      let decoded = proto.decode(msg);

      // if ("token" in decoded) {
      //   decoded.token = parseMsgFromAllTypes(
      //     typeof decoded.token === "string"
      //       ? Buffer.from(decoded.token)
      //       : decoded.token,
      //   );
      // }
      //
      // if ("value" in decoded && typeof decoded.value !== "string") {
      //   decoded.value = parseMsgFromAllTypes(decoded.value);
      // }
      //
      // if ("rawRequest" in decoded && typeof decoded.rawRequest !== "string") {
      //   decoded.rawRequestString = decoded.rawRequest.toString("utf-8");
      //   // decoded.rawRequest = parseMsgFromAllTypes(decoded.rawRequest);
      // }

      results[key] = decoded;
    } catch (err) {
      results[key] = err instanceof Error ? err.message : String(err);
    }
  }

  return results;
}

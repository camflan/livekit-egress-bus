import {
  ClaimRequest,
  ClaimResponse,
  Msg,
  Request,
  Response,
} from "./generated/internal";
import { MessageType, UnknownMessage } from "./generated/typeRegistry";

const GOOGLEAPIS_PREFIX = "type.googleapis.com";

// TODO: Make this the correct abstraction
//       Channel + type?
//       Maybe just Channel
//       Add valibot?
export function decodeMsg(msgBuffer: Buffer) {
  const { typeUrl, value } = Msg.decode(msgBuffer);

  const protobufType = typeUrl.startsWith(GOOGLEAPIS_PREFIX)
    ? typeUrl.slice(GOOGLEAPIS_PREFIX.length + 1)
    : typeUrl;

  switch (protobufType) {
    case "internal.ClaimRequest":
      return ClaimRequest.decode(value);

    case "internal.ClaimResponse":
      return ClaimResponse.decode(value);

    case "internal.Request":
      return Request.decode(value);

    case "internal.Response":
      return Response.decode(value);

    default:
      throw new Error(`Unable to handle typeUrl: ${typeUrl}`);
  }
}

export function decodeProtobuf<T extends UnknownMessage>(
  msgType: MessageType<T>,
  msg: Buffer,
) {
  return msgType.decode(msg);
}

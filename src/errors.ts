export const ErrorCode = {
  OK: "",

  // Request Canceled by client
  Canceled: "canceled",
  // Could not unmarshal request
  MalformedRequest: "malformed_request",
  // Could not unmarshal result
  MalformedResponse: "malformed_result",
  // Request timed out
  DeadlineExceeded: "deadline_exceeded",
  // Service unavailable due to load and/or affinity constraints
  Unavailable: "unavailable",
  // Unknown (server returned non-psrpc error)
  Unknown: "unknown",

  // Invalid argument in request
  InvalidArgument: "invalid_argument",
  // Entity not found
  NotFound: "not_found",
  // Cannot produce and entity matching requested format
  NotAcceptable: "not_acceptable",
  // Duplicate creation attempted
  AlreadyExists: "already_exists",
  // Caller does not have required permissions
  PermissionDenied: "permission_denied",
  // Some resource has been exhausted, e.g. memory or quota
  ResourceExhausted: "resource_exhausted",
  // Inconsistent state to carry out request
  FailedPrecondition: "failed_precondition",
  // Request aborted
  Aborted: "aborted",
  // Operation was out of range
  OutOfRange: "out_of_range",
  // Operation is not implemented by the server
  Unimplemented: "unimplemented",
  // Operation failed due to an internal error
  Internal: "internal",
  // Irrecoverable loss or corruption of data
  DataLoss: "data_loss",
  // Similar to PermissionDenied, used when the caller is unidentified
  Unauthenticated: "unauthenticated",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const LKErrorSymbol = Symbol("LKError");

class LiveKitError extends Error {
  "$$type" = LKErrorSymbol;
  code: ErrorCode = ErrorCode.Unknown;

  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args);

    this.name = this.constructor.name;
  }
}

export function isLiveKitError(
  variableToCheck: unknown,
): variableToCheck is LiveKitError {
  if (!(variableToCheck instanceof Error)) {
    return false;
  }

  if (!("$$type" in variableToCheck)) {
    return false;
  }

  return variableToCheck.$$type === LKErrorSymbol;
}

export class GenericLiveKitRpcError extends LiveKitError {
  code: ErrorCode;

  constructor(code: ErrorCode, ...args: ConstructorParameters<typeof Error>) {
    super(...args);
    this.code = code;
  }
}

export class NotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
}

export class EgressNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "egress does not exist";
}

export class EgressNotConnectedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "egress not connected (redis required)";
}

export class IdentityEmptyError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "identity cannot be empty";
}

export class IngressNotConnectedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "ingress not connected (redis required)";
}

export class IngressNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "ingress does not exist";
}

export class IngressNonReusableError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "ingress is not reusable and cannot be modified";
}

export class NameExceedsLimitsError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "name length exceeds limits";
}

export class MetadataExceedsLimitsError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "metadata size exceeds limits";
}

export class AttributeExceedsLimitsError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "attribute size exceeds limits";
}

export class RoomNameExceedsLimitsError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "room name length exceeds limits";
}

export class ParticipantIdentityExceedsLimitsError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "participant identity length exceeds limits";
}

export class OperationFailedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "operation cannot be completed";
}

export class ParticipantNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "participant does not exist";
}

export class RoomNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "requested room does not exist";
}

export class RoomLockFailedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "could not lock room";
}

export class RoomUnlockFailedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "could not unlock room, lock token does not match";
}

export class RemoteUnmuteNoteEnabledError extends LiveKitError {
  code = ErrorCode.FailedPrecondition;
  message = "remote unmute not enabled";
}

export class TrackNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "track is not found";
}

export class WebHookMissingAPIKeyError extends LiveKitError {
  code = ErrorCode.InvalidArgument;
  message = "api_key is required to use webhooks";
}

export class SIPNotConnectedError extends LiveKitError {
  code = ErrorCode.Internal;
  message = "sip not connected (redis required)";
}

export class SIPTrunkNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "requested sip trunk does not exist";
}

export class SIPDispatchRuleNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "requested sip dispatch rule does not exist";
}

export class SIPParticipantNotFoundError extends LiveKitError {
  code = ErrorCode.NotFound;
  message = "requested sip participant does not exist";
}

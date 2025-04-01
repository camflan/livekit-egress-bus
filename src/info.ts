export type Service = "EgressInternal" | "IOInfo";

type MethodInfo = {
  affinityEnabled: boolean;
  multi: boolean;
  requireClaim: boolean;
  queue: boolean;
};

const clientServiceDefinitions = {
  StartEgress: {
    affinityEnabled: true,
    multi: false,
    queue: false,
    requireClaim: true,
  },
  ListActiveEgress: {
    affinityEnabled: false,
    multi: true,
    requireClaim: false,
    queue: false,
  },
} as const satisfies Record<string, MethodInfo>;

type ClientRPCKey = keyof typeof clientServiceDefinitions;

function isClientRPCKey(
  variableToCheck: unknown,
): variableToCheck is ClientRPCKey {
  return (
    typeof variableToCheck === "string" &&
    variableToCheck in clientServiceDefinitions
  );
}

const serverServiceDefinitions = {
  CreateEgress: {
    affinityEnabled: false,
    multi: false,
    requireClaim: true,
    queue: true,
  },
  UpdateEgress: {
    affinityEnabled: false,
    multi: false,
    requireClaim: true,
    queue: true,
  },
  GetEgress: {
    affinityEnabled: false,
    multi: false,
    requireClaim: true,
    queue: true,
  },
  ListEgress: {
    affinityEnabled: false,
    multi: false,
    requireClaim: true,
    queue: true,
  },
  UpdateMetrics: {
    affinityEnabled: false,
    multi: false,
    requireClaim: true,
    queue: true,
  },
} as const satisfies Record<string, MethodInfo>;
export type ServerRPCKey = keyof typeof serverServiceDefinitions;

export type RPCKey = ClientRPCKey | ServerRPCKey;

export function getInfo({
  rpc,
  topic,
  service,
}: {
  rpc:
    | keyof typeof clientServiceDefinitions
    | keyof typeof serverServiceDefinitions;
  topic: string[];
  service: Service;
}) {
  const method = isClientRPCKey(rpc)
    ? clientServiceDefinitions[rpc]
    : serverServiceDefinitions[rpc];

  const rpcInfo = {
    service,
    method: rpc,
    topic,
    multi: method.multi ?? false,
  };

  return {
    ...rpcInfo,
    rpcInfo,
    affinityEnabled: method.affinityEnabled ?? false,
    requireClaim: method.requireClaim ?? false,
    queue: method.queue ?? false,
  };
}

export type RequestInfo = ReturnType<typeof getInfo>;

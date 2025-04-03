type MethodInfo = {
  affinityEnabled: boolean;
  multi: boolean;
  requireClaim: boolean;
  queue: boolean;
};

const clientServiceDefinitions = {
  EgressInternal: {
    StartEgress: {
      affinityEnabled: true,
      multi: false,
      queue: false,
      requireClaim: true,
    },
    ListActiveEgress: {
      affinityEnabled: false,
      multi: true,
      queue: false,
      requireClaim: false,
    },
    StopEgress: {
      affinityEnabled: false,
      multi: false,
      queue: true,
      requireClaim: true,
    },
  },
} as const satisfies Record<string, Record<string, MethodInfo>>;

export type ClientRPCService = keyof typeof clientServiceDefinitions;
export type ClientRPCForService<Service extends ClientRPCService> =
  keyof (typeof clientServiceDefinitions)[Service];

type ClientRPCKey =
  keyof (typeof clientServiceDefinitions)[ClientRPCService];

function isClientRPCKey(
  variableToCheck: unknown,
): variableToCheck is ClientRPCKey {
  if (!variableToCheck || typeof variableToCheck !== "string") {
    return false;
  }

  return Object.values(clientServiceDefinitions).some((config) => {
    return variableToCheck in config;
  });
}

const serverServiceDefinitions = {
  IOInfo: {
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
  },
} as const satisfies Record<string, Required<Record<string, MethodInfo>>>;

type ServerRPCService = keyof typeof serverServiceDefinitions;
export type ServerRPCKey =
  keyof (typeof serverServiceDefinitions)[ServerRPCService];

export type RPCService = ClientRPCService | ServerRPCService;

export function getInfo<
  Service extends RPCService,
  RPC = Service extends ServerRPCService
    ? keyof (typeof serverServiceDefinitions)[Service]
    : Service extends ClientRPCService
      ? keyof (typeof clientServiceDefinitions)[Service]
      : never,
>(service: Service, rpc: RPC, topic: string[] = []) {
  const method = isClientRPCKey(rpc)
    ? clientServiceDefinitions[service as ClientRPCService][rpc as ClientRPCKey]
    : serverServiceDefinitions[service as ServerRPCService][
        rpc as ServerRPCKey
      ];

  const rpcInfo = {
    service,
    method: rpc as string,
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

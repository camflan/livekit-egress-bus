const service = "EgressInternal";

type MethodInfo = {
  affinityEnabled: boolean;
  multi: boolean;
  requireClaim: boolean;
  queue: boolean;
};

const serviceDefinitions = {
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

export type RPCKey = keyof typeof serviceDefinitions;

export function getInfo(rpc: RPCKey, topic: string[]) {
  const method = serviceDefinitions[rpc];
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

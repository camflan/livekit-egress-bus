// import { remember } from "@epic-web/remember";
// import { safeJoin } from "@uplift-ltd/strings";
import Valkey, { RedisOptions as ValkeyOptions } from "iovalkey";
// import { type PeerCertificate, checkServerIdentity } from "tls";

// import { env } from "@/constants/env";

// export const getValkey = () => remember("valkey", () => getValkeyClient({ lazyConnect: true }));

type GetValkeyClientOptions = Omit<ValkeyOptions, "tls"> & { ssl?: boolean };

export function getValkeyClient(options: GetValkeyClientOptions) {
  const resolvedOptions = getValkeyClientConfig(options);
  return new Valkey(resolvedOptions);
}

export function getValkeyClientConfig({
  db = 0,
  host = "redis://localhost",
  keyPrefix,
  password,
  port = "6380",
  ssl,
  username,
  ...options
}: GetValkeyClientOptions = {}) {
  return {
    db,
    host,
    keyPrefix,
    password,
    port,
    username,
    ...options,
  } as const;
}

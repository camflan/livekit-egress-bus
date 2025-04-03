import Valkey, { RedisOptions as ValkeyOptions } from "iovalkey";

type GetValkeyClientOptions = Omit<ValkeyOptions, "tls"> & { ssl?: boolean };

export function getValkeyClient(options?: GetValkeyClientOptions) {
  const resolvedOptions = getValkeyClientConfig(options);
  return new Valkey(resolvedOptions);
}

function getValkeyClientConfig({
  db = 0,
  host = process.env.REDIS_HOST ?? "127.0.0.1",
  port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6380,
  ...options
}: GetValkeyClientOptions = {}) {
  return {
    db,
    host,
    port,
    ...options,
  } as const;
}

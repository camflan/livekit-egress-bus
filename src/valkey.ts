import Valkey, { RedisOptions as ValkeyOptions } from "iovalkey";

type GetValkeyClientOptions = Omit<ValkeyOptions, "tls"> & { ssl?: boolean };

export function getValkeyClient(options: GetValkeyClientOptions) {
  const resolvedOptions = getValkeyClientConfig(options);
  return new Valkey(resolvedOptions);
}

export function getValkeyClientConfig({
  db = 0,
  host = "127.0.0.1",
  keyPrefix,
  password,
  port = 6380,
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

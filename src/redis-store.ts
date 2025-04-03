import { EgressInfo, EgressStatus } from "@/generated/livekit_egress";
import { EgressNotFoundError } from "@/helpers/errors";
/** adapted from the ideas of LK redis store */
import { ensureError } from "@uplift-ltd/ts-helpers";
import Redis from "iovalkey";
import { getLogger } from "loglevel";

const logger = getLogger("redis-store");

// keeping these until we know we don't need them
/* eslint-disable @typescript-eslint/no-unused-vars */
const VersionKey = "livekit_version";

// RoomsKey is hash of room_name => Room proto
const RoomsKey = "rooms";
const RoomInternalKey = "room_internal";

// EgressKey is a hash of egressID => egress info
const EgressKey = "egress";
const EndedEgressKey = "ended_egress";
const RoomEgressPrefix = "egress:room:";

// IngressKey is a hash of ingressID => ingress info
const IngressKey = "ingress";
const StreamKeyKey = "{ingress}_stream_key";
const IngressStatePrefix = "{ingress}_state:";
const RoomIngressPrefix = "room_{ingress}:";

// RoomParticipantsPrefix is hash of participant_name => ParticipantInfo
const RoomParticipantsPrefix = "room_participants:";

// RoomLockPrefix is a simple key containing a provided lock uid
const RoomLockPrefix = "room_lock:";

// Agents
const AgentDispatchPrefix = "agent_dispatch:";
const AgentJobPrefix = "agent_job:";

const maxRetries = 5;
/* eslint-enable @typescript-eslint/no-unused-vars */

export async function storeEgress(client: Redis, info: EgressInfo) {
  try {
    const data = Buffer.from(
      EgressInfo.encode(EgressInfo.create(info)).finish(),
    );

    const pipeline = client.pipeline();
    pipeline.hset(EgressKey, info.egressId, data);
    pipeline.sadd(RoomEgressPrefix + info.roomName, info.egressId);
    await pipeline.exec();
  } catch (err) {
    const error = ensureError(err);
    logger.error(error);
    throw error;
  }
}

export async function loadEgress(client: Redis, egressId: string) {
  try {
    const data = await client.hgetBuffer(EgressKey, egressId);

    if (!data) {
      throw new EgressNotFoundError();
    }

    return EgressInfo.decode(data);
  } catch (err) {
    throw ensureError(err);
  }
}

export async function listEgress(
  client: Redis,
  roomName: string,
  isActiveOnly?: boolean,
) {
  try {
    let data: (Buffer | null)[] = [];

    if (!roomName) {
      const allFields = await client.hgetallBuffer(EgressKey);
      data = Object.values(allFields);
    } else {
      const egressIds = await client.smembers(RoomEgressPrefix + roomName);

      if (egressIds.length < 1) {
        return [];
      }

      data = await client.hmgetBuffer(EgressKey, ...egressIds);
    }

    return data.flatMap((datum) => {
      if (!datum) return [];

      const info = EgressInfo.decode(datum);

      if (isActiveOnly && info.status >= EgressStatus.EGRESS_COMPLETE) {
        return [];
      }

      return [info];
    });
  } catch (err) {
    const error = ensureError(err);
    logger.error(error);
    throw error;
  }
}

export async function updateEgress(client: Redis, info: EgressInfo) {
  try {
    const data = Buffer.from(EgressInfo.encode(info).finish());
    const pipeline = client.pipeline();
    pipeline.hset(EgressKey, info.egressId, data);

    // Store egress ended data so we can clean it up later
    if (info.endedAt > 0) {
      pipeline.hset(
        EndedEgressKey,
        info.egressId,
        egressEndedValue(info.roomName, info.endedAt),
      );
    }

    await pipeline.exec();
  } catch (err) {
    const error = ensureError(err);
    logger.error(error);
    throw error;
  }
}

function egressEndedValue(roomName: string, endedAt: bigint) {
  return `${roomName}|${endedAt}`;
}

export function makeRedisStore(valkey: Redis) {
  return {
    listEgress: listEgress.bind(undefined, valkey),
    loadEgress: loadEgress.bind(undefined, valkey),
    storeEgress: updateEgress.bind(undefined, valkey),
    updateEgress: updateEgress.bind(undefined, valkey),
  } as const;
}

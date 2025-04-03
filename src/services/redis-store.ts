/** adapted from the ideas of LK redis store */

import Redis from "iovalkey";
import { getValkeyClient } from "./valkey";
import { ensureError } from "@uplift-ltd/ts-helpers";
import { EgressInfo, EgressStatus } from "@/generated/livekit_egress";
import { getLogger } from "loglevel";
import { EgressNotFoundError } from "@/errors";

const logger = getLogger("redis-store");

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

export async function storeEgress(
  info: EgressInfo,
  client: Redis = getValkeyClient({ lazyConnect: true }),
) {
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

export async function loadEgress(
  egressId: string,
  client: Redis = getValkeyClient({ lazyConnect: true }),
) {
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
  roomName: string,
  isActiveOnly?: boolean,
  client: Redis = getValkeyClient({ lazyConnect: true }),
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

export async function updateEgress(
  info: EgressInfo,
  client: Redis = getValkeyClient({ lazyConnect: true }),
) {
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

function egressEndedValue(roomName: string, endedAt: BigInt) {
  return `${roomName}|${endedAt}`;
}

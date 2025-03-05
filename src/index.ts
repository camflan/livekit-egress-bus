import { getValkeyClient } from "./valkey";

import {
  EgressInfo,
  EncodingOptionsPreset,
  StreamProtocol,
} from "./generated/livekit_egress.proto";
import { Msg } from "./generated/internal.proto";
import { StartEgressRequest } from "./generated/rpc/egress.proto";

const EGRESS_KEY = "egress";

main()
  .then(console.log)
  .catch((err) => {
    console.error(err);

    process.exit(1);
  })
  .then(() => process.exit(0));

// STEPS
// 1. Create EgressID
// 2. Store Egress data to egress.egressID field
// 3. Start Egress
async function main() {
  console.log("Starting…");
  const egressId = "EG_asdfiJ";

  const valkey = getValkeyClient({ lazyConnect: false });

  const config = {
    // egressId,
    participant: undefined,
    roomComposite: undefined,
    roomId: "fake-room-id",
    track: undefined,
    trackComposite: undefined,
    web: {
      preset: EncodingOptionsPreset.H264_1080P_60,
      streamOutputs: [
        {
          urls: [
            "rtmps://12b43280e4c2.global-contribute.live-video.net:443/app/1321234123123",
          ],
        },
      ],
      url: "https://videojs.github.io/autoplay-tests/plain/attr/autoplay-playsinline.html",
    },
  } satisfies Parameters<typeof EgressInfo.create>[0];

  const info = Buffer.from(
    EgressInfo.encode(EgressInfo.create(config)).finish(),
  );
  await valkey.hset(EGRESS_KEY, {
    [egressId]: info,
  });

  const req = StartEgressRequest.encode(StartEgressRequest.create(config));

  const value = Buffer.from(req.finish());

  const channel = "EgressInternal|StartEgress|REQ";

  const msg = Msg.create({
    channel,
    typeUrl: "type.googleapis.com/internal.Request",
    value,
  });
  console.log("file: index.ts~line: 21~msg", msg);

  const encodedMsg = Msg.encode(msg).finish();
  console.log("file: index.ts~line: 29~encodedMsg", encodedMsg);

  return await valkey.publish(channel, Buffer.from(encodedMsg));
}

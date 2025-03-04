import { getValkeyClient } from "./valkey";

import { WebEgressRequest } from "./generated/livekit_egress.proto";

main()
  .then(console.log)
  .catch((err) => {
    console.error(err);

    process.exit(1);
  })
  .then(() => process.exit(0));

async function main() {
  console.log("Starting…");
  const valkey = getValkeyClient({ lazyConnect: false });
  const req = createEgressRequest();
  const msg = req.finish();

  return await valkey.publish(
    "EgressInternal|StartEgress|REQ",
    Buffer.from(msg),
  );
}

function createEgressRequest() {
  const msg = WebEgressRequest.create({
    advanced: {
      width: 1920,
      height: 1080,
    },
    fileOutputs: [
      {
        filepath: "/output/video1.mp4",
      },
    ],
    url: "https://videojs.github.io/autoplay-tests/plain/attr/autoplay-playsinline.html",
  });

  return WebEgressRequest.encode(msg);
}

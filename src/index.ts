import { getValkeyClient } from "./valkey";
import { WebEgressRequest } from "@livekit/protocol";

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

  return;
}

function createEgressRequest() {
  const msg = new WebEgressRequest({
    fileOutputs: [
      {
        filepath: "/output/video1.mp4",
      },
    ],
    url: "https://videojs.github.io/autoplay-tests/plain/attr/autoplay-playsinline.html",
  });
}

import { getLogger } from "@/helpers/logger.ts";

import { makeEgressClient } from "./start-stop-shared.ts";

const logger = getLogger("start-egress");
logger.enableAll();

(async function main() {
  const client = makeEgressClient();
  logger.info("Client created");

  return await client.startEgress({
    sourceUrl:
      "https://videojs.github.io/autoplay-tests/videojs/attr/autoplay-playsinline.html",
    destinationUrls: [
      "rtmps://12b43280e4c2.global-contribute.live-video.net:443/app/sk_us-east-1_qQ9lxBiQwWxf_MEXtHGonSznhP2NhcPw5oHSGvyxN4F",
    ],
  });
})()
  .then(logger.info)
  .catch(logger.error)
  .finally(() => process.exit(0));

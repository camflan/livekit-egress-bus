import { makeEgressClient } from "./start-egress";

(async function main() {
  const client = makeEgressClient();

  return await Promise.allSettled(
    ["EG__Is2QyCUXZx", "EG_ByP3Dv96fW", "EG_WQsNWJB5Sf"].map((egressId) => {
      return client.stopEgress(egressId);
    }),
  );
})()
  .then(console.log)
  .catch(console.error);

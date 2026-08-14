// Read-only snapshot of persisted block schedules and effective client state.
// Run: npx tsx scripts/probe-client-pause-state.mts [device-name]
import { readFileSync } from "node:fs";
import { DishClient, ROUTER_LAN_HANDLE_URL } from "../core/dishClient.ts";

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (String(input) === "local:router-protoset")
    return Promise.resolve(new Response(readFileSync("public/dish.protoset")));
  return nativeFetch(input, init);
};

const client = await DishClient.load("router", {
  handleUrl: ROUTER_LAN_HANDLE_URL,
  protosetUrl: "local:router-protoset",
});
const [config, clients] = await Promise.all([
  client.getWifiConfig(AbortSignal.timeout(5_000)),
  client.getWifiClients(AbortSignal.timeout(5_000)),
]);
const wanted = process.argv.slice(2).join(" ").toLowerCase();
const liveById = new Map(clients.map((entry) => [entry.clientId, entry]));
const rows = (config.clientConfigs ?? [])
  .filter((entry) => {
    const live = liveById.get(entry.clientId);
    const name = String(entry.givenName ?? live?.givenName ?? live?.name ?? "");
    return !wanted || name.toLowerCase().includes(wanted);
  })
  .map((entry) => {
    const live = liveById.get(entry.clientId);
    return {
      name: entry.givenName ?? live?.givenName ?? live?.name ?? "Unnamed device",
      clientId: entry.clientId,
      blocked: live?.blocked ?? false,
      connected: Boolean(live),
      weeklyBlockSchedules: entry.weeklyBlockSchedules ?? [],
    };
  });

console.log(JSON.stringify(rows, null, 2));

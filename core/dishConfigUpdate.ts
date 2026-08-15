import { CONFIG_APPLY_FLAG, type DishClient, type DishConfigJson } from "./dishClient";

export interface DishConfigRequestJson {
  targetId: string;
  dishSetConfig: { dishConfig: Record<string, unknown> };
}

function requestFor(targetId: string, changes: DishConfigJson): DishConfigRequestJson {
  if (!targetId.startsWith("ut")) throw new Error("invalid dish target id");
  const dishConfig: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    dishConfig[field] = value;
    dishConfig[CONFIG_APPLY_FLAG[field as keyof DishConfigJson]] = true;
  }
  return { targetId, dishSetConfig: { dishConfig } };
}

/** Trusted-host preparation: source the dish's own identity directly from the
 *  LAN immediately before encoding the cloud write, the same way router client
 *  updates do. Unlike a client update, this touches only the fields present in
 *  `changes` — the device merges by apply flag, so no existing state needs
 *  reading first and no write can race an unrelated field's write. */
export async function prepareDishConfigUpdate(
  dish: DishClient,
  changes: DishConfigJson,
): Promise<Uint8Array> {
  const deviceInfo = await dish.getDeviceInfo(AbortSignal.timeout(5_000));
  const targetId = deviceInfo.id;
  if (!targetId) throw new Error("Starlink dish identity is unavailable");
  return dish.encodeRequest(requestFor(targetId, changes));
}

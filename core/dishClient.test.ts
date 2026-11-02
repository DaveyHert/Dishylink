import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DishClient } from "./dishClient";

const sentRequests: Uint8Array[] = [];

vi.mock("./grpcWeb", () => ({
  grpcWebUnaryCall: async (_url: string, requestBytes: Uint8Array) => {
    sentRequests.push(requestBytes);
    return new Uint8Array();
  },
}));

const protosetBytes = new Uint8Array(
  readFileSync(new URL("../public/dish.protoset", import.meta.url)),
);
const requestSchema = createFileRegistry(
  fromBinary(FileDescriptorSetSchema, protosetBytes),
).getMessage("SpaceX.API.Device.Request")!;

function lastRequest(): unknown {
  return toJson(requestSchema, fromBinary(requestSchema, sentRequests.at(-1)!));
}

beforeEach(() => {
  sentRequests.length = 0;
});

describe("factory resets", () => {
  test("given: the dish, should: send its own dish_factory_reset, flagged as an app reset", async () => {
    const dish = await DishClient.load("dish", { protosetBytes });
    await dish.dishFactoryReset();
    expect(lastRequest()).toEqual({ dishFactoryReset: { appReset: true } });
  });

  test("given: the router, should: send the generic factory_reset", async () => {
    const router = await DishClient.load("router", { protosetBytes });
    await router.factoryReset();
    expect(lastRequest()).toEqual({ factoryReset: {} });
  });
});

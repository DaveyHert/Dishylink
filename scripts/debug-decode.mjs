import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const protosetBytes = readFileSync("public/dish.protoset");
const fileDescriptorSet = fromBinary(FileDescriptorSetSchema, protosetBytes);
console.log("descriptor files:", fileDescriptorSet.file.map((file) => file.name).join(", "));
const registry = createFileRegistry(fileDescriptorSet);
const responseSchema = registry.getMessage("SpaceX.API.Device.Response");
console.log("response schema found:", !!responseSchema);

const body = readFileSync(process.argv[2]);
const frameLength = new DataView(body.buffer, body.byteOffset + 1, 4).getUint32(0, false);
const messageBytes = body.subarray(5, 5 + frameLength);
const responseMessage = fromBinary(responseSchema, messageBytes);
const responseJson = toJson(responseSchema, responseMessage, { registry });
console.log(JSON.stringify(responseJson.dishGetStatus, null, 2).slice(0, 600));

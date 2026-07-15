import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });

const probeResult = await page.evaluate(async () => {
  const report = {};
  try {
    const protosetResponse = await fetch("/dish.protoset");
    const protosetBytes = new Uint8Array(await protosetResponse.arrayBuffer());
    report.protoset = { status: protosetResponse.status, bytes: protosetBytes.length };

    const grpcResponse = await fetch("/dishy/SpaceX.API.Device.Device/Handle", {
      method: "POST",
      headers: { "Content-Type": "application/grpc-web+proto", "X-Grpc-Web": "1" },
      body: new Uint8Array([0, 0, 0, 0, 3, 0xe2, 0x3e, 0]),
    });
    const grpcBody = new Uint8Array(await grpcResponse.arrayBuffer());
    report.grpc = {
      status: grpcResponse.status,
      contentType: grpcResponse.headers.get("content-type"),
      grpcStatusHeader: grpcResponse.headers.get("grpc-status"),
      bodyBytes: grpcBody.length,
      firstBytes: Array.from(grpcBody.slice(0, 8)),
    };
  } catch (probeError) {
    report.error = String(probeError && probeError.stack ? probeError.stack : probeError);
  }
  return report;
});

console.log(JSON.stringify(probeResult, null, 2));
await browser.close();

// Minimal grpc-web unary transport over fetch.
//
// grpc-web wire format: each frame is a 1-byte flag + 4-byte big-endian
// length + payload. Flag 0x00 = protobuf message, 0x80 = text trailers
// ("grpc-status: 0\r\n..."). A unary call sends one message frame and
// receives one message frame followed by a trailers frame (or, on errors,
// the status arrives as HTTP headers with no body).

const MESSAGE_FRAME = 0x00;
const TRAILERS_FRAME = 0x80;

export class GrpcWebError extends Error {
  constructor(
    public readonly grpcStatus: number,
    grpcMessage: string,
  ) {
    super(`grpc-web call failed (status ${grpcStatus}): ${grpcMessage}`);
    this.name = "GrpcWebError";
  }
}

function encodeFrame(messageBytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + messageBytes.length);
  frame[0] = MESSAGE_FRAME;
  new DataView(frame.buffer).setUint32(1, messageBytes.length, false);
  frame.set(messageBytes, 5);
  return frame;
}

function parseTrailers(trailerText: string): { status: number; message: string } {
  let status = 0;
  let message = "";
  for (const line of trailerText.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "grpc-status") status = Number(value);
    if (key === "grpc-message") message = decodeURIComponent(value);
  }
  return { status, message };
}

/** Perform a unary grpc-web call and return the response message bytes. */
export async function grpcWebUnaryCall(
  methodUrl: string,
  requestBytes: Uint8Array,
  abortSignal?: AbortSignal,
  options: {
    fetch?: typeof fetch;
    headers?: Record<string, string>;
  } = {},
): Promise<Uint8Array> {
  const doFetch = options.fetch ?? fetch;
  const httpResponse = await doFetch(methodUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/grpc-web+proto",
      "X-Grpc-Web": "1",
      ...options.headers,
    },
    body: encodeFrame(requestBytes) as unknown as BodyInit,
    signal: abortSignal ?? null,
  });

  // Trailers-only responses carry the status in HTTP headers.
  const headerStatus = httpResponse.headers.get("grpc-status");
  if (headerStatus !== null && Number(headerStatus) !== 0) {
    throw new GrpcWebError(
      Number(headerStatus),
      httpResponse.headers.get("grpc-message") ?? "unknown error",
    );
  }
  if (!httpResponse.ok) {
    throw new GrpcWebError(
      httpResponse.status === 401 || httpResponse.status === 403 ? 16 : 2,
      `HTTP ${httpResponse.status}`,
    );
  }

  const body = new Uint8Array(await httpResponse.arrayBuffer());
  let responseMessage: Uint8Array | null = null;
  let readOffset = 0;
  while (readOffset + 5 <= body.length) {
    const frameFlag = body[readOffset];
    const frameLength = new DataView(body.buffer, body.byteOffset + readOffset + 1, 4).getUint32(
      0,
      false,
    );
    const framePayload = body.subarray(readOffset + 5, readOffset + 5 + frameLength);
    readOffset += 5 + frameLength;

    if (frameFlag === MESSAGE_FRAME) {
      responseMessage = framePayload;
    } else if (frameFlag & TRAILERS_FRAME) {
      const trailers = parseTrailers(new TextDecoder().decode(framePayload));
      if (trailers.status !== 0) throw new GrpcWebError(trailers.status, trailers.message);
    }
  }

  if (responseMessage === null) {
    throw new GrpcWebError(2, "response contained no message frame");
  }
  return responseMessage;
}

// A failed account read must not strand the controls behind it. Turning bypass
// on is what breaks this request, and the switch that undoes bypass is disabled
// while it reads error, so a read that never retries locks the user out.

import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { CloudNotConnectedError } from "../lib/starlinkCloud";

const fetchCloudAccount = vi.fn();

vi.mock("../lib/starlinkCloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/starlinkCloud")>();
  return {
    ...actual,
    fetchCloudAccount: () => fetchCloudAccount(),
    fetchCloudUsage: () => Promise.resolve({}),
    fetchCloudRouterSubnet: () => Promise.resolve(""),
  };
});

vi.mock("../lib/cloudHost", () => ({
  subscribeCloudSession: () => () => {},
  cloudRequest: () => Promise.resolve({ status: 200, body: {} }),
}));

/** Re-imported per test so the module-level store starts empty each time. */
async function mountAccount(): Promise<{
  status: () => string;
  data: () => unknown;
  reload: () => void;
}> {
  const { useCloudAccount } = await import("./useCloudAccount");
  let latest = "loading";
  let held: unknown = null;
  let again: () => void = () => {};
  function Probe() {
    const account = useCloudAccount(true);
    latest = account.status;
    held = account.data;
    again = account.reload;
    return <span data-testid='status'>{latest}</span>;
  }
  render(<Probe />);
  return { status: () => latest, data: () => held, reload: () => again() };
}

async function settle(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.resetModules();
  fetchCloudAccount.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

test("given: a transport failure, should: recover on its own without a reload", async () => {
  fetchCloudAccount
    .mockRejectedValueOnce(new Error("connect ENETUNREACH"))
    .mockResolvedValue({ deviceTelemetry: {} });

  const { status } = await mountAccount();
  await vi.waitFor(() => expect(status()).toBe("error"));

  // Nothing here calls reload: the whole point is that the store retries itself,
  // because the control that would trigger a reload is disabled while it fails.
  await vi.waitFor(() => expect(status()).toBe("ready"), { timeout: 8_000 });
  expect(fetchCloudAccount.mock.calls.length).toBeGreaterThan(1);
});

// The captions on the bypass row are keyed to this data. Dropping it on a failure
// swings each of them once per retry, which the panel's height animation chases.
test("given: a transport failure over an answer already held, should: keep it", async () => {
  const account = { deviceTelemetry: { "Router-1": { kind: "router", hops: 0 } } };
  fetchCloudAccount
    .mockResolvedValueOnce(account)
    .mockRejectedValue(new Error("connect ENETUNREACH"));

  const { status, data, reload } = await mountAccount();
  await vi.waitFor(() => expect(status()).toBe("ready"));

  reload();
  await vi.waitFor(() => expect(status()).toBe("error"));
  expect(data()).toEqual(account);
});

// A refused session is an answer, so it does replace what was held.
test("given: a session refused over an answer already held, should: drop it", async () => {
  fetchCloudAccount
    .mockResolvedValueOnce({ deviceTelemetry: {} })
    .mockRejectedValue(new CloudNotConnectedError());

  const { status, data, reload } = await mountAccount();
  await vi.waitFor(() => expect(status()).toBe("ready"));

  reload();
  await vi.waitFor(() => expect(status()).toBe("not-connected"));
  expect(data()).toBeNull();
});

test("given: no session, should: stay answered rather than dialling forever", async () => {
  fetchCloudAccount.mockRejectedValue(new CloudNotConnectedError());

  const { status } = await mountAccount();
  await vi.waitFor(() => expect(status()).toBe("not-connected"));

  const askedOnce = fetchCloudAccount.mock.calls.length;
  await settle(3_000);
  expect(fetchCloudAccount.mock.calls.length).toBe(askedOnce);
  expect(status()).toBe("not-connected");
});

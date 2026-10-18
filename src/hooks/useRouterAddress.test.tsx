import { expect, test, vi, afterEach } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { setRouterAddressHost, type RouterAddress } from "../lib/routerAddressHost";
import { useRouterAddressState } from "./useRouterAddress";

const DEFAULT: RouterAddress = { router: null, routerDefault: "192.168.1.1" };

afterEach(() => cleanup());

test("a save in one component reaches every other reader without a remount", async () => {
  const read = vi.fn(() => Promise.resolve(DEFAULT));
  setRouterAddressHost({ read, write: () => Promise.reject(new Error("unused")) });

  let save: ((next: RouterAddress) => void) | null = null;
  function Settings() {
    const [addresses, setAddresses] = useRouterAddressState();
    save = setAddresses;
    return <p data-testid='settings'>{addresses?.router ?? "default"}</p>;
  }
  function Diagnosis() {
    const [addresses] = useRouterAddressState();
    return <p data-testid='diagnosis'>{addresses ? (addresses.router ?? "default") : "unread"}</p>;
  }
  await render(
    <>
      <Settings />
      <Diagnosis />
    </>,
  );
  const text = (id: string) => document.querySelector(`[data-testid=${id}]`)?.textContent;

  await expect.poll(() => text("diagnosis")).toBe("default");
  save!({ router: "192.168.2.1", routerDefault: "192.168.1.1" });

  await expect.poll(() => text("diagnosis")).toBe("192.168.2.1");
  expect(text("settings")).toBe("192.168.2.1");
  // Two readers, one trip to the host: the value is shared, not fetched per component.
  expect(read).toHaveBeenCalledTimes(1);
});

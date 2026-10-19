import { afterEach, expect, test, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { WifiClientJson } from "@core/dishClient";
import { DeviceNameEditor, MeshNodeNameEditor } from "./DeviceNameEditor";

afterEach(cleanup);

function saveButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === "Save",
  );
  if (!found) throw new Error('no button labelled "Save"');
  return found as HTMLButtonElement;
}

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("mesh editor seeds the stored name and does not offer to save it unchanged", async () => {
  render(
    <MeshNodeNameEditor
      deviceId='Router-01000000000000000049375B'
      currentName='Mesh 1'
      onRename={vi.fn().mockResolvedValue(undefined)}
      onDone={() => {}}
    />,
  );
  await settle();

  expect((document.querySelector("input") as HTMLInputElement).value).toBe("Mesh 1");
  expect(saveButton().disabled).toBe(true);
});

test("mesh editor sends the trimmed name against the device id", async () => {
  const onRename = vi.fn().mockResolvedValue(undefined);
  const onDone = vi.fn();
  render(
    <MeshNodeNameEditor
      deviceId='Router-01000000000000000049375B'
      currentName='Mesh 1'
      onRename={onRename}
      onDone={onDone}
    />,
  );

  await page.getByPlaceholder("Node name").fill("  Garage  ");
  expect(saveButton().disabled).toBe(false);
  saveButton().click();
  await settle();

  expect(onRename).toHaveBeenCalledWith("Router-01000000000000000049375B", "Garage");
  expect(onDone).toHaveBeenCalled();
});

test("mesh editor keeps save closed for a name that is only whitespace", async () => {
  render(
    <MeshNodeNameEditor
      deviceId='Router-01000000000000000049375B'
      currentName='Mesh 1'
      onRename={vi.fn()}
      onDone={() => {}}
    />,
  );

  await page.getByPlaceholder("Node name").fill("   ");
  expect(saveButton().disabled).toBe(true);
});

test("device editor sends the new name against the clientId", async () => {
  const client = { clientId: 7, name: "hostname", givenName: "Nanoleaf" } as WifiClientJson;
  const onRename = vi.fn().mockResolvedValue(undefined);
  render(<DeviceNameEditor client={client} onRename={onRename} onDone={() => {}} />);

  await settle();
  expect(saveButton().disabled).toBe(true);
  await page.getByPlaceholder("Device name").fill("Living room light");
  saveButton().click();
  await settle();

  expect(onRename).toHaveBeenCalledWith(7, "Living room light");
});

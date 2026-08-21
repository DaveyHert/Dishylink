import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { CustomDnsSection } from "./CustomDnsSection";

afterEach(cleanup);

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input")];
}

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type Props = React.ComponentProps<typeof CustomDnsSection>;

function mount(overrides: Partial<Props> = {}) {
  const onSave = vi.fn<Props["onSave"]>().mockResolvedValue(undefined);
  const props: Props = { nameservers: [], disabled: false, onSave, ...overrides };

  let publish: (nameservers: string[]) => void = () => {};
  function Holder() {
    const [nameservers, setNameservers] = useState(props.nameservers);
    publish = setNameservers;
    return <CustomDnsSection {...props} nameservers={nameservers} />;
  }
  render(<Holder />);

  return { onSave, reportNow: (nameservers: string[]) => publish(nameservers) };
}

describe("CustomDnsSection", () => {
  test("starts collapsed when the router has no custom resolvers configured", async () => {
    mount({ nameservers: [] });
    await expect.element(page.getByRole("switch")).toBeInTheDocument();

    expect(page.getByRole("switch").element().getAttribute("aria-checked")).toBe("false");
    expect(inputs()).toHaveLength(0);
  });

  test("starts expanded and pre-filled when the router already has custom resolvers", async () => {
    mount({ nameservers: ["9.9.9.9", "149.112.112.112"] });
    await expect.element(page.getByPlaceholder("1.1.1.1")).toBeInTheDocument();

    expect(page.getByRole("switch").element().getAttribute("aria-checked")).toBe("true");
    const values = inputs().map((input) => input.value);
    expect(values).toEqual(["9.9.9.9", "149.112.112.112", "", ""]);
  });

  test("Save stays disabled until every filled field parses and the primary is set", async () => {
    mount({ nameservers: ["1.1.1.1"] });
    const primary = page.getByPlaceholder("1.1.1.1");
    const save = page.getByRole("button", { name: "Save" });
    await expect.element(save).toBeInTheDocument();
    expect(save.element().hasAttribute("disabled")).toBe(true); // unchanged from what the router reports

    await primary.fill("not-an-address");
    await settle();
    expect(save.element().hasAttribute("disabled")).toBe(true);

    await primary.fill("8.8.8.8");
    await settle();
    expect(save.element().hasAttribute("disabled")).toBe(false);
  });

  test("Save sends the compacted, trimmed list", async () => {
    const { onSave } = mount({ nameservers: ["1.1.1.1"] });
    await page.getByPlaceholder("1.0.0.1").fill("  1.0.0.1  ");

    await page.getByRole("button", { name: "Save" }).click();
    await settle();
    expect(onSave).toHaveBeenCalledWith(["1.1.1.1", "1.0.0.1"]);
  });

  test("turning the switch off sends the empty list immediately, with no Save press", async () => {
    const { onSave } = mount({ nameservers: ["1.1.1.1"] });
    await page.getByRole("switch").click();
    await settle();
    expect(onSave).toHaveBeenCalledWith([]);
  });

  test("turning the switch on with nothing typed sends nothing — there is no Save button yet", async () => {
    const { onSave } = mount({ nameservers: [] });
    await page.getByRole("switch").click();
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(inputs()).toHaveLength(4);
  });

  test("follows a change the router reports out from under a stale draft", async () => {
    const { reportNow } = mount({ nameservers: ["1.1.1.1"] });
    await page.getByPlaceholder("1.0.0.1").fill("1.0.0.1");

    reportNow(["9.9.9.9"]);
    await settle();

    const values = inputs().map((input) => input.value);
    expect(values).toEqual(["9.9.9.9", "", "", ""]);
  });

  test("disables every control when there is no account to send the write through", async () => {
    mount({ nameservers: ["1.1.1.1"], disabled: true });
    const save = page.getByRole("button", { name: "Save" });
    await expect.element(save).toBeInTheDocument();

    expect(page.getByRole("switch").element().hasAttribute("disabled")).toBe(true);
    for (const input of inputs()) expect(input.disabled).toBe(true);
    expect(save.element().hasAttribute("disabled")).toBe(true);
  });
});

// Settings modal (gear icon): dish config + maintenance on the Starlink tab,
// network info + reboot on the Router tab — layout mirrors the official app.
// Chrome is the shadcn Dialog; the segment control, buttons and typography use
// the DishyLink design language.
//
// What is left here is the shell: the dialog, the tab switch, and the height
// animation between the two panels. Each tab's content is its own component.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DishClient, type DishStatusJson, type WifiNetworkConfigJson } from "../../lib/dishClient";
import { useDishSettings } from "../../hooks/useDishSettings";
import { specForHardware } from "../../lib/dishMesh";
import { RouterSettingsTab } from "./RouterSettingsTab";
import { StarlinkSettingsTab } from "./StarlinkSettingsTab";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  status: DishStatusJson | null;
  hardwareVersion?: string;
  wifiConfig: WifiNetworkConfigJson | null;
  routerReachable: boolean | null;
}

export function SettingsModal({
  open,
  onClose,
  status,
  hardwareVersion,
  wifiConfig,
  routerReachable,
}: SettingsModalProps) {
  const [tab, setTab] = useState<"starlink" | "router">("starlink");
  const settings = useDishSettings(open);

  // Animate the body height: measure the active panel and cap at 68vh (inner
  // scrolls past that), so switching tabs eases between the two heights.
  const panelRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () =>
      setBodyHeight(Math.min(panel.scrollHeight, Math.round(window.innerHeight * 0.68)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tab, open, settings.config, settings.error]);

  const isMotorized = specForHardware(hardwareVersion).mount === "mast";

  // One lazily-created client, reused by every dish action in the sheet.
  const dishClient = useMemo(() => ({ current: null as Promise<DishClient> | null }), []);
  const loadDish = () => (dishClient.current ??= DishClient.load("dish"));

  const copyDiagnostics = async (): Promise<"copied" | "failed"> => {
    try {
      const client = await loadDish();
      const [diagnostics, deviceInfo] = await Promise.all([
        client.getDiagnostics(),
        client.getDeviceInfo(),
      ]);
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            deviceInfo,
            diagnostics,
            status,
            config: settings.config,
          },
          null,
          2,
        ),
      );
      return "copied";
    } catch {
      return "failed";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(stillOpen) => !stillOpen && onClose()}>
      <DialogContent className='max-w-md bg-card border-border p-0 gap-0' showCloseButton={false}>
        <DialogHeader className='flex flex-row items-center justify-between px-5 pt-[12px] pb-1 text-left'>
          <DialogTitle className='text-[17px] font-semibold tracking-[0.01em]'>
            Settings
          </DialogTitle>
          <button
            className='inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-full border-0 bg-[color-mix(in_srgb,var(--ink)_6%,var(--surface))] text-[13px] leading-none text-[color:var(--ink-secondary)] transition-colors hover:text-foreground'
            onClick={onClose}
            aria-label='Close'
          >
            ✕
          </button>
        </DialogHeader>

        <div className='px-5 pt-2 pb-1.5'>
          <SegmentedControl
            variant='glider'
            label='Settings section'
            value={tab}
            onChange={setTab}
            options={[
              { value: "starlink", label: "Starlink" },
              { value: "router", label: "Router" },
            ]}
          />
        </div>

        <div
          className='overflow-hidden transition-[height] duration-[240ms] ease-[cubic-bezier(0.4,0,0.2,1)]'
          style={{ height: bodyHeight }}
        >
          <div className='thin-scroll max-h-[68vh] overflow-y-auto px-5 pt-1 pb-5' ref={panelRef}>
            {tab === "starlink" && (
              <StarlinkSettingsTab
                settings={settings}
                status={status}
                isMotorized={isMotorized}
                loadDish={loadDish}
                onCopyDiagnostics={copyDiagnostics}
              />
            )}
            {tab === "router" && (
              <RouterSettingsTab wifiConfig={wifiConfig} routerReachable={routerReachable} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

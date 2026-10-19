// A band switch's own detail, as the official app shows it: the band the device
// left and the band it joined above the explanation, the device below it. The
// device card is the network list's own row, fed from the recorder's device list
// (which outlives a device dropping off the network), so it names and labels the
// device exactly as the list does and opens the same device details.

import { useTranslation } from "react-i18next";
import type { BandSwitch } from "@core/telemetry";
import type { WifiClientJson } from "@core/dishClient";
import type { ClientUsageTotal } from "@core/clientUsage";
import { Badge } from "../ui/badge";
import { radioBandLabel } from "../network/networkFormat";
import { DeviceRow } from "../network/NetworkRow";
import { usePolledEndpoint } from "../../hooks/usePolledEndpoint";
import { useSelfIdentity } from "../../hooks/useSelfIdentity";

const NO_TOTALS: ClientUsageTotal[] = [];

function pickTotals(body: unknown): ClientUsageTotal[] {
  return (body as { totals?: ClientUsageTotal[] }).totals ?? NO_TOTALS;
}

export function BandSwitchBands({ bandSwitch }: { bandSwitch: BandSwitch }) {
  const { t } = useTranslation();
  return (
    <div className='mt-3 flex items-center gap-2.5'>
      <Badge variant='spec' className='text-[12px]'>
        {radioBandLabel(bandSwitch.fromBand, t)}
      </Badge>
      <span aria-label={t("eventDetail.bandSwitchTo")} className='text-muted-foreground'>
        →
      </span>
      <Badge variant='spec' className='text-[12px]'>
        {radioBandLabel(bandSwitch.toBand, t)}
      </Badge>
    </div>
  );
}

export function BandSwitchDevice({
  bandSwitch,
  onOpenDevice,
}: {
  bandSwitch: BandSwitch;
  onOpenDevice?: (entryKey: string) => void;
}) {
  const totals = usePolledEndpoint("/api/clients/totals", pickTotals, NO_TOTALS);
  const { self } = useSelfIdentity();
  const known = totals.find((total) => total.clientId === bandSwitch.clientId);
  // The band it joined stands in for the live interface the list would show.
  const client: WifiClientJson = {
    clientId: bandSwitch.clientId,
    macAddress: known?.macAddress,
    name: known?.name,
    ipAddress: known?.ipAddress,
    iface: bandSwitch.toBand,
  };

  return (
    <div className='mt-4'>
      <DeviceRow
        client={client}
        self={self}
        onSelect={(entryKey) => entryKey && onOpenDevice?.(entryKey)}
      />
    </div>
  );
}

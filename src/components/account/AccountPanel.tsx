// Portal-style account view from the user's own starlink.com session: identity,
// plan, service address, and the dish/router device list. The same optional
// session also authorizes supported router controls from local device surfaces.
//
// What is left here is the page: fetch state, and the four cards. The device
// browser is its own component, and the list it renders is built by a pure
// function beside it.

import { useCloudAccount } from "../../hooks/useCloudAccount";
import { disconnectCloud } from "../../lib/starlinkCloud";
import { Loading } from "../ui/loading";
import { Callout } from "../ui/callout";
import { inlineLinkButton } from "../ui/action-button";
import { Badge } from "../ui/badge";
import { ConnectAccount } from "../shared/ConnectAccount";
import { Card, Field } from "./accountChrome";
import { DevicesSection } from "./DevicesSection";

export function AccountPanel({ lanOnline }: { lanOnline: ReadonlySet<string> }) {
  const { data, status, reload } = useCloudAccount(true);

  if (status === "not-connected") {
    return (
      <div className='flex min-h-[360px] items-center justify-center px-4 py-8'>
        <ConnectAccount onConnected={reload} />
      </div>
    );
  }
  if (status === "error") {
    return (
      <Callout tone='error' className='mt-2.5'>
        Couldn’t reach your Starlink account.{" "}
        <button type='button' className={inlineLinkButton} onClick={reload}>
          Try again
        </button>
      </Callout>
    );
  }
  if (status === "loading" || !data) {
    return <Loading message='Loading your Starlink account…' size={26} stacked />;
  }

  const identity = data.identity;
  const line = data.serviceLine?.content;
  const address = line?.serviceAddress;
  const sub = line?.subscription;
  const terminals = line?.userTerminals ?? [];

  return (
    <div className='flex flex-col gap-3.5 pb-2'>
      <Card
        title='Profile'
        meta={
          <button
            type='button'
            // Reload either way: the local session file is cleared before the
            // request can fail, so a swallowed error must not leave the panel
            // showing a connected account that no longer is.
            onClick={() => void disconnectCloud().finally(reload)}
            className='card-meta cursor-pointer border-0 bg-transparent underline underline-offset-2 hover:text-foreground'
          >
            Disconnect
          </button>
        }
      >
        <div className='grid grid-cols-3 gap-4 max-[820px]:grid-cols-1 '>
          <Field label='Name'>{identity?.name ?? "—"}</Field>
          <Field label='Email'>{identity?.email ?? "—"}</Field>
          <Field label='Account'>
            <span className='mono-value'>
              {identity?.accountId ?? line?.accountReferenceId ?? "—"}
            </span>
          </Field>
        </div>
      </Card>

      <div className='grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1'>
        <Card title='Service plan'>
          <div className='flex flex-col gap-4'>
            <Field label='Plan'>
              <span className='inline-flex items-center gap-2'>
                {sub?.productDescription ?? "—"}
                {sub?.active && (
                  <Badge variant='status' tone='good'>
                    Active
                  </Badge>
                )}
              </span>
            </Field>
            <Field label='Service line'>
              <span className='mono-value'>{line?.serviceLineNumber ?? "—"}</span>
            </Field>
            <Field label='Active since'>
              {sub?.startDate ? new Date(sub.startDate).toLocaleDateString() : "—"}
            </Field>
          </div>
        </Card>

        <Card title='Service location'>
          <div className='flex flex-col gap-4'>
            <Field label='Address'>
              {address?.formattedAddress ?? `${address?.locality ?? ""}, ${address?.region ?? ""}`}
            </Field>
            {address?.geoLocation?.latitude != null && (
              <Field label='Coordinates'>
                <span className='mono-value'>
                  {address.geoLocation.latitude.toFixed(4)},{" "}
                  {address.geoLocation.longitude?.toFixed(4)}
                </span>
              </Field>
            )}
          </div>
        </Card>
      </div>

      <Card
        title='Devices'
        meta={
          <span className='text-[12px] font-medium text-muted-foreground'>
            {terminals.length} terminal{terminals.length === 1 ? "" : "s"}
          </span>
        }
      >
        <DevicesSection
          terminals={terminals}
          deviceTelemetry={data.deviceTelemetry ?? {}}
          lanOnline={lanOnline}
        />
      </Card>
    </div>
  );
}

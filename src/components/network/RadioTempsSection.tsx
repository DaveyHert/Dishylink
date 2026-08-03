// Per-radio temperature readout on the router's node detail.

import type { RadioReading } from "../../hooks/useRadioTemps";
import { InfoDot } from "../shared/InfoDot";
import { DataRow, SectionHeading } from "./DataRow";
import { radioBandLabel } from "./networkFormat";

/**
 * The router states no unit for the sensor, so the number is shown bare with a
 * degree mark, never "°C". Duty cycle sits beside it because the two together
 * are the signal: a radio below 100% while warming is the router throttling
 * Wi-Fi to cool itself — highlighted so it reads as the event it is.
 */
export function RadioTempsSection({ radios }: { radios: RadioReading[] }) {
  if (radios.length === 0) return null;
  return (
    <>
      <SectionHeading title='Radio temperatures'>
        <InfoDot tip="How warm each of the router's Wi-Fi radios is running. If one gets too hot, the router slows that band's Wi-Fi down to cool off — you'll see that noted here when it happens." />
      </SectionHeading>
      <div className='flex flex-col'>
        {radios.map((radio) => {
          // dutyCycle is the share of transmit airtime the radio is ALLOWED,
          // which the router cuts to cool a hot radio — not how busy the channel
          // is. So 100 is the healthy state, and rendering it as "100%"
          // read as "completely saturated": the opposite of what it means, on
          // every radio, permanently. Say nothing when nothing is wrong.
          const throttling = radio.dutyCycle < 100;
          return (
            <DataRow
              key={radio.band}
              label={radioBandLabel(radio.band)}
              value={
                <>
                  {radio.tempC}°
                  {throttling && (
                    <span style={{ color: "var(--status-critical)" }}>
                      {" · "}
                      throttled to {radio.dutyCycle}%
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </>
  );
}

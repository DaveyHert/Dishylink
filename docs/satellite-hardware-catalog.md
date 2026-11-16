# Satellite hardware labels

Satellite callouts show hardware version and NORAD catalog ID. Unknown IDs show
`Unknown`; names and numeric ranges never determine hardware. The existing DTC
badge still reflects the TLE name, independently of hardware classification.

## Source and attribution

Snapshot: GCAT release 1.8.8, updated `2026 Oct 2 2148:05`, retrieved 2026-10-03.

GCAT, Jonathan McDowell, <https://planet4589.org/space/gcat>, CC-BY-4.0.
Source table: <https://planet4589.org/space/gcat/tsv/cat/satcat.tsv>.
Classification reference: <https://planet4589.org/space/con/star/stats.html>.
This project derives a compressed membership catalog from those records.

| Source classification                                    | Display label     | Entries |
| -------------------------------------------------------- | ----------------- | ------: |
| `Starlink`, `PLName` matching `^Starlink Group ?[2345]-` | V1.5              |    2938 |
| `Starlink V2M`                                           | V2 Mini           |    2760 |
| `Starlink V2MD`                                          | V2 Mini DTC       |     663 |
| `Starlink V2MO`                                          | V2 Mini Optimized |    4341 |

Other records remain unclassified. Classification is a dated catalog observation,
not live firmware information or proof of which satellite serves the dish.

## Static representation and updates

All hardware labels use the bundled `src/lib/satelliteHardwareCatalog.json`
exclusively. No GCAT fetch or other new network request occurs at startup;
existing TLE loading stays unchanged. The catalog retains explicit five-digit
NORAD IDs.
Each three-digit prefix maps to 25 hex digits encoding suffixes 00 through 99.
Suffix `s` uses bit `s % 4` in hex digit `floor(s / 4)`, low bit first.
Gaps remain absent. No interval expansion or name-based inference occurs.

TLE columns 3 through 7 retain string identity, including leading zeros and
Alpha-5 IDs. Both TLE lines must agree. Alpha-5 IDs absent from this numeric
snapshot remain unknown. Tracker resolves metadata once during construction.
No new router poll, cloud request, or hardware command is introduced.

To refresh:

1. Download the public source table and retain its source timestamp and license.
2. Split tab-delimited rows using header column indices. Apply the classification
   rules above to `Bus`, `PLName`, and exact five-digit `Satcat` values.
3. Deduplicate IDs, encode explicit membership, and update snapshot attribution.
4. Verify decoded IDs equal the source set, verify version counts and uniqueness,
   and run resolver, tracker, and callout tests. Update count assertions only
   after checking the source changes.

## UI scope

Existing callout typography, colors, spacing, and two-column grid stay unchanged:
metadata belongs beside existing telemetry, not in a redesigned panel. Unknown
values remain explicit. Labels add no control, icon, or animation. Hardware-specific
3D model mapping is documented in `local-satellite-preview.md`; Unknown retains
the original legacy mesh, and V3 requires explicit metadata.

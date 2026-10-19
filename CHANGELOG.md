# Changelog

All notable changes to Dishylink are documented here.

## [1.2.0] - 2026-09-18

### Device usage

- Dishylink no longer charges its own checks to the device it runs on. It
  measures what its own polling costs and takes that out before a figure is
  stored, so the machine you run it on shows the usage you made, not the usage
  of watching. Satellite lookups are no longer counted against it either, and
  stored rows keep their raw figures.
- The note explaining that a device's figure still includes Dishylink's own
  checks now appears only where you can act on it.

### Network rules

- A wired device now says so in the rule picker. The router keeps no byte
  counters for wired clients, so a data allowance has nothing to measure there.
  Hours can still be ruled with a schedule or a timer.
- The picker lists every device on the network, not only the ones a usage
  record exists for.
- A rule, or a device's place in a group, is no longer lost while the device is
  away. Absence was being read as deletion. A rule ends when you delete the
  rule, or delete the device's record.
- A device whose records were merged opens its own limit again, rather than an
  empty one.

### Latency

- Latency quality history, with per-minute histograms and its own dashboard.
  (#34)

### Desktop, browser and hosting

- The macOS menu bar icon can match the rest of the menu bar, or be hidden so
  only the throughput readout shows. (#38)
- Opening Dishylink while it is already running brings the open window forward
  instead of failing. (#43)
- Mesh nodes can be renamed from the Nodes tab.
- The web dashboard and the history recorder ship as Docker images. (#16)
- Dishylink is now on the Edge Add-ons store.

### Also added

- Dishylink asks once whether you would rate it, and separately whether you
  would help fund it. "Maybe later" brings it back in two days, "Don't ask
  again" ends it, and acting on either ask ends it for good.

### Fixed

- The history recorder no longer trips over its own data directory when a
  second copy starts inside the same process.

## [1.1.0] - 2026-08-22

### Network rules

- Put a rule on a single device, or on a group of them, in one of three forms:
  a **limit** that pauses once a set amount of data is used, a **schedule** that
  pauses outside the hours you set, or a **timer** that pauses once a countdown
  runs out.
- A limit runs on a daily, weekly, monthly, custom, Starlink billing-cycle, or
  one-time basis. Across a group its allowance is either pooled between the
  devices or applied to each of them separately.
- A schedule holds several windows, so "4pm to 8pm on weekdays, 9am to 9pm at
  the weekend" is one rule rather than two. Windows run on chosen weekdays or
  between chosen dates, may cross midnight, and keep the hours you set across a
  daylight saving shift.
- A timer counts down from the moment you save it, and runs for at most 24
  hours.
- Devices are automatically paused once a rule is spent, and released when the
  next cycle starts.
- A device's spend carries over correctly when its limit is edited mid-cycle,
  and survives an app or dish restart without double-counting.
- Six months of per-device usage history is now kept.
- A device under a rule is marked in the network list, with the rule and its
  status reachable from the device's drill-in.
- Byte figures of a terabyte or more are now shown in TB.

### Starlink account & cloud control

- Link a Starlink account to read the client roster, dish config, and device
  names through the cloud when the LAN can't serve them, with automatic retry
  and failover between edges if one stops answering.
- Rename and pause devices through the linked account, including from the
  browser extension.
- Dishylink refuses to ever pause the device it's running on, from any
  network.

### Bypass mode

- Switch the router in and out of bypass mode from the app.
- A bypassed router is read as bypassed rather than as missing, so the panels
  say so plainly and its silence on the network raises no alert.

### Router configuration

- Change the router's subnet and DNS servers.
- Reach and manage a router that isn't on the default 192.168.1.1 address.
- Factory reset the router. A router in bypass answers nothing on the local
  network, so its reset goes through the linked account instead.

### Also added

- Factory reset the dish, behind the same armed confirmation as the router's.
- The dish and router's pending software update state now shows on the
  dashboard.
- A time picker for the sleep schedule.
- Live throughput readout in the macOS menu bar, shown by default.
- Severity icons (info/warning/error) now share one component and color scale
  across the app.
- Choose what the browser extension's toolbar badge counts: all alerts, only
  faults a device reported about itself, or nothing at all. Being away from
  your Starlink is indistinguishable from a device that has failed, so the
  middle option leaves both out.

### Fixed

- The desktop app no longer shows "A JavaScript error occurred in the main
  process" when the network drops out from under it: waking from sleep, a VPN
  connecting, or the router being switched into bypass. Faults that are not a
  lost connection still surface exactly as before.
- A router change that timed out no longer claims Starlink rejected it. Nothing
  answered, which is not the same as a refusal.
- A kit with no Starlink router no longer reports "Router isn't answering".
  There is nothing to reach, so the silence is not announced, not counted on
  the bell, and not recorded as an outage. The check still appears in the
  Status list, since it was not run.
- Cross-origin requests to the cloud routes are rejected.
- The historian is served only to the machine it runs on.
- Dashboard layout: more clearance below the last row, a wider default
  window, steadier secondary-button contrast in both themes, and a rename
  button that holds its width while a save is in flight.

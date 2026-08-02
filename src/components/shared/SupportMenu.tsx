import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { HeartIcon } from "../../assets/icons/HeartIcon";
import { StarIcon } from "../../assets/icons/StarIcon";
import { HandHeartIcon } from "../../assets/icons/HandHeartIcon";
import { CoffeeIcon } from "../../assets/icons/CoffeeIcon";
import { PatreonIcon } from "../../assets/icons/PatreonIcon";
import { DownloadIcon } from "../../assets/icons/DownloadIcon";
import { BugIcon } from "../../assets/icons/BugIcon";
import { BulbIcon } from "../../assets/icons/BulbIcon";
import { MailIcon } from "../../assets/icons/MailIcon";
import { ShieldIcon } from "../../assets/icons/ShieldIcon";
import { ScaleIcon } from "../../assets/icons/ScaleIcon";

type IconComponent = React.ComponentType<React.ComponentProps<"svg"> & { size?: number }>;

// Injected at build time from package.json — see vite.config.ts and
// wxt.config.ts's `define`. Bumping package.json's version is the only edit a
// release needs; nothing here goes stale.
const APP_VERSION = __APP_VERSION__;

const REPO = "https://github.com/DaveyHert/dishylink";

const SUPPORT_LINKS = {
  starRepo: REPO,
  githubSponsors: "https://github.com/sponsors/daveyhert",
  buyMeACoffee: "https://buymeacoffee.com/daveyhert",
  patreon: "https://www.patreon.com/DaveyHert",
  latestRelease: `${REPO}/releases/latest`,
  reportIssue: `${REPO}/issues/new?labels=bug`,
  requestFeature: `${REPO}/issues/new?labels=enhancement`,
  contact: "mailto:hello@daveyhert.com",
  privacyPolicy: `${REPO}/blob/master/PRIVACY.md`,
  disclaimer: `${REPO}/blob/master/DISCLAIMER.md`,
};

// Electron's renderer is sandboxed with no shell access, so it has to cross
// the preload bridge to main, which owns `shell.openExternal`. The web dev
// harness and the extension's pages are already a browser tab, so
// `window.open` is the whole job there.
function openExternal(url: string): void {
  if (window.dishlink?.openExternal) {
    window.dishlink.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[13px] text-(--ink) no-underline transition-colors hover:bg-(--hairline)";
const MENU_LABEL =
  "px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-(--ink-muted) uppercase";
const SECTION = "border-b border-solid border-(--hairline) p-1.5 last:border-b-0";

interface MenuLinkItem {
  href: string;
  icon: IconComponent;
  accent?: boolean;
  iconClassName?: string;
  children: React.ReactNode;
}

function MenuLink({ href, icon: Icon, accent, iconClassName, children }: MenuLinkItem) {
  return (
    <button
      type='button'
      className={cn(MENU_ITEM, "cursor-pointer border-0 bg-transparent")}
      onClick={() => openExternal(href)}
    >
      <span
        className={cn(
          "size-[15px] flex-none",
          iconClassName ?? (accent ? "text-(--accent)" : "text-(--ink-secondary)"),
        )}
      >
        <Icon className='size-full' />
      </span>
      {children}
    </button>
  );
}

const SECTIONS: { label: string; items: MenuLinkItem[] }[] = [
  {
    label: "Support development",
    items: [
      { href: SUPPORT_LINKS.starRepo, icon: StarIcon, accent: true, children: "Star project on GitHub" },
      {
        href: SUPPORT_LINKS.githubSponsors,
        icon: HandHeartIcon,
        accent: true,
        children: "Become a GitHub Sponsor",
      },
      {
        href: SUPPORT_LINKS.patreon,
        icon: PatreonIcon,
        accent: true,
        children: "Become a Patreon",
      },
      { href: SUPPORT_LINKS.buyMeACoffee, icon: CoffeeIcon, accent: true, children: "Buy Me a Coffee" },
    ],
  },
  {
    label: "Feedback",
    items: [
      { href: SUPPORT_LINKS.reportIssue, icon: BugIcon, children: "Report an issue" },
      { href: SUPPORT_LINKS.requestFeature, icon: BulbIcon, children: "Request a feature" },
    ],
  },
  {
    label: "Contact",
    items: [{ href: SUPPORT_LINKS.contact, icon: MailIcon, children: "Contact me" }],
  },
  {
    label: "Legal",
    items: [
      { href: SUPPORT_LINKS.privacyPolicy, icon: ShieldIcon, children: "Privacy Policy" },
      { href: SUPPORT_LINKS.disclaimer, icon: ScaleIcon, children: "Disclaimer" },
    ],
  },
];

/** Absent in the browser and extension builds, where there is no packaged build
 *  to check a GitHub release against — window.dishlink.updateState is desktop-only. */
function useUpdateAvailable(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const host = window.dishlink;
    if (!host) return;
    host.updateState().then((state) => setVersion(state.available ? state.version : null));
    return host.onUpdateState((state) => setVersion(state.available ? state.version : null));
  }, []);

  return version;
}

export function SupportMenu() {
  const updateVersion = useUpdateAvailable();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className='relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-card text-(--ink-secondary) transition-colors hover:text-foreground'
          aria-label={updateVersion ? "Support and more (update available)" : "Support and more"}
          title='Support & more'
        >
          <HeartIcon />
          {updateVersion && (
            <span className='absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-semibold leading-none text-destructive-foreground'>
              1
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={10}
        collisionPadding={12}
        // The glass treatment the rail/dock toolbar uses at rest — translucent
        // surface, ink-tinted border, backdrop blur — rather than a flat opaque
        // panel that reads as a different surface family from the rest of the UI.
        className='w-75 overflow-hidden rounded-xl border border-solid border-border/50 bg-[color-mix(in_srgb,var(--surface-raised)_80%,transparent)] dark:bg-[color-mix(in_srgb,#0e0e0e_80%,transparent)] p-0 text-(--ink) shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
      >
        <div className='border-b border-solid border-border/50 px-4 py-3'>
          <div className='flex items-baseline gap-2'>
            <span className='text-[13.5px] font-semibold'>DishyLink</span>
            <span className='font-mono text-[11px] text-(--ink-muted) tabular-nums'>
              v{APP_VERSION}
            </span>
          </div>
        </div>

        {updateVersion && (
          <div className={SECTION}>
            <div className={cn(MENU_LABEL, "flex items-center gap-1.5")}>
              Update available
              <span className='size-1 rounded-full bg-red-500 shadow-[0_0_4px_1.5px_rgba(239,68,68,0.85)]' />
            </div>
            <MenuLink
              href={SUPPORT_LINKS.latestRelease}
              icon={DownloadIcon}
              iconClassName='text-(--status-good)'
            >
              Download v{updateVersion}
            </MenuLink>
          </div>
        )}

        {SECTIONS.map((section) => (
          <div key={section.label} className={SECTION}>
            <div className={MENU_LABEL}>{section.label}</div>
            {section.items.map((item) => (
              <MenuLink key={item.href} {...item} />
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

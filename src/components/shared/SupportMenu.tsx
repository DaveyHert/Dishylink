import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { HeartIcon } from "../../assets/icons/HeartIcon";

// Not imported from package.json: that file sits outside every build target's
// tsconfig `include` (web, Electron, extension each scope their own), so
// pulling it in would need resolveJsonModule wired three times over for one
// string. Bump this alongside the version in package.json instead.
const APP_VERSION = "0.1.0";

const REPO = "https://github.com/DaveyHert/dishylink";

const SUPPORT_LINKS = {
  starRepo: REPO,
  githubSponsors: "https://github.com/sponsors/daveyhert",
  buyMeACoffee: "TODO: buymeacoffee.com handle",
  koFi: "TODO: ko-fi.com handle",
  reportIssue: `${REPO}/issues/new?labels=bug`,
  requestFeature: `${REPO}/issues/new?labels=enhancement`,
  contact: "TODO: contact email or link",
  privacyPolicy: `${REPO}/blob/main/PRIVACY.md`,
  disclaimer: `${REPO}/blob/main/DISCLAIMER.md`,
};

// Electron's renderer is sandboxed with no shell access, so it has to cross
// the preload bridge to main, which owns `shell.openExternal`. The web dev
// harness and the extension's pages are already a browser tab, so
// `window.open` is the whole job there.
function openExternal(url: string): void {
  const bridge = (window as { dishlink?: { openExternal?: (url: string) => void } }).dishlink;
  if (bridge?.openExternal) {
    bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

type IconProps = { className?: string };

function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='m12 17.3-5.8 3.7 1.6-6.6-5.3-4.6 6.7-.6L12 3l2.8 6.2 6.7.6-5.3 4.6 1.6 6.6Z' />
    </svg>
  );
}

function GiftIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='4' y='9' width='16' height='13' rx='2' />
      <path d='M4 9h16v4H4V9Zm8 0v13M12 9c0-2 1.5-4 3.5-4S18 6.5 16.5 9M12 9C12 7 10.5 5 8.5 5S6 6.5 7.5 9' />
    </svg>
  );
}

function CoffeeIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M4 9h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z' />
      <path d='M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v2M11.5 3v2M15 3v2' />
    </svg>
  );
}

function BugIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <circle cx='12' cy='12' r='7' />
      <path d='M12 5V3M12 21v-2M5 12H3M21 12h-2m-2.5-6.5L15 7m-6 0 1.5-1.5m-1.5 11L9 17m6 0-1.5 1.5' />
    </svg>
  );
}

function BulbIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M9 18h6M10 21h4' />
      <path d='M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7v.4h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3Z' />
    </svg>
  );
}

function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <path d='m4 7 8 6 8-6' />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M12 3 4 6v6c0 4.4 3.4 7.6 8 9 4.6-1.4 8-4.6 8-9V6l-8-3Z' />
    </svg>
  );
}

function ScaleIcon({ className }: IconProps) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' className={className}>
      <path d='M12 3v18M7 21h10M5 7l-3 6a3 3 0 0 0 6 0l-3-6Zm14 0-3 6a3 3 0 0 0 6 0l-3-6ZM4 7h16' />
    </svg>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[13px] text-[var(--ink)] no-underline transition-colors hover:bg-[var(--hairline)]";
const MENU_LABEL =
  "px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--ink-muted)] uppercase";
const SECTION = "border-b border-solid border-[var(--hairline)] p-1.5 last:border-b-0";

function MenuLink({
  href,
  icon,
  accent,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      className={cn(MENU_ITEM, "cursor-pointer border-0 bg-transparent")}
      onClick={() => openExternal(href)}
    >
      <span className={cn("size-[15px] flex-none", accent ? "text-[var(--accent)]" : "text-[var(--ink-secondary)]")}>
        {icon}
      </span>
      {children}
    </button>
  );
}

export function SupportMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className='inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 bg-card text-[var(--ink-secondary)] transition-colors hover:text-foreground'
          aria-label='Support and more'
          title='Support & more'
        >
          <HeartIcon />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={10}
        collisionPadding={12}
        // The glass treatment the rail/dock toolbar uses at rest — translucent
        // surface, ink-tinted border, backdrop blur — rather than a flat opaque
        // panel that reads as a different surface family from the rest of the UI.
        className='w-[300px] overflow-hidden rounded-xl border border-solid border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color-mix(in_srgb,var(--surface-raised)_80%,transparent)] p-0 text-[var(--ink)] shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-[24px] backdrop-saturate-[150%] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
      >
        <div className='border-b border-solid border-[var(--hairline)] px-4 py-3'>
          <div className='flex items-baseline gap-2'>
            <span className='text-[13.5px] font-semibold'>DishyLink</span>
            <span className='font-mono text-[11px] text-[var(--ink-muted)] tabular-nums'>
              v{APP_VERSION}
            </span>
          </div>
          <p className='mt-1.5 text-[11.5px] leading-snug text-[var(--ink-secondary)]'>
            An unofficial Starlink kit dashboard — live stats, plus history the
            dish itself doesn't keep.
          </p>
        </div>

        <div className={SECTION}>
          <div className={MENU_LABEL}>Support development</div>
          <MenuLink href={SUPPORT_LINKS.starRepo} icon={<StarIcon className='size-full' />} accent>
            Star project on GitHub
          </MenuLink>
          <MenuLink href={SUPPORT_LINKS.githubSponsors} icon={<GiftIcon className='size-full' />} accent>
            Become a GitHub Sponsor
          </MenuLink>
          <MenuLink href={SUPPORT_LINKS.buyMeACoffee} icon={<CoffeeIcon className='size-full' />} accent>
            Buy Me a Coffee
          </MenuLink>
          <MenuLink href={SUPPORT_LINKS.koFi} icon={<CoffeeIcon className='size-full' />} accent>
            Ko-fi
          </MenuLink>
        </div>

        <div className={SECTION}>
          <div className={MENU_LABEL}>Feedback</div>
          <MenuLink href={SUPPORT_LINKS.reportIssue} icon={<BugIcon className='size-full' />}>
            Report an issue
          </MenuLink>
          <MenuLink href={SUPPORT_LINKS.requestFeature} icon={<BulbIcon className='size-full' />}>
            Request a feature
          </MenuLink>
        </div>

        <div className={SECTION}>
          <div className={MENU_LABEL}>Contact</div>
          <MenuLink href={SUPPORT_LINKS.contact} icon={<MailIcon className='size-full' />}>
            Contact me
          </MenuLink>
        </div>

        <div className={SECTION}>
          <div className={MENU_LABEL}>Legal</div>
          <MenuLink href={SUPPORT_LINKS.privacyPolicy} icon={<ShieldIcon className='size-full' />}>
            Privacy Policy
          </MenuLink>
          <MenuLink href={SUPPORT_LINKS.disclaimer} icon={<ScaleIcon className='size-full' />}>
            Disclaimer
          </MenuLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlayIcon, SparklesIcon } from "lucide-react";
import { MediaDialog } from "./MediaDialog";
import type { TranslationKey } from "@core/i18n/resources";
import { Button } from "../ui/button";
import { PromptDialog } from "./PromptDialog";
import { SUPPORT_LINKS } from "./supportLinks";
import { HeartIcon } from "../../assets/icons/HeartIcon";
import { HandHeartIcon } from "../../assets/icons/HandHeartIcon";
import { StarIcon } from "../../assets/icons/StarIcon";
import { CoffeeIcon } from "../../assets/icons/CoffeeIcon";
import { PatreonIcon } from "../../assets/icons/PatreonIcon";
import { JobmateBanner } from "./JobmateBanner";
import { promptDue, retirePrompt, snoozePrompt, type PromptId } from "@/lib/promptSchedule";
import { reviewStore, reviewStoreName, reviewUrl } from "@/lib/storeReview";
import { markWhatsNewSeen, WHATS_NEW_RELEASE, whatsNewDue } from "@/lib/whatsNew";

function open(url: string): void {
  // The desktop renderer has no shell access, so it crosses the preload bridge.
  if (window.dishlink?.openExternal) window.dishlink.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

type Showing = PromptId | "whatsNew";

// Chosen once, so answering the first never promotes the second into the same sitting.
function choose(canRate: boolean): Showing | null {
  if (whatsNewDue()) return "whatsNew";
  if (canRate && promptDue("rating")) return "rating";
  if (promptDue("donation")) return "donation";
  return null;
}

const FUNDING: {
  href: string;
  icon: typeof CoffeeIcon;
  label: TranslationKey;
  iconClassName?: string;
}[] = [
  { href: SUPPORT_LINKS.buyMeACoffee, icon: CoffeeIcon, label: "support.buyMeACoffee" },
  {
    href: SUPPORT_LINKS.githubSponsors,
    icon: HeartIcon,
    label: "support.githubSponsor",
    iconClassName: "text-[#ea4aaa]",
  },
  { href: SUPPORT_LINKS.patreon, icon: PatreonIcon, label: "support.patreon" },
];

// A row without a title carries on from the row above it.
const HIGHLIGHTS: { title?: TranslationKey; body: TranslationKey }[] = [
  { title: "whatsNew.languagesTitle", body: "whatsNew.languagesBody" },
  { title: "whatsNew.reportsTitle", body: "whatsNew.reportsBody" },
  { title: "whatsNew.timeFormatTitle", body: "whatsNew.timeFormatBody" },
  { title: "whatsNew.eventLogTitle", body: "whatsNew.eventLogBody" },
  { title: "whatsNew.fixesTitle", body: "whatsNew.factoryResetBody" },
  { body: "whatsNew.chartsBody" },
];

const WALKTHROUGH_EMBED = "https://www.youtube-nocookie.com/embed/BxpOIzJBlg8?autoplay=1&rel=0";

function JobmateCard() {
  const { t } = useTranslation();
  return (
    <button
      type='button'
      onClick={() => open(SUPPORT_LINKS.jobmate)}
      className='group block w-full cursor-pointer overflow-hidden rounded-2xl border-[1.5px] border-[#1a1a1a] bg-card p-0 text-left transition-transform hover:-translate-y-0.5'
    >
      <JobmateBanner badge={t("support.new")} tagline={t("support.jobmateTagline")} />
      <span className='flex items-center gap-3 border-t-[1.5px] border-[#1a1a1a] px-5 py-3.5'>
        <span className='flex-1 text-[15px] leading-snug font-semibold text-ink'>
          {t("support.jobmate")}
        </span>
        <span
          aria-hidden
          className='text-[18px] text-ink-secondary transition-transform group-hover:translate-x-1'
        >
          →
        </span>
      </span>
    </button>
  );
}

function WhatsNew({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [watching, setWatching] = useState(false);

  if (watching) {
    return (
      <MediaDialog title={t("whatsNew.watch")} onDismiss={onDone} onBack={() => setWatching(false)}>
        <JobmateCard />
        <iframe
          src={WALKTHROUGH_EMBED}
          title={t("whatsNew.watch")}
          allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
          allowFullScreen
          referrerPolicy='strict-origin-when-cross-origin'
          className='mt-5 block aspect-video w-full rounded-xl border-0 bg-black'
        />
      </MediaDialog>
    );
  }

  return (
    <PromptDialog
      icon={<SparklesIcon />}
      title={t("whatsNew.title", { version: WHATS_NEW_RELEASE })}
      onDismiss={onDone}
    >
      <ul className='mt-7 list-disc space-y-2.5 pl-5 text-left text-[14px] leading-relaxed text-ink-secondary marker:text-ink-muted'>
        {HIGHLIGHTS.map(({ title, body }) => (
          <li key={body}>
            {title && <strong className='font-semibold text-ink'>{t(title)} </strong>}
            {t(body)}
          </li>
        ))}
      </ul>

      <button
        type='button'
        onClick={() => open(SUPPORT_LINKS.releaseNotes)}
        className='mt-5 cursor-pointer border-0 bg-transparent text-[13px] text-ink-secondary transition-colors hover:text-ink'
      >
        {t("whatsNew.releaseNotes")} →
      </button>

      <div className='mt-7 flex flex-col items-center'>
        <JobmateCard />
        <Button
          variant='outline'
          size='lg'
          className='mt-3 w-full cursor-pointer'
          onClick={() => setWatching(true)}
        >
          <PlayIcon />
          {t("whatsNew.watch")}
        </Button>
        <button
          type='button'
          onClick={onDone}
          className='mt-5 cursor-pointer border-0 bg-transparent text-[13px] text-ink-secondary/80 transition-colors hover:text-ink'
        >
          {t("whatsNew.gotIt")}
        </button>
      </div>
    </PromptDialog>
  );
}

export function AppPrompts() {
  const { t } = useTranslation();
  const store = reviewStore();
  const [showing, setShowing] = useState(() => choose(store !== null));

  if (showing === null) return null;

  if (showing === "whatsNew") {
    return (
      <WhatsNew
        onDone={() => {
          markWhatsNewSeen();
          setShowing(null);
        }}
      />
    );
  }

  const later = (): void => {
    snoozePrompt(showing);
    setShowing(null);
  };
  const never = (): void => {
    retirePrompt(showing);
    setShowing(null);
  };
  const acted = (url: string): void => {
    open(url);
    retirePrompt(showing);
    setShowing(null);
  };

  if (showing === "rating" && store !== null) {
    return (
      <PromptDialog
        icon={<StarIcon />}
        title={t("prompts.ratingTitle")}
        body={t("prompts.ratingBody")}
        onDismiss={later}
        deferral={{ onLater: later, onNever: never }}
        actions={
          <Button
            size='lg'
            className='w-full cursor-pointer'
            onClick={() => acted(reviewUrl(store))}
          >
            {t("prompts.rateOn", { store: reviewStoreName(store) })}
          </Button>
        }
      />
    );
  }

  return (
    <PromptDialog
      icon={<HandHeartIcon />}
      title={t("prompts.donationTitle")}
      body={t("prompts.donationBody")}
      onDismiss={later}
      deferral={{ onLater: later, onNever: never }}
      actions={FUNDING.map(({ href, icon: Icon, label, iconClassName }, i) => (
        <Button
          key={href}
          variant={i === 0 ? "default" : "outline"}
          size='lg'
          className={
            i === 0
              ? "w-full cursor-pointer bg-[color-mix(in_srgb,var(--ink)_86%,transparent)] text-page hover:bg-ink"
              : "w-full cursor-pointer"
          }
          onClick={() => acted(href)}
        >
          <Icon className={iconClassName} />
          {t(label)}
        </Button>
      ))}
    />
  );
}

import { useState } from "react";
import { Button } from "../ui/button";
import { PromptDialog } from "./PromptDialog";
import { SUPPORT_LINKS } from "./supportLinks";
import { HeartIcon } from "../../assets/icons/HeartIcon";
import { HandHeartIcon } from "../../assets/icons/HandHeartIcon";
import { StarIcon } from "../../assets/icons/StarIcon";
import { CoffeeIcon } from "../../assets/icons/CoffeeIcon";
import { PatreonIcon } from "../../assets/icons/PatreonIcon";
import { promptDue, retirePrompt, snoozePrompt, type PromptId } from "@/lib/promptSchedule";
import { reviewStore, reviewStoreName, reviewUrl } from "@/lib/storeReview";

function open(url: string): void {
  // The desktop renderer has no shell access, so it crosses the preload bridge.
  if (window.dishlink?.openExternal) window.dishlink.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

// Chosen once, so answering the first never promotes the second into the same sitting.
function choose(canRate: boolean): PromptId | null {
  if (canRate && promptDue("rating")) return "rating";
  if (promptDue("donation")) return "donation";
  return null;
}

const FUNDING = [
  { href: SUPPORT_LINKS.buyMeACoffee, icon: CoffeeIcon, label: "Buy Me a Coffee" },
  {
    href: SUPPORT_LINKS.githubSponsors,
    icon: HeartIcon,
    label: "Become a GitHub Sponsor",
    iconClassName: "text-[#ea4aaa]",
  },
  { href: SUPPORT_LINKS.patreon, icon: PatreonIcon, label: "Become a Patreon" },
];

export function AppPrompts() {
  const store = reviewStore();
  const [showing, setShowing] = useState(() => choose(store !== null));

  if (showing === null) return null;

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
        title='Enjoying Dishylink?'
        body="A rating takes ten seconds, but it's the one thing that helps other Starlink owners find the app."
        onLater={later}
        onNever={never}
        actions={
          <Button
            size='lg'
            className='w-full cursor-pointer'
            onClick={() => acted(reviewUrl(store))}
          >
            Rate on {reviewStoreName(store)}
          </Button>
        }
      />
    );
  }

  return (
    <PromptDialog
      icon={<HandHeartIcon />}
      title='Dishylink is free, and always will be.'
      body='I built it in my free time, because nothing like it existed. Your one-off or recurring contribution does a lot to keep it maintained and updated. Please show the project some support if you can!'
      onLater={later}
      onNever={never}
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
          {label}
        </Button>
      ))}
    />
  );
}

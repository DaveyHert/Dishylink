// Solid action button (reboot / rename / stow) shared by the settings and
// network panels. Default is the ink fill; subtle is a faint tint on the
// surface; danger is the critical red. The fill utilities are kept per-variant
// rather than layered so no two background rules ever race.
const base =
  "cursor-pointer rounded-md border-0 px-4 py-2 font-sans text-[13px] font-semibold transition-opacity duration-[120ms] enabled:hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45";

/** A button that reads as part of a sentence: for naming a control that lives on
 *  another surface, where a solid button would break the line. */
export const inlineLinkButton =
  "cursor-pointer border-0 bg-transparent p-0 font-inherit underline underline-offset-2 hover:no-underline";

export function actionButton(variant: "default" | "subtle" | "danger" = "default"): string {
  const fill =
    variant === "subtle"
      ? "bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] text-foreground"
      : variant === "danger"
        ? "bg-destructive text-white"
        : "bg-primary text-primary-foreground";
  return `${base} ${fill}`;
}

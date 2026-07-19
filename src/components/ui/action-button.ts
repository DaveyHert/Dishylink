// Solid action button (reboot / rename / stow) shared by the settings and
// network panels. Default is the ink fill; subtle is a faint tint on the
// surface; danger is the critical red. The fill utilities are kept per-variant
// rather than layered so no two background rules ever race.
const base =
  "cursor-pointer rounded-md border-0 px-4 py-2 font-sans text-[13px] font-semibold transition-opacity duration-[120ms] enabled:hover:opacity-85 disabled:cursor-default disabled:opacity-45";

export function actionButton(variant: "default" | "subtle" | "danger" = "default"): string {
  const fill =
    variant === "subtle"
      ? "bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] text-foreground"
      : variant === "danger"
        ? "bg-destructive text-white"
        : "bg-primary text-primary-foreground";
  return `${base} ${fill}`;
}

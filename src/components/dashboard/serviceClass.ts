import type { TFunction } from "i18next";

/** Plan tier, in the vocabulary the Starlink app uses. CONSUMER covers both
 *  "Residential" on a fixed install and "Roam" on a kit licensed to move, so the
 *  mobility class is what tells those two apart. Absent mobility means
 *  STATIONARY: proto3 drops the zero value, so a fixed kit never sends it. */
export function formatServiceClass(
  classOfService: string | undefined,
  mobilityClass: string | undefined,
  t: TFunction,
): string {
  switch (classOfService) {
    case "CONSUMER":
      return mobilityClass === "NOMADIC" || mobilityClass === "MOBILE"
        ? t("terminal.serviceRoam")
        : t("terminal.serviceResidential");
    case "BUSINESS":
      return t("terminal.serviceBusiness");
    case "BUSINESS_PLUS":
      return t("terminal.serviceBusinessPlus");
    default:
      return (classOfService ?? "—").replaceAll("_", " ").toLowerCase();
  }
}

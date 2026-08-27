// Every outbound destination the support menu offers, kept apart from the menu
// that renders them: these are personal and financial addresses — a sponsorship
// page, two donation pages, a mailto — and a wrong one still draws as a
// perfectly ordinary row, so the wrongness only ever shows up in where the money
// and mail actually went. Gathered here so the whole set can be read, and
// guarded, in one place.

const REPO = "https://github.com/DaveyHert/dishylink";

export const SUPPORT_LINKS = {
  starRepo: REPO,
  githubSponsors: "https://github.com/sponsors/daveyhert",
  buyMeACoffee: "https://buymeacoffee.com/daveyhert",
  patreon: "https://www.patreon.com/DaveyHert",
  latestRelease: `${REPO}/releases/latest`,
  reportIssue: `${REPO}/issues/new?labels=bug`,
  requestFeature: `${REPO}/issues/new?labels=enhancement`,
  contact: "mailto:hello@dishylink.com",
  x: "https://x.com/daveyhert",
  linkedin: "http://linkedin.com/in/daveyhert/",
  privacyPolicy: `${REPO}/blob/master/PRIVACY.md`,
  disclaimer: `${REPO}/blob/master/DISCLAIMER.md`,
};

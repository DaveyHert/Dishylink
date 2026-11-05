// Every outbound destination the support menu offers, kept apart from the menu
// that renders them: these are personal and financial addresses — a sponsorship
// page, two donation pages, a mailto — and a wrong one still draws as a
// perfectly ordinary row, so the wrongness only ever shows up in where the money
// and mail actually went. Gathered here so the whole set can be read, and
// guarded, in one place.

const REPO = "https://github.com/DaveyHert/dishylink";
// usejobmate.com reports traffic in Google Analytics, which reads these UTM tags.
const JOBMATE = "https://usejobmate.com/?utm_source=dishylink&utm_medium=app";

export const SUPPORT_LINKS = {
  starRepo: REPO,
  githubSponsors: "https://github.com/sponsors/daveyhert",
  buyMeACoffee: "https://buymeacoffee.com/daveyhert",
  patreon: "https://www.patreon.com/DaveyHert",
  downloadPage: "https://dishylink.com/#get",
  releaseNotes: `${REPO}/blob/master/CHANGELOG.md`,
  reportIssue: `${REPO}/issues/new?labels=bug`,
  requestFeature: "https://buymeacoffee.com/daveyhert/e/591024",
  contact: "mailto:hello@dishylink.com",
  x: "https://x.com/daveyhert",
  linkedin: "http://linkedin.com/in/daveyhert/",
  privacyPolicy: `${REPO}/blob/master/PRIVACY.md`,
  disclaimer: `${REPO}/blob/master/DISCLAIMER.md`,
  jobmateFromReleaseNotes: `${JOBMATE}&utm_content=release_notes`,
  jobmateFromSupportMenu: `${JOBMATE}&utm_content=support_menu`,
  jobmateVideo: "https://youtu.be/BxpOIzJBlg8",
};

import { session } from "electron";

// YouTube refuses to play an embed whose request carries no web referrer (its
// "Error 153"), and pages served over app:// don't send one. Only the embed
// player's own host is touched, and only when it arrived without an http(s)
// referrer, so a dev window served from Vite keeps its real one.
const EMBED_HOST_URLS = ["https://www.youtube-nocookie.com/*"];
const STAND_IN_REFERRER = "https://dishylink.com/";

export function allowYoutubeEmbeds(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: EMBED_HOST_URLS },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!/^https?:/.test(headers.Referer ?? "")) headers.Referer = STAND_IN_REFERRER;
      callback({ requestHeaders: headers });
    },
  );
}

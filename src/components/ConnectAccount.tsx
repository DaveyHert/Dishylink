// Dev-only "connect your Starlink account" form. The session cookies are
// HttpOnly + cross-origin, so the dev browser can't lift them with a button —
// the user pastes the Cookie header from DevTools (the packaged Mac app and the
// extension capture it automatically; see CLOUD-ACCOUNT.md). We deliberately
// instruct the Network-tab Cookie header, NOT document.cookie, which omits the
// HttpOnly Starlink.Com.Sso that the token refresh needs.

import { useState } from "react";
import { connectCloud } from "../lib/starlinkCloud";
import { Button } from "./ui/button";
import { SpinLoader } from "./loaders/SpinLoader";

const STEPS = [
  <>
    In a new tab, sign in at{" "}
    <a
      href='https://www.starlink.com/account'
      target='_blank'
      rel='noreferrer'
      className='underline underline-offset-2'
    >
      starlink.com/account
    </a>
    .
  </>,
  <>
    Open DevTools (<kbd className='mono-value'>F12</kbd> / <kbd className='mono-value'>⌥⌘I</kbd>)
    and switch to the <strong>Network</strong> tab.
  </>,
  <>Reload the page, then click any request to starlink.com in the list.</>,
  <>
    Under <strong>Request Headers</strong>, find <code>cookie:</code> and copy its{" "}
    <strong>entire</strong> value.
  </>,
  <>
    Paste it below and Connect. (Don't use the console's document.cookie — it drops the part we
    need.)
  </>,
];

export function ConnectAccount({ onConnected }: { onConnected: () => void }) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!cookie.trim() || busy) return;
    setBusy(true);
    setError(null);
    connectCloud(cookie.trim())
      .then(onConnected)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t connect."))
      .finally(() => setBusy(false));
  };

  return (
    <div className='mt-2.5 flex flex-col gap-3 rounded-xl border border-border/70 bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] p-4'>
      <div>
        <div className='text-[14px] font-semibold'>Connect your Starlink account</div>
        <div className='mt-0.5 text-[12.5px] leading-normal text-[var(--ink-secondary)]'>
          Read-only — your account, your data. The session is written to a local{" "}
          <code>.starlink-cookie</code> file on this machine and only ever sent to Starlink.
        </div>
      </div>

      <ol className='m-0 flex list-none flex-col gap-1.5 p-0'>
        {STEPS.map((step, index) => (
          <li
            key={index}
            className='flex gap-2.5 text-[12.5px] leading-snug text-[var(--ink-secondary)]'
          >
            <span className='mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--ink)_10%,var(--surface))] text-[11px] font-semibold text-foreground'>
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder='Starlink.Com.Sso=…; Starlink.Com.Access.V1=…; …'
        aria-label='Starlink session cookie'
        spellCheck={false}
        rows={3}
        className='min-w-0 resize-y rounded-md border border-[var(--baseline)] bg-card px-2.5 py-2 font-mono text-[11.5px] leading-normal break-all text-foreground focus:border-[var(--ink)] focus:outline-none'
      />

      {error && <div className='text-[12px] text-[var(--status-critical)]'>{error}</div>}

      <div className='flex items-center gap-2'>
        <Button
          onClick={submit}
          disabled={!cookie.trim() || busy}
          size='sm'
          className={`w-fit border-0 ${
            busy
              ? "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-muted-foreground disabled:opacity-100"
              : ""
          }`}
        >
          {busy ? <SpinLoader size={20} variant='activity' label='Connecting' /> : "Connect"}
        </Button>
        <span className='text-[11.5px] text-muted-foreground'>⌘↵ to submit</span>
      </div>
    </div>
  );
}

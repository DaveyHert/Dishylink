import { requestPanel } from "../../hooks/usePanelRouting";

/** Owns the wording so "sign in" is a real control rather than a phrase the
 *  reader has to act on somewhere else. */
export function AccountRequiredNotice() {
  return (
    <>
      An authorized account is required —{" "}
      <button
        type='button'
        className='cursor-pointer border-0 bg-transparent p-0 font-inherit underline underline-offset-2 hover:no-underline'
        onClick={() => requestPanel("account")}
      >
        sign in
      </button>{" "}
      to use this feature.
    </>
  );
}

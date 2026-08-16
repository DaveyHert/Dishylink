import { requestPanel } from "../../hooks/usePanelRouting";
import { inlineLinkButton } from "../ui/action-button";

/** Owns the wording so "sign in" is a real control rather than a phrase the
 *  reader has to act on somewhere else. */
export function AccountRequiredNotice() {
  return (
    <>
      An authorized account is required —{" "}
      <button type='button' className={inlineLinkButton} onClick={() => requestPanel("account")}>
        sign in
      </button>{" "}
      to use this feature.
    </>
  );
}

import { Trans } from "react-i18next";
import { requestPanel } from "../../hooks/usePanelRouting";
import { inlineLinkButton } from "../ui/action-button";

/** Owns the wording so "sign in" is a real control rather than a phrase the
 *  reader has to act on somewhere else. */
export function AccountRequiredNotice() {
  return (
    <Trans
      i18nKey='account.required'
      components={{
        link: (
          <button
            type='button'
            className={inlineLinkButton}
            onClick={() => requestPanel("account")}
          />
        ),
      }}
    />
  );
}

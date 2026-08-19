// What enforcing a data limit needs from the extension's account session.
//
// Injected rather than imported: the session lives in the cloud handler, and
// reaching for it from the recorder or the API router would pull the whole worker
// runtime into anything that loads either of them.

export interface MeterHost {
  /** Whether a session is held. Nothing is attempted that cannot land. */
  signedIn(): boolean;
  /** Pause or release one device through the account. Throws with the reason the
   *  surfaces show when the write does not land. */
  setPaused(clientId: number, paused: boolean): Promise<void>;
}

/** A host with no account behind it: nothing is enforceable, and saying so is the
 *  honest answer for a surface asking up front. */
export const NO_METER_HOST: MeterHost = {
  signedIn: () => false,
  setPaused: async () => {
    throw new Error("No Starlink account connected");
  },
};

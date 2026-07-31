// Channel names shared by the main process and the preload bridge.
//
// Request/response channels are named at their single `ipcMain.handle` and the
// one `ipcRenderer.invoke` that answers it, so they stay local to the method
// that uses them. What lands here is the other direction: a channel main pushes
// on and preload listens to has two ends in two files, and a typo in either is
// silence rather than an error.

/** Carries a NotificationState whenever it changes, plus once per window load so
 *  a fresh renderer starts from the real state instead of a guess. */
export const NOTIFICATION_STATE_CHANNEL = "notification-state";

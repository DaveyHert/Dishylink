/// <reference types="vite/client" />

// Exposed by the Electron preload bridge; absent in the browser and extension.
interface Window {
  dishlink?: {
    versions: { electron: string; chrome: string };
    signIn: () => Promise<{ ok: boolean; message?: string }>;
    cloud: (request: {
      path: string;
      method?: string;
      body?: unknown;
    }) => Promise<{ status: number; body: unknown }>;
  };
}

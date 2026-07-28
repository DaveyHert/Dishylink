import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// A placeholder shell so the dashboard surface is loadable while the collection
// core is built. The real dashboard (src/App, reading history over the extension
// host seam) mounts here once the background drain and IndexedDB store are proven.
function Dashboard() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>DishyLink</h1>
      <p>Dashboard — collection core under construction.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);

// Browser-project setup. Loads the real stylesheet so component tests resolve the
// same cascade, tokens and @theme mappings the app does — without it,
// getComputedStyle would report defaults and every fidelity assertion would be
// meaningless.
import "./index.css";

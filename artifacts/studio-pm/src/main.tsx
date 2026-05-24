import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Cue is dark-mode-first. Apply the `.dark` class to <html> so that Radix
// portals (Dialog, AlertDialog, Popover, DropdownMenu, Toaster) — which
// render under document.body, OUTSIDE the React tree — also inherit the
// dark theme. Previously this class was on a wrapper div inside <App />,
// which meant portaled UI escaped it and rendered light (white modal
// backgrounds, etc.).
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);

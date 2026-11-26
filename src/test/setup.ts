import { configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The defaults (1s per async query) are too tight when test files run in parallel on a busy machine.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no modal dialogs: open and close them as the browser would, so their contents are visible.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
}

// Reports remember their last parameters for the browser tab; every test starts with a fresh tab.
afterEach(() => { if (typeof sessionStorage !== "undefined") sessionStorage.clear(); });

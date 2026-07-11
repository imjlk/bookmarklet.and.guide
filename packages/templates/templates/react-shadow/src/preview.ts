import { run } from "./inject.js";

document
  .querySelector<HTMLButtonElement>("[data-preview-run]")
  ?.addEventListener("click", run);

run();

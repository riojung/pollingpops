import process from "node:process";
import { browserTestMain } from "./test-browser.mjs";

await browserTestMain([
  "--config=playwright.presentation-scene.config.ts",
  ...process.argv.slice(2),
]);

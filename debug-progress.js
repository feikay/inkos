import { resolveDurableStoryProgress } from "./packages/core/dist/state/state-bootstrap.js";
import { StateManager } from "./packages/core/dist/state/state-manager.js";

async function main() {
  const root = process.cwd();
  console.log("Root:", root);
  const state = new StateManager(root);
  const bookId = "重生1997";
  const bookDir = state.bookDir(bookId);
  console.log("BookDir:", bookDir);
  const progress = await resolveDurableStoryProgress({ bookDir });
  console.log("Durable progress:", progress);
}

main().catch(console.error);

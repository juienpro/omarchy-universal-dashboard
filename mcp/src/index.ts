import { serveMcp } from "./mcp.js";
import {
  deleteView,
  getScreen,
  listDatasets,
  loadViewOnScreen,
  listViews,
  refreshDataset,
  refreshDueDatasets,
  summarizeScreen,
} from "./store.js";

const args = process.argv.slice(2);
const cmd = args[0] || "serve";

async function main() {
  if (cmd === "serve") {
    await serveMcp();
    return;
  }
  if (cmd === "status") {
    process.stdout.write(JSON.stringify(summarizeScreen(getScreen()), null, 2) + "\n");
    return;
  }
  if (cmd === "views") {
    process.stdout.write(JSON.stringify({ views: listViews() }, null, 2) + "\n");
    return;
  }
  if (cmd === "datasets") {
    process.stdout.write(JSON.stringify({ datasets: listDatasets() }, null, 2) + "\n");
    return;
  }
  if (cmd === "load-view") {
    const id = args[1];
    if (!id) {
      process.stderr.write("usage: universal-dashboard load-view <id>\n");
      process.exit(2);
    }
    process.stdout.write(JSON.stringify(summarizeScreen(loadViewOnScreen(id)), null, 2) + "\n");
    return;
  }
  if (cmd === "delete-view") {
    const id = args[1];
    if (!id) {
      process.stderr.write("usage: universal-dashboard delete-view <id>\n");
      process.exit(2);
    }
    process.stdout.write(JSON.stringify(deleteView(id), null, 2) + "\n");
    return;
  }
  if (cmd === "refresh") {
    const key = args[1];
    if (!key) {
      process.stderr.write("usage: universal-dashboard refresh <key>\n");
      process.exit(2);
    }
    const rec = await refreshDataset(key);
    process.stdout.write(
      JSON.stringify(
        { key: rec.key, fetchedAt: rec.fetchedAt, error: rec.error, nextRefreshAt: rec.nextRefreshAt },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  if (cmd === "refresh-due") {
    const result = await refreshDueDatasets();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (cmd === "doctor") {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          version: "0.1.0",
          screen: summarizeScreen(getScreen()),
          views: listViews(),
          datasets: listDatasets(),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.stderr.write(
    "usage: universal-dashboard <serve|status|views|datasets|load-view|delete-view|refresh|refresh-due|doctor>\n",
  );
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});

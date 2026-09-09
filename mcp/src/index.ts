import { serveMcp } from "./mcp.js";
import {
  bumpCarouselInterval,
  cycleCarouselTransition,
  deleteView,
  getCarousel,
  getScreen,
  listDatasets,
  loadViewOnScreen,
  listViews,
  refreshDataset,
  refreshDueDatasets,
  setCarousel,
  summarizeScreen,
  toggleCarousel,
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
  if (cmd === "carousel") {
    const sub = args[1];
    if (sub === "off") {
      process.stdout.write(JSON.stringify(setCarousel({ enabled: false }), null, 2) + "\n");
      return;
    }
    if (sub === "toggle") {
      process.stdout.write(JSON.stringify(toggleCarousel(), null, 2) + "\n");
      return;
    }
    if (sub === "cycle-transition") {
      process.stdout.write(JSON.stringify(cycleCarouselTransition(), null, 2) + "\n");
      return;
    }
    if (sub === "interval") {
      const raw = args[2];
      if (!raw || !/^[-+]?\d+$/.test(raw)) {
        process.stderr.write("usage: universal-dashboard carousel interval <+N|-N>\n");
        process.exit(2);
      }
      process.stdout.write(JSON.stringify(bumpCarouselInterval(parseInt(raw, 10)), null, 2) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify(getCarousel(), null, 2) + "\n");
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
          carousel: getCarousel(),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.stderr.write(
    "usage: universal-dashboard <serve|status|views|datasets|carousel|load-view|delete-view|refresh|refresh-due|doctor>\n",
  );
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});

# Example prompts

Paste each file into an agent that has the Universal Dashboard skill + MCP. Prompts are written like a human request but detailed enough to recreate a coherent dashboard.

Run **01 → 05** first (each creates a saved view). Then **06** and **07** (overlays on all views). Cycle with `←`/`→` or `c` to check overlays stick.

| # | File | Exercises |
|---|---|---|
| 01 | `01-paris-weather.md` | Paris weather board (`Stat` / `Icon` / hourly `HorizontalTiles`) |
| 02 | `02-stocks.md` | 8-ticker Yahoo board with % change + area charts (**no** view Marquee) |
| 03 | `03-hacker-news.md` | Live HN `List` cards with clickable `hrefField` |
| 04 | `04-omarchy-rss.md` | RSS → JSON (`https://omarchy.org/news/rss.xml`) |
| 05 | `05-video-grid.md` | 2×2 muted autoplay `Youtube` wall (yt-dlp) |
| 06 | `06-ticker-overlay.md` | Dock top `Marquee` overlay on all views |
| 07 | `07-omarchy-logo-overlay.md` | Float bottom-right watermark (`Image` or Text) |

**Notes for agents:** HTTP datasets expect JSON — bridge RSS when needed. Prefer live datasets + widgets over Markdown dumps. Use **`Youtube`** for youtube.com / youtu.be (needs `yt-dlp`); use **`Video`** only for direct file/HLS URLs.

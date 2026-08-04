# Bedringh (Minecraft Bedrock Launcher)

Welcome to **Bedringh**, a custom launcher for Minecraft Bedrock Edition, modified from the Modrinth App (Theseus) monorepo.

## About This Project

Bedringh is designed to provide a clean, streamlined, and offline-first experience for launching and managing Minecraft Bedrock Edition. It is a fork of the Modrinth App with deep Bedrock integration and a number of quality-of-life improvements.

## Features (compared to the original Modrinth App)

### Bedrock Edition support
- **Bedrock version management** — browse, download and launch Minecraft Bedrock versions directly from the launcher. Preview/Beta versions are available via a "Show All Versions" toggle.
- **UWP & GDK installation support** — automatic detection of the Bedrock installation type (UWP AppX vs GDK) with correct launch branch selection for each.
- **Fast Bedrock launch** — optimized launch pipeline: removed recursive permission operations, skip re-downloading existing runtime components, and asynchronous ACL granting to eliminate startup delays.
- **Direct LocalState sync** — reliable synchronization with the Bedrock `LocalState` directory for UWP installs.

### Content (addons) management
- **Bedrock content tab** — manage resource packs, behavior packs and other addons for a Bedrock instance, with the same table layout as Java content.
- **CurseForge catalog integration** — search and install Bedrock addons from CurseForge with category and version filters.
- **Addon enable/disable** — toggling an addon renames its `manifest.json` so disabled addons are hidden from the game, and syncs `valid_known_packs.json` / `global_resource_packs.json` accordingly.
- **Content context menu** — three-dots menu on Bedrock content items: open containing folder and copy link (same as Java).
- **Local addon fallback** — installed addons resolve author names/avatars locally to avoid broken project pages and network errors.

### Worlds
- **Bedrock worlds tab** — list, export, import and delete Bedrock worlds.
- **Automatic world backups** — a backup is created when you exit the game; the last 10 backups are kept per world.
- **Backups UI** — a "Backups" button in the Worlds tab shows the latest snapshots with restore and delete actions.
- **Corruption recovery** — integrity check that detects corrupted worlds and can restore them from a backup.

### Instance management
- **Bedrock installation settings** — Java-style settings page for Bedrock instances: installation info card, version changer, and a **Repair instance** action.
- **Integrity check & repair** — one-click repair that reinstalls the Bedrock dependencies without deleting your content.

### Appearance & customization
- **Accent color themes** — choose from 9 accent colors (green, purple, blue, red, orange, pink, teal, cyan, yellow). Each color has a fully tuned HSL palette for both light and dark themes.
- **Brighter accent palette** — refreshed, more vibrant accent colors in the launcher's visual style.
- **Localized UI** — interface translations (including Russian), with instant language switching and a search-results translation toggle in the browse tab.

### Privacy & cleanup
- **No telemetry** — PostHog analytics and tracking completely removed.
- **No ads** — ad injections and ad plugin initialization removed from backend and frontend.
- **No news feed** — Modrinth news/promotion cards removed for a distraction-free experience.
- **Resource management** — built-in cache/memory manager in settings: view cache sizes, manage Bedrock packages, and clean up instance storage.

## Development

To run the launcher locally in development mode:

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start the development server for the app:
   ```bash
   pnpm app:dev
   ```

## Building

A GitHub Actions workflow (`.github/workflows/bedringh-build.yml`) builds the Windows installer (NSIS + MSI). It runs on version tags (`v*`) or manually via workflow dispatch, and publishes a GitHub Release with the installer when triggered by a tag.

## License

This project is a fork of the Modrinth Monorepo. Please refer to the `COPYING.md` and `LICENSE` files for copying guidelines and licensing information.

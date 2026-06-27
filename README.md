# Bedringh (Minecraft Bedrock Launcher)

Welcome to **Bedringh**, a custom launcher for Minecraft Bedrock Edition, modified from the Modrinth App (Theseus) monorepo.

## About This Project

Bedringh is designed to provide a clean, streamlined, and offline-first experience for launching Minecraft Bedrock Edition. Key modifications from the original Modrinth app include:

- **Bedrock Version Management:** Direct support for downloading and launching Minecraft Bedrock versions.
- **Clean UI:** Removed unnecessary GDK/UWP loader tags for a simpler user experience. Preview/Beta versions are easily accessible via a "Show All Versions" toggle.
- **Privacy First (No Telemetry & No Ads):** 
  - Completely stripped out PostHog telemetry and analytics tracking.
  - Removed Microsoft Edge ad injections and ad plugin initialization from the backend and frontend.
  - Removed Modrinth news feed and telemetry promotion cards from the UI to ensure a distraction-free experience.

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

## License

This project is a fork of the Modrinth Monorepo. Please refer to the `COPYING.md` and `LICENSE` files for copying guidelines and licensing information.

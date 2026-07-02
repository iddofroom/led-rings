# Timeline UI

A beautiful vertical timeline interface for managing timeframes. Users can add, edit, and delete timeframes with custom labels, start/end beats, and colors.

## Features

- ✨ Vertical timeline visualization
- ➕ Add new timeframes
- ✏️ Edit timeframe labels and times by clicking on them
- 🗑️ Delete timeframes
- 🎨 Automatic color assignment for new timeframes
- 📱 Responsive design

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Navigate to the UI directory:
   ```bash
   cd ui
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
   or
   ```bash
   yarn install
   ```

### Running the Application

Start the development server:

```bash
npm run dev
```

or

```bash
yarn dev
```

The application will be available at `http://localhost:5173` (or another port if 5173 is occupied).

**Send Sequence & Live mode:** To use "Send Sequence" and "Live mode" (Run/Stop controlling the device):

1. Run the control server from a machine reachable from wherever you're using the UI: `yarn control-server` or `npm run control-server` (default port 3080).
2. Open the ⚙ Settings panel in the app and set the control server URL (e.g. `http://localhost:3080`, or `http://<that machine's LAN IP>:3080` if it's running elsewhere). This is saved in the browser and takes effect immediately — no rebuild needed. (For local dev, `ui/.env`'s `VITE_API_URL` still works as the initial default until you save a value in Settings.)
3. With Live mode checked, Run also starts the song on the device at the current marker time; Stop sends stop.
4. With no control server configured/reachable, timeline and preset editing still work fully — only Send Sequence, Live mode, Import .ts and Detect Beats need one.

### Building for Production

To create a production build:

```bash
npm run build
```

or

```bash
yarn build
```

The built files will be in the `dist` directory.

### Preview Production Build

To preview the production build locally:

```bash
npm run preview
```

or

```bash
yarn preview
```

## Usage

1. **Add a Timeframe**: Click the "+ Add Timeframe" button at the top
2. **Edit Label**: Click on a timeframe's label to edit it
3. **Edit Beats**: Click on the start or end beat value to edit it
4. **Delete Timeframe**: Click the "×" button on a timeframe

The timeline axis displays beats (marked with "b"), allowing you to manage musical or rhythmic timeframes.

## Standalone Packaged App

For distributing to people who don't have Node installed, run from the repo root:

```bash
npm run package:win
```

This vite-builds the UI, embeds it into a static file server, and produces self-contained binaries in `release/`:

| File | Platform |
|---|---|
| `kivsee-time-simulator-win.exe` | Windows x64 |
| `kivsee-time-simulator-mac-arm64` | macOS Apple Silicon (M1/M2/M3) |
| `kivsee-time-simulator-mac-x64` | macOS Intel |

Hand out the appropriate single file — no installation required. Double-clicking launches a local server on port 4173 and opens a browser tab automatically.

**macOS first-launch:** Apple Gatekeeper blocks unsigned binaries by default. Right-click the file → Open → Open to bypass the warning once. After that it runs normally.

**Control server:** The app works fully offline for timeline/preset editing. To enable hardware control (Send Sequence, Live mode), open ⚙ Settings and enter the LAN URL of a running control server.

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **CSS3** - Styling with modern gradients and animations

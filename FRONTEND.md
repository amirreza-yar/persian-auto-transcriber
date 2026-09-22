# Persian Auto Transcriber Frontend

This document describes the React frontend used by the main Persian STT application: architecture, pages, data flow, synchronized playback, local transcript editing, PWA behavior, IndexedDB offline storage, and production deployment.

## 1. Goals

The frontend is designed for a local speech-to-text workflow where users may process long recordings and then spend significant time listening, reviewing, correcting, and exporting Persian transcripts.

Its core goals are:

- remain responsive with long recordings and thousands of subtitle cues;
- make backend queue/retry state understandable without exposing raw scheduler internals everywhere;
- provide an efficient synchronized audio/transcript correction workflow;
- support explicit offline copies of important completed recordings;
- preserve local user corrections without modifying backend artifacts;
- work well on desktop and mobile;
- use one production origin with the FastAPI backend.

## 2. Stack

- **React 19**
- **TypeScript**
- **Vite**
- **Tailwind CSS 4**
- **shadcn/ui-style source components / Radix primitives**
- **React Router**
- **Axios** for REST
- native **EventSource** for SSE
- **Lucide** icons
- **Sonner** notifications
- **Vazirmatn** bundled locally for Persian content
- **vite-plugin-pwa / Workbox** for the installable offline application shell
- native **IndexedDB** for explicit offline audio/transcript storage

The application shell is English/LTR. Persian transcript regions explicitly use RTL direction and Persian typography.

## 3. Frontend source layout

```text
frontend/
├── src/
│   ├── api/                   # REST/SSE adapters
│   ├── app/                   # providers, router, theme, PWA integration
│   ├── components/
│   │   ├── audio/
│   │   ├── common/
│   │   ├── files/
│   │   ├── jobs/
│   │   ├── layout/
│   │   ├── settings/
│   │   └── ui/
│   ├── hooks/
│   ├── lib/
│   │   ├── artifacts.ts
│   │   ├── format.ts
│   │   ├── job-state.ts
│   │   ├── offline-db.ts
│   │   ├── offline-sync.ts
│   │   ├── transcript.ts
│   │   └── utils.ts
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── FilesPage.tsx
│   │   ├── StatisticsPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── AudioPlayerPage.tsx
│   │   └── TextViewerPage.tsx
│   ├── types/api.ts
│   ├── index.css
│   └── main.tsx
├── public/
├── package.json
└── vite.config.ts
```

## 4. Routes

```text
/                  Home / uploads / active work
/files             recording library
/statistics        history + backend/system status
/settings          runtime settings + Gemini credentials
/player/:jobId     synchronized audio/transcript player
/text/:jobId       readable transcript viewer
```

The player route currently receives the source file/job UUID used by the backend's one-source-file-per-job model.

## 5. Application shell

The standard shell contains:

- desktop sidebar navigation;
- mobile bottom navigation;
- responsive content area;
- theme support;
- global toast notifications;
- shared application-data and backend-event providers.

Player and text-reader pages use a more focused standalone layout so reviewing long material is not constrained by the normal dashboard shell.

## 6. Data access model

### REST

Axios uses relative `/api/...` URLs. This is intentional:

- Vite development proxies `/api` to the configured backend;
- production uses the same origin as FastAPI;
- no environment-specific API URL needs to be embedded in browser code.

Example development setting:

```env
VITE_BACKEND_ORIGIN=http://192.168.0.150:8000
```

### SSE

Live changes use native EventSource:

```text
/api/events/stream
/api/system/stream
```

REST remains the source of truth. SSE acts as an invalidation/update signal; after relevant events, components refresh REST data rather than building authoritative state entirely from event payloads.

This makes reconnects and missed events easier to recover from.

## 7. User-facing job state

Backend state strings are intentionally mapped through `src/lib/job-state.ts` instead of being printed directly.

Typical display states include:

```text
Waiting
Starting transcription
Transcribing
Preparing cleanup
Cleaning
Waiting for cleanup
Paused
Completed
Failed
```

This is especially important for `retry_wait`: a recoverable provider/token condition should be shown as waiting/retrying, not as active CPU/network work and not as a terminal failure.

## 8. Home page

The Home page focuses on normal daily use:

- upload one or multiple recordings;
- create a batch implicitly from an upload;
- show current jobs and progress;
- expose pause/resume/cancel/retry actions;
- show model readiness when relevant;
- surface recently completed work.

Advanced server metrics and token configuration remain on Statistics/Settings rather than cluttering the upload workflow.

## 9. Files page

The Files page is the recording library. It provides:

- file search;
- status filtering;
- description/tags;
- playback entry point;
- transcript reader entry point;
- downloads;
- source-file management;
- explicit offline save/remove controls;
- Re-clean action whenever a normalized transcript is available;
- offline-library fallback when the backend cannot be reached.

### Re-clean UX

The frontend calls:

```text
POST /api/jobs/{jobId}/reclean
```

The action should remain visible for eligible files even when cleanup is already queued/running; in that case it can be disabled with explanatory text instead of disappearing.

Manual Re-clean does not rerun Whisper. It asks the backend to regenerate cleanup from the normalized transcript.

## 10. Audio player

The player is optimized for review/correction rather than being a generic media player.

### Core controls

- play/pause;
- seek slider;
- jump backward/forward;
- variable playback rate;
- synchronized subtitle display;
- transcript-side seek/edit controls;
- edited-text download;
- offline-save action;
- edit-loop toggle.

### Active cue lookup

The player uses binary search over cue start times instead of scanning thousands of cues on every `timeupdate`.

This keeps active-cue lookup approximately logarithmic even for recordings with 4,000–5,000 subtitle rows.

### Transcript virtualization/windowing

The desktop transcript pane does not mount every cue at once. It renders a generous window around the active cue and provides navigation to earlier/later regions.

This prevents long recordings from creating thousands of React nodes and makes playback updates much cheaper.

## 11. Local cue editor

Subtitle corrections made in the player are **frontend-only**.

The backend cleaned transcript remains immutable from the browser editor. Local edits are stored as sparse overrides:

```text
fileId + cueId -> edited text
```

Display text is conceptually:

```text
local override ?? backend cleaned cue text
```

### Performance model

The editor does not rebuild the complete multi-thousand-cue transcript on every keystroke.

Typing updates one local textarea state. Persistence is debounced (currently around 650 ms), while explicit Done/cue-switch actions commit any unsaved draft immediately.

This avoids the previous expensive pattern of rerendering a full transcript and writing IndexedDB for every typed character.

### Switching cues while editing

When the user clicks another transcript line:

1. the current draft is committed first;
2. local edit state is updated;
3. the editor switches to the selected cue;
4. playback behavior depends on edit-loop mode.

This prevents the last typed characters from being lost when moving quickly through a transcript.

## 12. Edit-loop mode

Edit-loop mode is designed for correcting uncertain speech.

When enabled and a cue is selected for editing:

1. the selected cue is played through its end;
2. audio pauses for approximately **300 ms**;
3. playback seeks to the cue start;
4. the cue plays again;
5. the loop repeats while editing.

If the selected cue is already playing, playback is allowed to continue to its end before the loop starts. Selecting a different cue commits the current edit, seeks to the new cue, and begins looping that cue.

The player pins the displayed/highlighted subtitle to the cue being edited during the intentional 300 ms gap so the UI does not flicker briefly to the following subtitle.

The intentional loop pause is also separated from a user pause so the transport button does not flash between play/pause every loop iteration.

When editing is finished, the loop is cancelled and normal playback continues from its current position rather than forcibly replaying the completed edit again.

## 13. Text viewer

The text viewer is optimized for reading rather than subtitle inspection.

Features include:

- centered readable text width;
- explicit Persian RTL content;
- adjustable zoom;
- copy;
- download;
- local edited-text awareness;
- offline fallback.

When local cue edits exist, the viewer constructs the readable text from cleaned cues plus those local overrides. Otherwise it prefers the backend's final readable text artifact.

## 14. Offline architecture

Offline support deliberately separates two storage layers.

### Service worker / Cache Storage

Workbox caches the **application shell and static assets**:

```text
HTML
JavaScript
CSS
icons
fonts
```

It should not blindly cache backend API responses or audio streams.

### IndexedDB

User-selected completed recordings are saved explicitly to IndexedDB.

Database:

```text
persian-stt-offline
```

Current schema version:

```text
2
```

Stores:

```text
offlineFiles
transcripts
cueEdits
editedTexts
```

## 15. Offline bundle contents

An explicitly saved offline recording contains:

### `offlineFiles`

- file ID/job ID/batch ID;
- source filename;
- duration;
- byte size;
- MIME type;
- description/tags;
- saved timestamp;
- **complete audio Blob**.

### `transcripts`

- file/job ID;
- transcript version;
- source name;
- cleaned text;
- cleaned timed cues;
- saved timestamp.

### `cueEdits`

Sparse user corrections keyed by:

```text
<fileId>:<cueId>
```

### `editedTexts`

A generated edited-text snapshot for convenient offline reading/download.

## 16. Offline-save safety

Saving a file offline is explicit rather than automatically filling browser storage.

Before a save, the frontend:

- requests persistent browser storage when supported;
- estimates available quota;
- downloads the complete audio Blob;
- writes audio/transcript/edited snapshot to IndexedDB.

After the write completes, it reads the stored audio record back and verifies the Blob byte size. A failed/incomplete large-Blob save is therefore not reported as successful.

Removing an offline audio/transcript bundle does **not** erase sparse cue edits. User corrections are intentionally retained separately.

## 17. Offline playback

When the server is unavailable but an offline bundle exists, the player creates a local object URL:

```ts
URL.createObjectURL(audioBlob)
```

The `<audio>` element therefore plays the complete locally stored Blob instead of depending on backend range requests.

The player/text viewer load cached transcript data and local edits from IndexedDB.

## 18. Files page offline fallback

If `/api/files` cannot be reached, the Files page switches to the local offline library and allows users to access saved recordings instead of presenting an empty/broken page.

`navigator.onLine` is not treated as proof that the backend exists; actual API failure determines server availability.

## 19. PWA configuration

The current project uses `vite-plugin-pwa` with an auto-updating service worker.

The manifest includes standard and maskable PNG icons and optional screenshots for richer install UI.

Typical manifest essentials:

```text
name / short_name
description
id: /
start_url: /
scope: /
display: standalone
theme_color
background_color
192x192 + 512x512 icons
maskable icons
```

Recommended static files:

```text
public/
├── favicon.svg
├── apple-touch-icon.png
├── pwa-192x192.png
├── pwa-512x512.png
├── pwa-maskable-192x192.png
├── pwa-maskable-512x512.png
└── screenshots/
    ├── home-mobile.png
    └── home-desktop.png
```

### Workbox policy

The service worker should cache the SPA/static assets and use an SPA navigation fallback while excluding `/api`.

Conceptually:

```ts
workbox: {
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//],
  globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
}
```

Do not add broad runtime caching for:

```text
/api/jobs
/api/files
/api/files/.../stream
/api/subtitles
```

Application data has explicit semantics and belongs in REST + IndexedDB, not an opaque service-worker network cache.

## 20. Secure-context requirement

Installed PWA/service-worker behavior requires a trusted secure context in production.

For a LAN deployment, HTTPS can be terminated locally (for example by Caddy with an internal CA), provided client devices trust that CA certificate.

The application itself remains accessible from FastAPI behind the reverse proxy.

## 21. Settings page

The Settings page manages:

- theme;
- transcription defaults;
- cleanup defaults;
- network proxy setting;
- Gemini API tokens;
- token priority/limits;
- provider circuit state/reset;
- advanced worker/upload settings where exposed.

Settings are backend runtime defaults. Per-job transcription/cleaning settings may already be snapshotted and therefore are not retroactively rewritten by changing a global default.

## 22. Statistics page

Statistics combines:

- loaded job history;
- completed/failed counts;
- processed audio duration;
- Gemini request/token usage;
- worker state;
- CPU/RAM/disk usage;
- provider circuit state;
- batch history.

System resources can update from `/api/system/stream`, while historical records refresh from REST.

## 23. Theme and typography

The frontend supports theme selection through its theme provider.

Vazirmatn is packaged locally through Fontsource so deployed Persian text does not depend on an external font CDN.

Persian content uses explicit:

```html
dir="rtl"
lang="fa"
```

while the general application shell remains LTR.

## 24. Development

Requirements:

```text
Node.js >= 22.12
npm
```

From `frontend/`:

```bash
npm install
npm run dev
```

The Vite dev server listens on the LAN (`host: true`) and proxies `/api` to `VITE_BACKEND_ORIGIN`.

TypeScript check:

```bash
npm run check
```

Production build:

```bash
npm run build
```

Preview:

```bash
npm run preview
```

## 25. Production deployment

The production frontend is static output in:

```text
frontend/dist/
```

The FastAPI backend detects `frontend/dist/index.html` and, when present:

- serves Vite assets;
- serves the SPA;
- keeps `/api` reserved for backend routes;
- falls back to `index.html` for unknown non-API client routes.

A multi-stage Docker build can compile the frontend before constructing the Python runtime image:

```text
Node build stage
    ↓
frontend/dist
    ↓
Python runtime stage
    ↓
/app/frontend/dist
    ↓
FastAPI serves UI + API
```

No Node server is needed in production.

## 26. API modules

Frontend API wrappers are separated by domain:

```text
api/artifacts.ts
api/batches.ts
api/client.ts
api/events.ts
api/files.ts
api/jobs.ts
api/settings.ts
api/subtitles.ts
api/system.ts
api/tokens.ts
```

This keeps components from embedding raw endpoint details everywhere.

## 27. Error handling

Axios errors are normalized through the common API client layer before being shown to users.

The UI generally uses toasts for action failures and dedicated page state for persistent conditions such as server unavailability.

For offline-capable pages, a backend fetch failure should fall back to IndexedDB when possible rather than immediately turning into an unrecoverable error screen.

## 28. Performance considerations

Long recordings are the dominant frontend performance constraint.

Important strategies already used:

- binary-search active cue selection;
- limited transcript DOM window instead of thousands of rows;
- local textarea draft state during editing;
- debounced sparse IndexedDB edit writes;
- edited-text snapshot update outside the immediate keystroke render path;
- object URLs for complete offline audio;
- SSE as invalidation rather than a large continuously growing client state store.

Avoid reintroducing patterns such as:

```text
map all 5000 cues on every timeupdate
rebuild full edited transcript on every keystroke
write one large IndexedDB record per character
```

## 29. Backend/frontend ownership boundaries

### Backend owns

- original uploaded audio;
- Whisper output;
- cue IDs/timestamps;
- normalized transcript;
- Gemini-cleaned canonical artifacts;
- queue/task state;
- cleanup integrity verification.

### Frontend owns

- UI state;
- theme;
- PWA caches;
- selected offline copies;
- local cue overrides;
- local edited-text snapshot;
- edit-loop playback behavior.

Local edits are intentionally not synchronized back to canonical backend artifacts.

## 30. Security scope

The frontend assumes the backend is on a trusted LAN. Because there is currently no user authentication, installing the PWA or serving it through HTTPS does not by itself make a public deployment safe.

Before exposing the system publicly, backend authentication/authorization and a public-access policy must be added first.

# Persian STT Frontend

Frontend v1.0.0 for the Persian STT backend v2.2.x.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui-style source components and CSS variables
- React Router
- Axios for REST
- native `EventSource` for SSE
- Vazirmatn through Fontsource, bundled by Vite for local/self-hosted Persian text
- Lucide icons

The application shell is English/LTR. Persian transcript and subtitle regions are explicitly RTL and use Vazirmatn.

## Pages

- `/` — upload audio, current jobs, recently completed jobs
- `/files` — recordings, tags/descriptions, play/read/download
- `/statistics` — job/batch history, server health, worker/circuit state and Gemini usage
- `/settings` — transcription, cleaning, tokens, proxy and advanced defaults
- `/player/:jobId` — standalone audio player with synchronized Persian subtitles
- `/text/:jobId` — standalone RTL transcript reader with zoom/copy/download

The Home page intentionally does not expose system graphs, token configuration or advanced settings.

## Development

Requirements: Node.js 22+ and npm.

```bash
cp .env.example .env
npm install
npm run dev
```

By default the Vite development server proxies `/api` to:

```text
http://192.168.0.150:8000
```

Change `VITE_BACKEND_ORIGIN` in `.env` if necessary. Browser code always uses relative `/api/...` URLs, so no frontend code changes are required between development and production.

## Production build

```bash
npm run build
```

The production artifact is the normal Vite `dist/` directory. It is static HTML/CSS/JS; there is no Node server in production.

Backend v2.2.x can serve this directory from the same FastAPI port. Copy it into the backend project as:

```text
frontend/dist/
```

or use:

```bash
npm run deploy:backend -- /path/to/persian-stt-backend
```

Then rebuild/restart the backend container so the `frontend/dist` files are present in the image/container filesystem.

## Network behavior

REST uses Axios. Live job changes use `/api/events/stream` through native SSE. Statistics can use `/api/system/stream` for live resource status. REST remains the source of truth: after an SSE event, relevant state is refreshed from the API instead of reconstructing the entire backend state from event payloads.

## Job display state

UI components do not print backend state strings directly. `src/lib/job-state.ts` maps combinations of job/task/stage state to simple user-facing states such as:

- Waiting
- Starting transcription
- Transcribing
- Preparing cleanup
- Cleaning
- Waiting for cleanup
- Paused
- Completed
- Failed

This specifically handles `retry_wait` and recoverable Gemini/network conditions without presenting them as active work.

## Fonts

Vazirmatn is included as the `@fontsource/vazirmatn` dependency. Vite packages the required webfont assets into the production build, so the deployed app does not depend on an external font CDN.

## Git version

Initial frontend release: `v1.0.0`.

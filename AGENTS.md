# AGENTS.md — Komari-Theme-LuminaPlus

## Project structure
- React 19 + TypeScript + Vite + Tailwind CSS v4 (`@import "tailwindcss"` syntax, not v3)
- `@/` path alias → `./src/` (configured in `vite.config.ts` + `tsconfig.app.json`)
- Custom in-memory store (`services/wsStore.ts`) — observer pattern with `subscribe`/`getSnapshot`, **not** Zustand/Redux. Connected to React via `useSyncExternalStore` (`hooks/useNode.ts`)
- WebSocket RPC2 client (`services/rpc2Client.ts`) with automatic HTTP fallback per-request
- Zod schemas for runtime API validation in `types/komari.ts` and `services/api.ts`

## Developer commands
| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` (project references) then `vite build` |
| `npm run package` | `build` → `scripts/make-preview.mjs` → `scripts/package-zip.mjs` |
| `npm run release` | version alignment check → typecheck → build → package |
| `npm run lint` | ESLint (React Hooks rules only) |
| `npm run typecheck` | `tsc -b` standalone |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` (watch mode) |

## Build & release quirks
- `tsc -b` uses project references (`tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`)
- Version must match between `package.json` and `komari-theme.json` before release
- Preview image is copied from `docs/images/theme-preview.png` to `preview.png`
- Packaged zip (`Komari-Theme-LuminaPlus-vX.Y.Z.zip`) includes `komari-theme.json`, `preview.png`, and `dist/`
- CI publishes GitHub release on `v*` tags, release notes from `.github/release-notes/<tagname>.md`, falling back to `v1.1.4.md`

## Code conventions
- `verbatimModuleSyntax` — use `import type` for type-only imports
- `noUnusedLocals` and `noUnusedParameters` are **errors**
- ESLint only enforces `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps` (warn). All other linting is by `tsc -b`
- CSS via Tailwind v4 + custom CSS files in `src/styles/` (no CSS modules)

## Testing
- Vitest (`vitest run` / `vitest`)
- Tests live in `__tests__/` dirs alongside source files
- Tests found in: `services/__tests__/`, `utils/__tests__/`, `components/instance/__tests__/`, `components/ui/__tests__/`

## Architecture notes
- Two independent polling intervals: real-time metrics every **2s**, node info every **30s**
- Scroll activity defers live status refreshes until 160ms idle
- WebSocket RPC2 reconnects with exponential backoff (3s → 30s max), unlimited retries
- WebSocket client and store both have `import.meta.hot.dispose` cleanup for HMR
- Vite manual chunk splitting: `react`, `query`, `charts` (uplot), `validation` (zod)
- Background/theme settings cached in `localStorage` with `komaritheme:` prefix, applied before first paint via inline `<script>` in `index.html`

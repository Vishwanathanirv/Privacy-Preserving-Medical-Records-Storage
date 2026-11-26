# MedVault

A health wallet: each record is encrypted (AES-256-GCM) and hidden reversibly inside its own scan. Vite + React + TypeScript + Tailwind web app; Fastify API on SQLite; shared crypto and imaging in `packages/core`. The live demo runs the API inside the browser (`apps/web/src/demo`, `VITE_DEMO=1`).

## Commands
- `npm run dev` · `npm run build`
- `npm run lint && npm run typecheck && npm test` before every commit
- `npm run test:e2e` (Playwright on the demo build). On Windows `build:demo` fails on its env syntax: run `VITE_DEMO=1 npx vite build` in `apps/web`, then `npx playwright test`.
- `npm run benchmark` · `npm run samples` (re-downloads and checksums the sample scans)

## Layout
- `packages/core` crypto, reversible data hiding (`rdh.ts`), DICOM, Merkle log, proofs, emergency cards
- `apps/api/src` routes (`app.ts`), service, SQLite schema (`db.ts`), vault, transparency log
- `apps/web/src` app shell (`main.tsx`), pages (Login, Patient, Doctor, Admin, Record, Emergency), `proof.tsx`, `loans.tsx`
- `samples` real openly licensed scans with source, licence and checksums

## Rules
- One dark theme. No italics. No "How it works", intro cards, "Try it" or login wall: demo people open in one click.
- Scans shown in the UI carry their source and licence.
- People are fictional and must be labelled so; never store real patient data without a security review.
- No personal details or repo links in code, UI or metadata.

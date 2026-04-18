# Thicket

A quiet two-minute word association game. You say a word, Claude answers with one. The goal is the Goldilocks zone — not too obvious, not too clever.

## Stack

- **Vite + React** frontend
- **Vercel serverless function** (`/api/claude`) that proxies the Anthropic API
- **Claude Haiku 4.5** for per-turn word generation (fast, cheap)
- **Claude Sonnet 4.5** for post-game Goldilocks scoring + coaching note

Design: Japandi × biophilic × forest floor.

## Local development

```bash
npm install

# Point the frontend at a local serverless dev shim if you want,
# or use `vercel dev` to run the full stack locally.
npm run dev
```

Set an env var so the serverless function can call Anthropic:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

On Vercel, add `ANTHROPIC_API_KEY` in the project's Environment Variables.

## Deploy

This repo is a plain Vercel project. Either:

1. Import it on [vercel.com](https://vercel.com/new) — Vercel will detect Vite automatically.
2. Or run `vercel --prod` after `npm i -g vercel && vercel login`.

Add `ANTHROPIC_API_KEY` to the Vercel project env vars before deploying.

## Controls

- `Cmd/Ctrl + .` — open the Tweaks panel (text size, contrast, palette, paper grain, Claude voice style)
- `Enter` — submit your word
- `end early` — finish the round before the timer runs out

## Files

- `src/App.jsx` — the full game UI (start / play / end screens)
- `src/index.css` — tokens, keyframes, paper grain
- `api/claude.js` — serverless proxy to the Anthropic API

Fallback word pool kicks in automatically if the API key is missing or the request fails, so the game still plays.

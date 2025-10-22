**Voice Agentic AI Web App**

Modern web experience that streams audio to and from OpenAI’s GPT‑4o Realtime model so you can prototype agentic voice flows in the browser.

## Stack
- Next.js 16 (App Router, TypeScript, Tailwind)
- OpenAI Realtime API (duplex audio via WebRTC)
- React client component managing microphone capture + remote playback
- Zustand, LangChain, LangGraph, LangSmith scaffolding (dependencies in place for upcoming agent orchestration work)

## Local Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from the provided example and add an API key with GPT‑4o Realtime access:
   ```bash
   cp .env.example .env
   # edit .env and set OPENAI_API_KEY
   ```
   Optional: override `OPENAI_REALTIME_MODEL` if you want a specific preview version.
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Visit [http://localhost:3000](http://localhost:3000) and grant microphone permission. Click **Start** to negotiate a realtime session, **Stop** to end it.

## Scripts
- `npm run dev` – start Next.js in development mode.
- `npm run build` / `npm start` – production build and serve.
- `npm run lint` – run Next.js lint checks.
- `npm run typecheck` – TypeScript type checks.

## Next Steps
- Wire LangGraph functions to enable tool calling and multi-agent flows.
- Persist transcripts and agent state (Supabase/Redis).
- Add automated smoke tests (Playwright) around the voice loop.

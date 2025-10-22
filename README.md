**Voice Agentic AI Web App**

Modern web experience that streams audio to and from OpenAI’s GPT‑4o Realtime model so you can prototype agentic voice flows in the browser.

## Stack
- Next.js 16 (App Router, TypeScript, Tailwind)
- OpenAI Realtime API (duplex audio via WebRTC)
- React client component managing microphone capture + remote playback
- Zustand, LangChain, LangGraph, LangSmith scaffolding (dependencies in place for upcoming agent orchestration work)
- Server-executed tools exposed to GPT‑4o (weather + current time) with automatic function-call handling

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
   Optional: override `OPENAI_REALTIME_MODEL` (or `OPENAI_TRANSCRIPTION_MODEL` to change/disable live captions).
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Visit [http://localhost:3000](http://localhost:3000) and grant microphone permission. Click **Start** to negotiate a realtime session, **Stop** to end it. Once connected, speak naturally or use the text composer to send a typed follow-up—both appear in the live conversation log together with assistant replies.

### Built-in Tools
- `get_weather_forecast` – hits the public [wttr.in](https://wttr.in) endpoint (no key required) to summarize current conditions plus a short forecast for the requested city.
- `get_current_time` – returns the server's current ISO timestamp.

Tool outputs stream back into the conversation automatically; you can extend the registry under `src/server/tools`.

## Scripts
- `npm run dev` – start Next.js in development mode.
- `npm run build` / `npm start` – production build and serve.
- `npm run lint` – run Next.js lint checks.
- `npm run typecheck` – TypeScript type checks.

## Next Steps
- Wire LangGraph functions to enable tool calling and multi-agent flows.
- Persist transcripts and agent state (Supabase/Redis).
- Add automated smoke tests (Playwright) around the voice loop.

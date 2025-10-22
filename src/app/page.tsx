import { VoiceAgent } from "@/components/voice-agent";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-100 via-white to-zinc-200 py-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-6">
        <header className="flex w-full flex-col gap-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            Voice Agentic AI
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
            Start exploring real-time conversational AI with voice.
          </h1>
          <p className="max-w-3xl text-lg text-zinc-600">
            Connect your microphone, stream audio to GPT-4o Realtime, and hear
            the agent respond instantly. This playground wires up the client
            voice loop so we can iterate on agent orchestration next.
          </p>
        </header>
        <VoiceAgent />
        <footer className="w-full text-sm text-zinc-500">
          Tip: Provide your OpenAI API key in a local <code>.env</code> file to
          enable the realtime session token endpoint.
        </footer>
      </div>
    </div>
  );
}

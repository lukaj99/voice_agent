"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SessionResponse = {
  client_secret: { value: string };
  model: string;
};

type TranscriptMap = Record<string, string>;

const REALTIME_URL = "https://api.openai.com/v1/realtime";

export function VoiceAgent() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const responseBufferRef = useRef<TranscriptMap>({});
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const isActive = status === "connected";

  const resetSession = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    responseBufferRef.current = {};
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setTranscripts([]);
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => resetSession();
  }, [resetSession]);

  const handleRealtimeEvent = useCallback((message: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(message.data);

      if (payload.type === "response.output_text.delta") {
        const responseId = payload.response_id as string;
        const delta = payload.delta as string;
        responseBufferRef.current[responseId] =
          (responseBufferRef.current[responseId] ?? "") + delta;
        setTranscripts(Object.values(responseBufferRef.current));
      } else if (payload.type === "response.completed") {
        setTranscripts(Object.values(responseBufferRef.current));
      }
    } catch (e) {
      console.warn("Unhandled realtime payload", e);
    }
  }, []);

  const attachRemoteAudio = useCallback((event: RTCTrackEvent) => {
    const [stream] = event.streams;
    if (!stream) return;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      const promise = remoteAudioRef.current.play();
      if (promise) {
        promise.catch((err) => {
          console.warn("Autoplay failed", err);
        });
      }
    }
  }, []);

  const startSession = useCallback(async () => {
    if (status !== "idle") {
      return;
    }

    setError(null);
    setStatus("connecting");

    try {
      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
      });

      if (!sessionResponse.ok) {
        throw new Error("Unable to create realtime session");
      }

      const session = (await sessionResponse.json()) as SessionResponse;

      const peerConnection = new RTCPeerConnection();

      peerConnection.ontrack = attachRemoteAudio;
      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "failed") {
          setError("Connection failed");
          resetSession();
        }
      };

      peerRef.current = peerConnection;

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.onmessage = handleRealtimeEvent;
      dataChannel.onopen = () => setStatus("connected");
      dataChannel.onclose = () => {
        resetSession();
      };
      dataChannelRef.current = dataChannel;

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = localStream;
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `${REALTIME_URL}?model=${session.model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.client_secret.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );

      if (!sdpResponse.ok) {
        throw new Error("Failed to negotiate realtime session");
      }

      const answer = {
        type: "answer" as const,
        sdp: await sdpResponse.text(),
      };

      await peerConnection.setRemoteDescription(answer);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unknown error");
      resetSession();
    }
  }, [attachRemoteAudio, handleRealtimeEvent, resetSession, status]);

  const stopSession = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const indicator = useMemo(() => {
    if (status === "connected") return "Connected";
    if (status === "connecting") return "Connecting…";
    return "Idle";
  }, [status]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-zinc-200 bg-white/80 p-8 shadow-sm backdrop-blur md:p-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Voice Agent Playground
        </h1>
        <p className="text-sm text-zinc-600">
          Stream audio to and from GPT-4o Realtime. Start to connect, stop to
          end the session.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-zinc-50 p-4">
        <div>
          <p className="text-sm font-medium text-zinc-800">Status</p>
          <p className="text-sm text-zinc-600">{indicator}</p>
          {error ? (
            <p className="mt-2 text-sm text-red-600">Error: {error}</p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={startSession}
            disabled={status !== "idle"}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stopSession}
            disabled={!isActive && status !== "connecting"}
            className="rounded-full border border-zinc-200 px-5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-800">Transcripts</p>
        <div className="min-h-[120px] rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 p-4 text-sm text-zinc-700">
          {transcripts.length > 0 ? (
            transcripts.map((segment, index) => (
              <p key={index} className="leading-relaxed">
                {segment}
              </p>
            ))
          ) : (
            <p className="text-zinc-500">No messages yet.</p>
          )}
        </div>
      </div>

      <audio ref={remoteAudioRef} autoPlay className="hidden" />
    </div>
  );
}

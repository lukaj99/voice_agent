"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ToolName } from "@/config/tools";

type SessionResponse = {
  client_secret: { value: string };
  model: string;
};

type TranscriptMap = Record<string, string>;

type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  status: "streaming" | "complete";
  toolName?: ToolName;
};

const REALTIME_URL = "https://api.openai.com/v1/realtime";

type PendingToolCall = {
  toolName: ToolName;
  responseId: string;
  itemId: string;
  argumentsBuffer: string;
  messageId: string;
  status: "collecting" | "executing" | "completed" | "failed";
};

export function VoiceAgent() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [inputLevel, setInputLevel] = useState(0);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const responseBufferRef = useRef<TranscriptMap>({});
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Float32Array | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const pendingToolCallsRef = useRef<Map<string, PendingToolCall>>(
    new Map(),
  );

  const upsertMessage = useCallback(
    (update: {
      id: string;
      role?: AgentMessage["role"];
      content?: string;
      status?: AgentMessage["status"];
      toolName?: ToolName;
    }) => {
      setMessages((prev) => {
        const index = prev.findIndex((msg) => msg.id === update.id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = {
            ...next[index],
            role: update.role ?? next[index].role,
            content: update.content ?? next[index].content,
            status: update.status ?? next[index].status,
            toolName: update.toolName ?? next[index].toolName,
          };
          return next;
        }
        return [
          ...prev,
          {
            id: update.id,
            role: update.role ?? "assistant",
            content: update.content ?? "",
            status: update.status ?? "streaming",
            toolName: update.toolName,
          },
        ];
      });
    },
    [],
  );

  const isActive = status === "connected";

  const stopLevelMonitor = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    analyserDataRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setInputLevel(0);
  }, []);

  const stopStatsMonitor = useCallback(() => {
    if (statsIntervalRef.current !== null) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setRoundTripMs(null);
  }, []);

  const startLevelMonitor = useCallback(
    async (stream: MediaStream) => {
      try {
        stopLevelMonitor();

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }

        if (audioContextRef.current.state === "suspended") {
          await audioContextRef.current.resume();
        }

        const source =
          sourceNodeRef.current ??
          audioContextRef.current.createMediaStreamSource(stream);
        const analyser =
          analyserRef.current ?? audioContextRef.current.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const data =
          analyserDataRef.current ??
          new Float32Array(analyser.fftSize);

        sourceNodeRef.current = source;
        analyserRef.current = analyser;
        analyserDataRef.current = data;

        const updateLevel = () => {
          if (!analyserRef.current || !analyserDataRef.current) {
            return;
          }

          const array = analyserDataRef.current;
          if (!array) {
            return;
          }

          analyserRef.current.getFloatTimeDomainData(
            array as unknown as Float32Array<ArrayBuffer>,
          );
          let sumSquares = 0;
          for (const sample of array) {
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / array.length);
          setInputLevel((prev) => prev * 0.7 + rms * 0.3);
          levelRafRef.current = requestAnimationFrame(updateLevel);
        };

        updateLevel();
      } catch (err) {
        console.warn("Unable to start level monitor", err);
      }
    },
    [stopLevelMonitor],
  );

  const startStatsMonitor = useCallback(
    (connection: RTCPeerConnection) => {
      stopStatsMonitor();
      const intervalId = window.setInterval(async () => {
        try {
          const stats = await connection.getStats();
          let bestRtt: number | null = null;
          stats.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              report.state === "succeeded" &&
              typeof report.currentRoundTripTime === "number"
            ) {
              const rttMs = report.currentRoundTripTime * 1000;
              if (!bestRtt || rttMs < bestRtt) {
                bestRtt = rttMs;
              }
            }
          });
          if (bestRtt !== null) {
            setRoundTripMs(Math.round(bestRtt));
          }
        } catch (err) {
          console.warn("Failed to read connection stats", err);
        }
      }, 2000);

      statsIntervalRef.current = intervalId;
    },
    [stopStatsMonitor],
  );

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
    stopStatsMonitor();
    stopLevelMonitor();
    pendingToolCallsRef.current.clear();
    setRoundTripMs(null);
    setMessages([]);
    setTextInput("");
    setStatus("idle");
  }, [stopLevelMonitor, stopStatsMonitor]);

  useEffect(() => {
    return () => resetSession();
  }, [resetSession]);

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

  const stopSession = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const sendClientEvent = useCallback(
    (event: Record<string, unknown>) => {
      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open") {
        setError("Realtime channel is not ready yet.");
        return;
      }
      channel.send(JSON.stringify(event));
    },
    [setError],
  );

  const executeToolCall = useCallback(
    async (callId: string) => {
      const pending = pendingToolCallsRef.current.get(callId);
      if (!pending || pending.status === "executing") {
        return;
      }

      pending.status = "executing";
      pendingToolCallsRef.current.set(callId, pending);

      upsertMessage({
        id: pending.messageId,
        role: "tool",
        content: `Running ${pending.toolName}…`,
        status: "streaming",
        toolName: pending.toolName,
      });

      try {
        let args = {};
        if (pending.argumentsBuffer && pending.argumentsBuffer.length > 0) {
          try {
            args = JSON.parse(pending.argumentsBuffer);
          } catch (parseErr) {
            const errorMessage = "Malformed tool arguments: " + (parseErr instanceof Error ? parseErr.message : String(parseErr));
            upsertMessage({
              id: pending.messageId,
              role: "tool",
              content: `Tool ${pending.toolName} failed: ${errorMessage}`,
              status: "complete",
              toolName: pending.toolName,
            });
            sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callId,
                output: JSON.stringify({
                  error: true,
                  message: errorMessage,
                }),
              },
            });
            sendClientEvent({ type: "response.create" });
            pending.status = "failed";
            pendingToolCallsRef.current.delete(callId);
            return;
          }
        }

        const response = await fetch("/api/tools/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolName: pending.toolName,
            arguments: args,
          }),
        });

        const json = (await response.json()) as {
          success?: boolean;
          result?: { content?: string; data?: Record<string, unknown> };
          error?: string;
        };

        if (!response.ok || !json.success || !json.result) {
          throw new Error(
            json.error ??
              `Tool ${pending.toolName} failed with status ${response.status}`,
          );
        }

        const toolContent =
          json.result.content ??
          `Tool ${pending.toolName} executed successfully.`;

        upsertMessage({
          id: pending.messageId,
          role: "tool",
          content: toolContent,
          status: "complete",
          toolName: pending.toolName,
        });

        const outputPayload = {
          content: toolContent,
          data: json.result.data ?? {},
        };

        sendClientEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(outputPayload),
          },
        });

        sendClientEvent({ type: "response.create" });
        pending.status = "completed";
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown tool error";
        upsertMessage({
          id: pending.messageId,
          role: "tool",
          content: `Tool ${pending.toolName} failed: ${errorMessage}`,
          status: "complete",
          toolName: pending.toolName,
        });

        sendClientEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              error: true,
              message: errorMessage,
            }),
          },
        });
        sendClientEvent({ type: "response.create" });
        pending.status = "failed";
      } finally {
        pendingToolCallsRef.current.delete(callId);
      }
    },
    [sendClientEvent, upsertMessage],
  );

  const sendTextMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const itemId = `msg_${crypto.randomUUID()}`;

      sendClientEvent({
        type: "conversation.item.create",
        item: {
          id: itemId,
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: trimmed,
            },
          ],
        },
      });

      sendClientEvent({ type: "response.create" });

      upsertMessage({
        id: itemId,
        role: "user",
        content: trimmed,
        status: "complete",
      });
      setTextInput("");
    },
    [sendClientEvent, upsertMessage],
  );

  const handleRealtimeEvent = useCallback(
    (message: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(message.data) as Record<string, unknown>;
        const type = payload.type;

        if (type === "response.output_text.delta") {
          const responseId =
            (payload.response_id as string | undefined) ??
            (payload.response as { id?: string } | undefined)?.id;
          const delta = payload.delta as string | undefined;
          if (!responseId || !delta) return;

          const nextText =
            (responseBufferRef.current[responseId] ?? "") + delta;
          responseBufferRef.current[responseId] = nextText;
          upsertMessage({
            id: responseId,
            role: "assistant",
            content: nextText,
            status: "streaming",
          });
        } else if (type === "response.completed") {
          const responseId =
            (payload.response_id as string | undefined) ??
            (payload.response as { id?: string } | undefined)?.id;
          if (!responseId) return;
          const finalText = responseBufferRef.current[responseId] ?? "";
          upsertMessage({
            id: responseId,
            role: "assistant",
            content: finalText,
            status: "complete",
          });
        } else if (
          type === "conversation.item.input_audio_transcription.completed"
        ) {
          const itemId = payload.item_id as string | undefined;
          const transcript = payload.transcript as string | undefined;
          if (itemId && transcript) {
            upsertMessage({
              id: itemId,
              role: "user",
              content: transcript,
              status: "complete",
            });
          }
        } else if (type === "response.output_item.added") {
          const item = payload.item as
            | {
                type?: string;
                call_id?: string;
                name?: string;
                id?: string;
              }
            | undefined;
          const responseId = payload.response_id as string | undefined;

          if (
            item?.type === "function_call" &&
            item.call_id &&
            item.name &&
            responseId
          ) {
            const messageId = `tool_${item.call_id}`;
            pendingToolCallsRef.current.set(item.call_id, {
              toolName: item.name as ToolName,
              responseId,
              itemId: item.id ?? item.call_id,
              argumentsBuffer: "",
              messageId,
              status: "collecting",
            });

            upsertMessage({
              id: messageId,
              role: "tool",
              content: `Calling ${item.name}…`,
              status: "streaming",
              toolName: item.name as ToolName,
            });
          }
        } else if (type === "response.function_call_arguments.delta") {
          const callId = payload.call_id as string | undefined;
          const delta = payload.delta as string | undefined;
          if (!callId || !delta) return;
          const pending = pendingToolCallsRef.current.get(callId);
          if (pending) {
            pending.argumentsBuffer += delta;
            pendingToolCallsRef.current.set(callId, pending);
          }
        } else if (type === "response.function_call_arguments.done") {
          const callId = payload.call_id as string | undefined;
          const args = payload.arguments as string | undefined;
          if (!callId) return;
          const pending = pendingToolCallsRef.current.get(callId);
          if (pending) {
            pending.argumentsBuffer = args ?? pending.argumentsBuffer;
            pendingToolCallsRef.current.set(callId, pending);
            void executeToolCall(callId);
          }
        } else if (type === "response.error") {
          const errorMessage =
            (payload.error as { message?: string } | undefined)?.message ??
            "Realtime response error";
          setError(errorMessage);
        }
      } catch (e) {
        console.warn("Unhandled realtime payload", e);
      }
    },
    [executeToolCall, setError, upsertMessage],
  );

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
        const state = peerConnection.connectionState;
        if (state === "connected") {
          startStatsMonitor(peerConnection);
        }
        if (state === "failed") {
          setError("Connection failed");
          resetSession();
        }
        if (state === "disconnected" || state === "closed") {
          stopStatsMonitor();
        }
      };

      peerRef.current = peerConnection;

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.onmessage = handleRealtimeEvent;
      dataChannel.onopen = () => {
        setStatus("connected");
        setError(null);
        setMessages([]);
        responseBufferRef.current = {};
        pendingToolCallsRef.current.clear();
      };
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
      void startLevelMonitor(localStream);

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
  }, [
    attachRemoteAudio,
    handleRealtimeEvent,
    resetSession,
    startLevelMonitor,
    startStatsMonitor,
    setError,
    setMessages,
    status,
    stopStatsMonitor,
  ]);

  const indicator = useMemo(() => {
    if (status === "connected") return "Connected";
    if (status === "connecting") return "Connecting…";
    return "Idle";
  }, [status]);

  const levelPercent = Math.round(Math.min(1, Math.max(0, inputLevel)) * 100);
  const latencyLabel = roundTripMs !== null ? `${roundTripMs} ms` : "—";
  const canSend = textInput.trim().length > 0 && status === "connected";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-zinc-200 bg-white/80 p-8 shadow-sm backdrop-blur md:p-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Voice Agent Playground
        </h1>
        <p className="text-sm text-zinc-600">
          Stream audio to and from GPT-4o Realtime. Talk naturally or type a
          follow-up once the session is connected.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-zinc-50 p-4">
        <div>
          <p className="text-sm font-medium text-zinc-800">Status</p>
          <p className="text-sm text-zinc-600">{indicator}</p>
          {error ? (
            <p className="mt-2 text-sm text-red-600">Error: {error}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <div className="min-w-[180px]">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Mic level
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-150 ease-out"
                  style={{ width: `${levelPercent}%` }}
                />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Estimated RTT
              </p>
              <p className="mt-2 text-sm text-zinc-700">{latencyLabel}</p>
            </div>
          </div>
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
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-800">Conversation</p>
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {messages.length} {messages.length === 1 ? "turn" : "turns"}
          </span>
        </div>
        <div className="flex h-64 flex-col gap-4 overflow-y-auto rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 p-4">
          {messages.length > 0 ? (
            messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isUser = message.role === "user";
              const isTool = message.role === "tool";
              const speakerLabel = isTool
                ? `Tool • ${message.toolName ?? "function"}`
                : isAssistant
                  ? "Lumi"
                  : "You";
              const alignmentClass = isUser ? "justify-end" : "justify-start";
              const bubbleClass = isUser
                ? "bg-emerald-500 text-white"
                : isTool
                  ? "bg-zinc-200 text-zinc-800 border border-zinc-300"
                  : "bg-white text-zinc-800";
              const statusLabel = isTool
                ? "executing…"
                : isAssistant
                  ? "thinking…"
                  : "recording…";

              return (
                <div key={message.id} className={`flex ${alignmentClass}`}>
                  <div className="flex max-w-[80%] flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {speakerLabel}
                    </span>
                    <div
                      className={`rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm ${bubbleClass}`}
                    >
                      <p className="whitespace-pre-line">
                        {message.content || "…"}
                      </p>
                      {message.status === "streaming" ? (
                        <span className="mt-1 inline-block text-xs opacity-80">
                          {statusLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-zinc-500">
              Say something or type a message once the session is connected.
            </p>
          )}
        </div>
        <form
          className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/90 p-3 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            if (status !== "connected") return;
            sendTextMessage(textInput);
          }}
        >
          <input
            type="text"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder={
              status === "connected"
                ? "Ask a follow-up with your keyboard…"
                : "Connect first to send text"
            }
            disabled={status !== "connected"}
            className="flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400 disabled:text-zinc-400"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Send
          </button>
        </form>
      </div>

      <audio ref={remoteAudioRef} autoPlay className="hidden" />
    </div>
  );
}

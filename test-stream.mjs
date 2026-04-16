/**
 * Simulates a Twilio Media Stream connection to the production server.
 * Sends a "start" event, then sends a few seconds of silence (μ-law encoded),
 * and watches what comes back.
 */
import { WebSocket } from "ws";
import alawmulaw from "alawmulaw";

const STREAM_URL = "wss://wrenchai-bokbst2i.manus.space/api/twiml/stream";
const CALL_SID = "CA_test_" + Date.now();
const STREAM_SID = "MZ_test_" + Date.now();

console.log(`[Test] Connecting to: ${STREAM_URL}`);
const ws = new WebSocket(STREAM_URL);

let audioReceived = 0;
let messagesReceived = 0;

ws.on("open", () => {
  console.log("[Test] WebSocket connected");

  // Step 1: Send "connected" event
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));

  // Step 2: Send "start" event (simulates Twilio call start)
  ws.send(JSON.stringify({
    event: "start",
    sequenceNumber: "1",
    start: {
      streamSid: STREAM_SID,
      callSid: CALL_SID,
      accountSid: "AC_test",
      from: "+15555550100",
      to: "+15555550200",
      tracks: ["inbound"],
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
    },
    streamSid: STREAM_SID,
  }));

  console.log("[Test] Sent start event — waiting for Gemini to connect and respond...");

  // Step 3: Send 5 seconds of silence (μ-law encoded zeros) in 20ms chunks
  // Twilio sends 160 bytes per 20ms chunk at 8kHz
  let chunksSent = 0;
  const SILENCE_CHUNK = Buffer.alloc(160, 0xFF); // μ-law silence is 0xFF
  const silenceBase64 = SILENCE_CHUNK.toString("base64");

  const silenceInterval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(silenceInterval);
      return;
    }
    ws.send(JSON.stringify({
      event: "media",
      sequenceNumber: String(chunksSent + 2),
      media: { track: "inbound", chunk: String(chunksSent), timestamp: String(chunksSent * 20), payload: silenceBase64 },
      streamSid: STREAM_SID,
    }));
    chunksSent++;

    // After 10 seconds, stop and close
    if (chunksSent >= 500) {
      clearInterval(silenceInterval);
      console.log(`[Test] Sent ${chunksSent} silence chunks. Audio received: ${audioReceived} chunks. Closing.`);
      ws.send(JSON.stringify({ event: "stop", streamSid: STREAM_SID }));
      setTimeout(() => ws.close(), 1000);
    }
  }, 20);
});

ws.on("message", (data) => {
  messagesReceived++;
  try {
    const msg = JSON.parse(data.toString());
    if (msg.event === "media") {
      audioReceived++;
      if (audioReceived === 1) {
        console.log(`[Test] ✅ AUDIO RECEIVED from server! First audio chunk arrived.`);
        console.log(`[Test] Payload length: ${msg.media?.payload?.length} chars`);
      }
      if (audioReceived % 50 === 0) {
        console.log(`[Test] Audio chunks received so far: ${audioReceived}`);
      }
    } else {
      console.log(`[Test] Non-audio message #${messagesReceived}:`, JSON.stringify(msg).substring(0, 200));
    }
  } catch (e) {
    console.log(`[Test] Raw message: ${data.toString().substring(0, 200)}`);
  }
});

ws.on("error", (err) => {
  console.error("[Test] WebSocket error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[Test] WebSocket closed: code=${code}, reason=${reason?.toString()}`);
  console.log(`[Test] Total messages received: ${messagesReceived}, audio chunks: ${audioReceived}`);
  process.exit(0);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log(`[Test] TIMEOUT — Total messages: ${messagesReceived}, audio: ${audioReceived}`);
  ws.close();
  process.exit(1);
}, 30000);

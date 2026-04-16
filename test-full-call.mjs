/**
 * Full end-to-end test of the Twilio → Gemini Live pipeline.
 * Connects to the local dev server's WebSocket stream endpoint,
 * sends a realistic Twilio media stream start event with lead params,
 * then sends silence and waits for audio to come back from Gemini.
 */
import { WebSocket } from "ws";

// Use the dev server
const STREAM_URL = "ws://localhost:3000/api/twiml/stream";
const CALL_SID = "CA_test_" + Date.now();
const STREAM_SID = "MZ_test_" + Date.now();

console.log(`[Test] Connecting to dev server: ${STREAM_URL}`);
const ws = new WebSocket(STREAM_URL);

let audioReceived = 0;
let startTime = null;

ws.on("open", () => {
  console.log("[Test] ✅ WebSocket connected to dev server");

  // Step 1: connected event
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));

  // Step 2: start event with lead params in customParameters
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
      customParameters: {
        leadName: "Test User",
        leadEmail: "test@example.com",
        agentName: "Alex",
      },
    },
    streamSid: STREAM_SID,
  }));

  startTime = Date.now();
  console.log("[Test] Sent start event — waiting for Gemini to connect and respond with audio...");

  // Send silence (μ-law 0xFF = silence) every 20ms
  let chunksSent = 0;
  const SILENCE_CHUNK = Buffer.alloc(160, 0xFF).toString("base64");

  const silenceInterval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(silenceInterval);
      return;
    }
    ws.send(JSON.stringify({
      event: "media",
      sequenceNumber: String(chunksSent + 2),
      media: { track: "inbound", chunk: String(chunksSent), timestamp: String(chunksSent * 20), payload: SILENCE_CHUNK },
      streamSid: STREAM_SID,
    }));
    chunksSent++;

    // Stop after 20 seconds
    if (chunksSent >= 1000) {
      clearInterval(silenceInterval);
      console.log(`[Test] Sent ${chunksSent} silence chunks. Audio received: ${audioReceived}. Closing.`);
      ws.send(JSON.stringify({ event: "stop", streamSid: STREAM_SID }));
      setTimeout(() => ws.close(), 1000);
    }
  }, 20);
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.event === "media") {
      audioReceived++;
      if (audioReceived === 1) {
        const elapsed = Date.now() - startTime;
        console.log(`[Test] ✅ AUDIO RECEIVED after ${elapsed}ms! Payload length: ${msg.media?.payload?.length}`);
      }
      if (audioReceived % 20 === 0) {
        console.log(`[Test] Audio chunks so far: ${audioReceived}`);
      }
      if (audioReceived >= 50) {
        console.log(`[Test] ✅ SUCCESS — 50+ audio chunks received. AI is talking!`);
        ws.send(JSON.stringify({ event: "stop", streamSid: STREAM_SID }));
        setTimeout(() => { ws.close(); process.exit(0); }, 500);
      }
    } else {
      console.log(`[Test] Non-audio msg: ${JSON.stringify(msg).substring(0, 100)}`);
    }
  } catch (e) {
    console.log(`[Test] Raw: ${data.toString().substring(0, 100)}`);
  }
});

ws.on("error", (err) => {
  console.error("[Test] ❌ Error:", err.message);
  process.exit(1);
});

ws.on("close", (code) => {
  console.log(`[Test] Closed: code=${code}, audio=${audioReceived}`);
  if (audioReceived === 0) {
    console.log("[Test] ❌ FAILED — no audio received");
    process.exit(1);
  }
});

setTimeout(() => {
  console.log(`[Test] TIMEOUT — audio=${audioReceived}`);
  if (audioReceived === 0) {
    console.log("[Test] ❌ FAILED");
    process.exit(1);
  }
  ws.close();
}, 25000);

/**
 * Direct test of Gemini Live API — bypasses Twilio entirely.
 * Tests: WebSocket connection, setup, text trigger, audio response.
 */
import { WebSocket } from "ws";
import { config } from "dotenv";
import { readFileSync } from "fs";

// Load env
config({ path: ".env" });
// Also try to read from process env directly
const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("ERROR: GOOGLE_AI_API_KEY not set");
  process.exit(1);
}

console.log(`[Test] API key found: ${GEMINI_API_KEY.substring(0, 8)}...`);

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

console.log(`[Test] Connecting to Gemini Live...`);
const ws = new WebSocket(GEMINI_WS_URL);

let setupComplete = false;
let audioChunksReceived = 0;
let textReceived = "";

ws.on("open", () => {
  console.log("[Test] ✅ Connected to Gemini Live WebSocket");

  // Send setup
  const setup = {
    setup: {
      model: `models/${GEMINI_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
        },
      },
      systemInstruction: {
        parts: [{ text: "You are a helpful assistant. Keep responses very short." }],
      },
    },
  };
  ws.send(JSON.stringify(setup));
  console.log("[Test] Setup message sent");
});

ws.on("message", (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.setupComplete !== undefined) {
      setupComplete = true;
      console.log("[Test] ✅ Setup complete! Sending text trigger...");

      // Try realtimeInput with text for 3.1 model
      ws.send(JSON.stringify({
        realtimeInput: {
          text: "Say hello in exactly 5 words.",
        },
      }));
    }

    if (msg.serverContent) {
      const content = msg.serverContent;

      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            audioChunksReceived++;
            if (audioChunksReceived === 1) {
              console.log(`[Test] ✅ AUDIO RECEIVED! mimeType=${part.inlineData.mimeType}, size=${part.inlineData.data.length} chars`);
            }
          }
          if (part.text) {
            textReceived += part.text;
            console.log(`[Test] Text: "${part.text}"`);
          }
        }
      }

      if (content.outputTranscription?.text) {
        console.log(`[Test] Transcription: "${content.outputTranscription.text}"`);
      }

      if (content.turnComplete) {
        console.log(`[Test] Turn complete. Audio chunks: ${audioChunksReceived}, Text: "${textReceived}"`);
        if (audioChunksReceived > 0) {
          console.log("[Test] ✅ SUCCESS — Gemini Live is working correctly!");
        } else {
          console.log("[Test] ❌ PROBLEM — No audio received despite turn complete");
        }
        ws.close();
      }
    }

    if (msg.error) {
      console.error("[Test] ❌ Gemini error:", JSON.stringify(msg.error));
      ws.close();
    }
  } catch (e) {
    console.log("[Test] Raw message:", data.toString().substring(0, 300));
  }
});

ws.on("error", (err) => {
  console.error("[Test] ❌ WebSocket error:", err.message);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`[Test] Closed: code=${code}, reason=${reason?.toString() || "(none)"}`);
  console.log(`[Test] Final: audio=${audioChunksReceived}, setupComplete=${setupComplete}`);
  process.exit(audioChunksReceived > 0 ? 0 : 1);
});

setTimeout(() => {
  console.log("[Test] TIMEOUT");
  ws.close();
}, 30000);

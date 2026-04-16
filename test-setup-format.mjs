/**
 * Tests different setup message formats for gemini-3.1-flash-live-preview
 * to find which fields cause the 1011 Internal Error.
 */
import { WebSocket } from "ws";
import { config } from "dotenv";
config();

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const MODEL = "gemini-3.1-flash-live-preview";
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

async function testSetup(name, setupMsg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let result = "timeout";
    ws.on("open", () => {
      ws.send(JSON.stringify(setupMsg));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.setupComplete !== undefined) {
        result = "success";
        ws.close();
      }
    });
    ws.on("close", (code, reason) => {
      if (result !== "success") result = `closed:${code}:${reason?.toString()?.substring(0, 80)}`;
      console.log(`[${name}]: ${result}`);
      resolve(result);
    });
    ws.on("error", (e) => { result = `error:${e.message}`; ws.close(); });
    setTimeout(() => { result = "timeout"; ws.close(); }, 8000);
  });
}

// Test 1: Minimal (known working)
await testSetup("minimal", {
  setup: {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    },
    systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
  },
});

// Test 2: With transcription fields
await testSetup("with-transcription", {
  setup: {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    },
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
  },
});

// Test 3: With tools (function declarations)
await testSetup("with-tools", {
  setup: {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    },
    systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
    tools: [{ functionDeclarations: [{
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: { x: { type: "string" } }, required: [] },
    }] }],
  },
});

// Test 4: Full setup (what the server sends)
await testSetup("full-server-setup", {
  setup: {
    model: `models/${MODEL}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    },
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
    tools: [{ functionDeclarations: [{
      name: "get_available_slots",
      description: "Get available Calendly slots",
      parameters: { type: "object", properties: { timezone: { type: "string", description: "Timezone" } }, required: [] },
    }] }],
  },
});

console.log("Done");
process.exit(0);

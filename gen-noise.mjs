/**
 * Converts the office ambient WAV (8kHz PCM s16le) to μ-law bytes
 * and outputs a TypeScript constant for embedding in gemini.ts
 */
import { readFileSync, writeFileSync } from "fs";
import alawmulaw from "alawmulaw";

const wavData = readFileSync("/tmp/office_ambient_8k.wav");

// Skip WAV header (44 bytes) to get raw PCM s16le
const pcmData = wavData.slice(44);
const pcm16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);

// Encode to μ-law
const mulawBytes = alawmulaw.mulaw.encode(pcm16);
const mulawBuffer = Buffer.from(mulawBytes);

console.log(`PCM samples: ${pcm16.length}, μ-law bytes: ${mulawBuffer.length}`);
console.log(`Duration: ${(pcm16.length / 8000).toFixed(2)}s at 8kHz`);

// Write as base64 string to a file
const b64 = mulawBuffer.toString("base64");
writeFileSync("/tmp/office_noise_mulaw.b64", b64);
console.log(`Written ${b64.length} base64 chars to /tmp/office_noise_mulaw.b64`);

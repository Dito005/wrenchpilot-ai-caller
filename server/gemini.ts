/**
 * Gemini Live Voice Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a real-time bidirectional audio session between Twilio Media Streams
 * and Google Gemini 2.0 Flash Live. Handles:
 *  - Audio bridging (Twilio μ-law 8kHz → PCM 16-bit 16kHz → Gemini)
 *  - Audio output (Gemini PCM 16-bit 24kHz → μ-law 8kHz → Twilio)
 *  - Audio buffering (accumulate ~300ms chunks before sending to Gemini)
 *  - Tool calling (get_available_slots, book_demo, check_existing_booking)
 *  - Session lifecycle (setup, streaming, teardown)
 *
 * Audio format reference:
 *  - Twilio sends:  μ-law (PCMU), 8000 Hz, mono
 *  - Gemini input:  PCM 16-bit little-endian, 16000 Hz, mono (MIME: audio/pcm;rate=16000)
 *  - Gemini output: PCM 16-bit little-endian, 24000 Hz, mono
 *  - Twilio expects: μ-law (PCMU), 8000 Hz, mono
 */

import WebSocket from "ws";
import https from "https";
import { getAvailableSlots, formatSlotsForSpeech, createBooking, checkExistingBooking, getBookingLink } from "./calendly";
import { getSetting } from "./db";
import { sendBookingConfirmationSms } from "./sms";
// @ts-ignore — no types for alawmulaw
import alawmulaw from "alawmulaw";

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY!;
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// ─── Background Noise ─────────────────────────────────────────────────────────
// Office ambient noise mixed into AI audio output at low volume.
// Loaded once at startup from CDN, stored as PCM 8kHz Int16 samples for mixing.

const NOISE_CDN_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663555224274/BokbsT2iHA9txo6FdJDALf/office_ambient_v2_8k_8d66d4a3.wav";
const NOISE_VOLUME = 0.20; // 20% volume — clearly audible office ambient background

let noisePcm8k: Int16Array | null = null; // PCM 16-bit 8kHz samples
let noiseOffset = 0;

// Load noise WAV from CDN at startup (non-blocking)
function loadBackgroundNoise() {
  https.get(NOISE_CDN_URL, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      const buf = Buffer.concat(chunks);
      // Skip 44-byte WAV header to get raw PCM s16le
      const pcmBuf = buf.slice(44);
      noisePcm8k = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 2);
      console.log(`[Gemini] Background noise loaded: ${noisePcm8k.length} samples (${(noisePcm8k.length / 8000).toFixed(1)}s)`);
    });
    res.on("error", (err) => console.warn("[Gemini] Failed to load background noise:", err.message));
  }).on("error", (err) => console.warn("[Gemini] Noise CDN error:", err.message));
}
loadBackgroundNoise();

/**
 * Mix background noise into a μ-law 8kHz buffer.
 * Decodes μ-law → PCM, adds noise at NOISE_VOLUME, re-encodes to μ-law.
 */
function mixBackgroundNoise(mulawBytes: Uint8Array): Uint8Array {
  if (!noisePcm8k || noisePcm8k.length === 0) return mulawBytes;

  // Decode μ-law to PCM
  const pcm = alawmulaw.mulaw.decode(mulawBytes) as Int16Array;

  // Mix noise samples (looping)
  const mixed = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const noiseIdx = (noiseOffset + i) % noisePcm8k.length;
    const noiseSample = Math.round(noisePcm8k[noiseIdx] * NOISE_VOLUME);
    // Clamp to Int16 range
    mixed[i] = Math.max(-32768, Math.min(32767, pcm[i] + noiseSample));
  }
  noiseOffset = (noiseOffset + pcm.length) % noisePcm8k.length;

  // Re-encode to μ-law
  return alawmulaw.mulaw.encode(mixed) as Uint8Array;
}

// ─── Audio Conversion Helpers ─────────────────────────────────────────────────

/**
 * Decode Twilio's μ-law 8kHz audio to PCM 16-bit 16kHz.
 * Twilio sends PCMU (μ-law) at 8000 Hz.
 * Gemini Live accepts audio/pcm at 16000 Hz.
 * Steps: mulaw decode → Int16 PCM 8kHz → upsample 2x to 16kHz (linear interpolation)
 */
function mulawToPcm16kHz(mulawBytes: Buffer): Buffer {
  // Decode μ-law to 16-bit PCM at 8kHz
  const pcm8k = alawmulaw.mulaw.decode(mulawBytes) as Int16Array;

  // Upsample from 8kHz to 16kHz by linear interpolation (2x)
  const pcm16k = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    pcm16k[i * 2] = pcm8k[i];
    pcm16k[i * 2 + 1] = i < pcm8k.length - 1
      ? Math.round((pcm8k[i] + pcm8k[i + 1]) / 2)
      : pcm8k[i];
  }

  return Buffer.from(pcm16k.buffer);
}

/**
 * Convert Gemini's PCM 16-bit 24kHz output to μ-law 8kHz for Twilio.
 * Steps: PCM 24kHz → downsample to 8kHz (take every 3rd sample) → μ-law encode
 */
function pcm24kHzToMulaw8kHz(pcmBuffer: Buffer): string {
  const pcm24k = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);

  // Downsample from 24kHz to 8kHz (take every 3rd sample)
  const downsampleRatio = 3; // 24000 / 8000 = 3
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / downsampleRatio));
  for (let i = 0; i < pcm8k.length; i++) {
    pcm8k[i] = pcm24k[i * downsampleRatio];
  }

  // Encode to μ-law
  const mulawBytes = alawmulaw.mulaw.encode(pcm8k) as Uint8Array;

  // Mix in background office noise at low volume
  const withNoise = mixBackgroundNoise(mulawBytes);

  return Buffer.from(withNoise).toString("base64");
}

// ─── WrenchPilot System Prompt ────────────────────────────────────────────────

function buildSystemPrompt(leadName: string, leadEmail: string, agentName: string, extraContext?: string): string {
  const emailLine = leadEmail ? ` Their email on file is ${leadEmail}.` : "";
  const contextLine = extraContext ? `\nAdditional context: ${extraContext}` : "";
  // Extract first name for natural use in conversation
  const firstName = leadName.split(" ")[0];

  const lines = [
    `You are ${agentName}, calling on behalf of WrenchPilot.`,
    `You are speaking with ${leadName} (first name: ${firstName}).${emailLine}${contextLine}`,
    "",
    "CRITICAL RULES — NEVER BREAK THESE:",
    `1. You already know their name is ${leadName}. NEVER ask for their name again at any point in the call.`,
    `2. When calling book_demo, ALWAYS use the name ${leadName} — do not ask for it, do not prompt for it.`,
    "3. ALWAYS confirm spelling of any email address given. Read it back character by character.",
    "4. ALWAYS include a notes field in book_demo with a summary of the call.",
    "5. ALWAYS ask 'Did the calendar invite come through to [email]?' after booking.",
    "",
    "VOICE AND TONE:",
    "Speak slowly and calmly. Deep, measured pace. Short sentences. Sound like a real person, not a script.",
    "Never say: Absolutely, Great question, Certainly, Of course, Fantastic, Awesome.",
    "Pause naturally between sentences. Do not rush.",
    "If you do not know the answer to something, say: I can make a note of that for the demo call.",
    "",
    "CALL FLOW (follow this exactly, one step at a time — do NOT skip steps):",
    `Step 1 - Confirm: Say: Hey, is this ${firstName}? Wait for yes before continuing.`,
    `Step 2 - Introduce: Say: Hey ${firstName}, this is ${agentName} calling from WrenchPilot. I'm calling about an inquiry you sent in recently about shop management software. Is now a good time?`,
    "Step 3 - Offer: Say: I was just calling to see if you'd like to schedule a quick demo. It's about 30 minutes.",
    "Step 4 - If yes, proceed to book. If they have questions first, answer them briefly, then offer the demo again.",
    "Step 5 - To book: call get_available_slots. Read up to 3 options clearly. Wait for them to choose one.",
    "Step 6 - Ask for email: Say: What email should I send the invite to? Wait for their answer.",
    "Step 6a - Confirm email spelling: Say: Let me read that back — [spell out each character]. Is that right? Wait for confirmation before proceeding.",
    `Step 7 - Call book_demo. Use name=${leadName} (you already have it — do NOT ask). Use the confirmed email and chosen slot. REQUIRED: include a notes field summarizing the call (what they asked, which plan they seemed interested in, how many techs they have, anything else useful for the demo team).`,
    "Step 8 - Confirm delivery: Say: Done. You should get a calendar invite to [email] shortly. Did it come through?",
    "  - If yes: Say: Perfect. Talk to you then. Take care.",
    "  - If no or not yet: Say: It can take a minute or two. Check your spam folder too. If it doesn't show up, you can also grab a time at calendly.com/service-wrenchpilot/30min.",
    "Step 9 - Call send_confirmation_sms with the booked_time from the booking result and the lead's name.",
    "Step 10 - Close: Say: Alright, talk to you then. Take care.",
    "",
    "EMAIL SPELLING RULE:",
    "When a lead gives you an email address, ALWAYS read it back character by character before booking.",
    "Example: They say 'john.smith@gmail.com' → You say: 'Let me read that back — j, o, h, n, dot, s, m, i, t, h, at, g, m, a, i, l, dot, c, o, m. Is that right?'",
    "Only call book_demo after they confirm the spelling is correct.",
    "",
    "NAME RULE:",
    `You already know the lead's name is ${leadName}. Use it. Never ask for it. When book_demo requires a name, use ${leadName}.`,
    "",
    "PRICING:",
    "Shop solution: $300 per month. Covers shops with up to 20 technicians.",
    "Solo solution: $4,995 one-time. For solo mobile technicians with no fixed shop.",
    "",
    "PRODUCT KNOWLEDGE (only share when asked):",
    "WrenchPilot is shop management software built specifically for heavy-duty truck repair shops.",
    "Time tracking: Industry-leading time tracking. Technicians clock in and out of jobs. Every minute is captured. Owners see real labor costs in real time.",
    "Profitability reports: Clean, easy-to-read reports showing profit per job, per technician, and per month. No spreadsheets needed.",
    "Customer portal: Customers can view their repair history, invoices, and job status online.",
    "Work orders: Digital work orders from estimate to invoice. No paper.",
    "Invoicing: Automated invoicing. Send invoices by text or email.",
    "Parts tracking: Track parts per job. Know your costs before the invoice goes out.",
    "Technician scheduling: Assign jobs to techs. See who is available and what they are working on.",
    "Reporting: Dashboards showing revenue, labor efficiency, parts margin, and more.",
    "Migration: Easy to switch from Fullbay, Mitchell1, or paper-based systems.",
    "Support: Dedicated onboarding support included.",
    "",
    "OBJECTION HANDLING:",
    "Already using software: What are you on now? [pause] Got it. Most shops that switch say the time tracking and profit reports are the big difference. Worth a 30-minute look?",
    "Too busy: Fair enough. It's only 30 minutes. Want to lock in a time?",
    "Need to think: No problem. Want to just grab a time so you have it on the calendar? No commitment.",
    "Not interested: No problem. Have a good one.",
    "",
    "VOICEMAIL:",
    `Hey ${firstName}, it's ${agentName} from WrenchPilot. Calling about the shop management software inquiry you sent in. Give us a call back or grab a time at calendly.com/service-wrenchpilot/30min. Thanks.`,
    "",
    "BOOKING NOTES — REQUIRED:",
    "Every book_demo call MUST include a notes field. Minimum content: what questions they asked, which plan they seemed interested in (Shop $300/mo or Solo $4,995), how many technicians they have if mentioned, and any other details useful for the demo team.",
    "Example notes: 'Lead asked about time tracking and profitability reports. Interested in the Shop plan ($300/mo). Has 4 technicians. Currently using paper-based system. Wants to see the customer portal during demo.'",
    "",
    "SMS CONFIRMATION RULE:",
    "After book_demo succeeds, call send_confirmation_sms with the booked_time from the booking result and lead_name=${leadName}.",
    "Do this every time a booking is made, right after confirming the email invite.",
  ];

  return lines.join("\n");
}

// ─── Tool Definitions─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_available_slots",
    description: "Fetch available demo booking slots from Calendly. Call this when the lead agrees to book a demo and you need to offer them time options.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "book_demo",
    description: "Book a WrenchPilot demo on Calendly for the lead. Call this after the lead has confirmed their preferred time slot, name, and email.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lead's full name" },
        email: { type: "string", description: "Lead's email address" },
        start_time: { type: "string", description: "ISO 8601 datetime string for the selected slot (e.g. 2026-04-15T14:00:00Z)" },
        phone: { type: "string", description: "Lead's phone number (optional)" },
        notes: { type: "string", description: "Brief summary of the call for the demo team: what questions they asked, which plan they are interested in, and any other relevant details" },
      },
      required: ["name", "email", "start_time"],
    },
  },
  {
    name: "check_existing_booking",
    description: "Check if the lead already has a Calendly booking. Call this if the lead mentions they may have already booked.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Lead's email address to check" },
      },
      required: ["email"],
    },
  },
  {
    name: "send_confirmation_sms",
    description: "Send a booking confirmation SMS to the lead after a demo has been successfully booked. Always call this after book_demo succeeds.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Lead's phone number in E.164 format (e.g. +14155551234)" },
        booked_time: { type: "string", description: "Human-readable booking time, e.g. Wednesday, April 16 at 2:00 PM" },
        lead_name: { type: "string", description: "Lead's full name" },
      },
      required: ["phone", "booked_time", "lead_name"],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, string>): Promise<string> {
  console.log(`[Gemini] Executing tool: ${name}`, args);

  try {
    if (name === "get_available_slots") {
      const slots = await getAvailableSlots(8);
      if (slots.length === 0) {
        return JSON.stringify({
          has_slots: false,
          message: "No available slots found in the next two weeks. Please give the lead the direct booking link: calendly.com/service-wrenchpilot/30min",
        });
      }
      return JSON.stringify({
        has_slots: true,
        slots_speech: formatSlotsForSpeech(slots),
        slots: slots.map(s => ({ start_time: s.start_time })),
      });
    }

    if (name === "book_demo") {
      // Server-side enforcement: ensure notes are always included
      // If the AI omits notes, generate a minimal summary so the demo team always has context
      const bookingNotes = args.notes && args.notes.trim().length > 10
        ? args.notes
        : `[Auto-generated] Demo booked via AI call. Lead: ${args.name || "unknown"}, Email: ${args.email || "unknown"}. No additional notes were captured during the call.`;

      const result = await createBooking({
        name: args.name,
        email: args.email,
        startTime: args.start_time,
        phone: args.phone,
        notes: bookingNotes,
      });
      if (result.success) {
        const bookedDate = new Date(result.startTime || args.start_time);
        const formattedDate = bookedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        const formattedTime = bookedDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        return JSON.stringify({
          success: true,
          confirmation: `Booking confirmed! The demo is scheduled for ${formattedDate} at ${formattedTime}. A calendar invite and confirmation email will be sent to ${args.email}.`,
          booked_time: `${formattedDate} at ${formattedTime}`,
          cancel_url: result.cancelUrl,
        });
      } else {
        return JSON.stringify({
          success: false,
          error: result.error,
          fallback: `Booking failed. Please give the lead the direct link: calendly.com/service-wrenchpilot/30min`,
        });
      }
    }

    if (name === "check_existing_booking") {
      const result = await checkExistingBooking(args.email);
      if (result?.hasBooking) {
        return JSON.stringify({
          has_booking: true,
          message: `The lead already has a booking. Start time: ${result.startTime || "unknown"}. Confirm with them and end the call gracefully.`,
        });
      }
      return JSON.stringify({ has_booking: false });
    }

    if (name === "send_confirmation_sms") {
      const success = await sendBookingConfirmationSms({
        toPhone: args.phone,
        leadName: args.lead_name,
        bookedDateTime: args.booked_time,
        calendlyLink: getBookingLink(),
      });
      return JSON.stringify({
        success,
        message: success
          ? `Confirmation SMS sent to ${args.phone}.`
          : "SMS could not be sent. The lead should have received a calendar invite by email.",
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err: any) {
    console.error(`[Gemini] Tool ${name} error:`, err);
    return JSON.stringify({ error: err.message, fallback: getBookingLink() });
  }
}

// ─── Session Manager ──────────────────────────────────────────────────────────

export interface GeminiSessionOptions {
  leadName: string;
  leadEmail: string;
  leadPhone?: string;  // Lead's phone number for post-booking SMS confirmation
  agentName?: string;
  extraContext?: string;
  onAudioChunk: (audioBase64: string) => void;
  onTranscript: (role: "user" | "model", text: string) => void;
  onCallEnded: () => void;
  onInterrupted?: () => void; // Called when user barge-in interrupts AI speech
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private options: GeminiSessionOptions;
  private transcript: Array<{ role: "user" | "model"; text: string }> = [];
  private isSetupComplete = false;
  private setupResolve: (() => void) | null = null;

  // Audio: send every Twilio chunk immediately — no buffering for minimum latency
  // Each Twilio chunk is 160 bytes μ-law → 640 bytes PCM 16kHz (20ms)
  private audioBuffer: Buffer[] = [];
  private audioBufferSize = 0;
  private readonly AUDIO_BUFFER_THRESHOLD = 1; // send every single chunk immediately (no batching)
  private cachedVoiceName = "Charon"; // pre-fetched before WebSocket open to avoid race condition

  constructor(options: GeminiSessionOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    // Pre-fetch voice setting BEFORE opening WebSocket to avoid race condition.
    // Gemini closes with 1011 if setup message is not sent within ~50ms of open.
    const savedVoice = await getSetting("gemini_voice").catch(() => null);
    this.cachedVoiceName = savedVoice || "Charon"; // Charon = deep male voice (most authoritative)
    console.log(`[Gemini] Using voice: ${this.cachedVoiceName}`);

    return new Promise((resolve, reject) => {
      this.setupResolve = resolve;

      console.log(`[Gemini] Connecting to Gemini Live API...`);
      this.ws = new WebSocket(GEMINI_WS_URL);

      this.ws.on("open", () => {
        console.log("[Gemini] WebSocket connected — sending setup");
        this.sendSetup().catch(err => {
          console.error("[Gemini] Setup error:", err);
          reject(err);
        });
      });

      this.ws.on("message", async (data: WebSocket.Data) => {
        try {
          const raw = data.toString();
          const msg = JSON.parse(raw);

          // Detect setupComplete — Gemini sends { "setupComplete": {} }
          if (!this.isSetupComplete && msg.setupComplete !== undefined) {
            this.isSetupComplete = true;
            console.log("[Gemini] Setup complete — session ready");
            if (this.setupResolve) {
              this.setupResolve();
              this.setupResolve = null;
            }
          }

          await this.handleMessage(msg);
        } catch (err) {
          console.error("[Gemini] Message parse error:", err);
        }
      });

      this.ws.on("error", (err) => {
        console.error("[Gemini] WebSocket error:", err);
        reject(err);
      });

      this.ws.on("close", (code, reason) => {
        console.log(`[Gemini] WebSocket closed: code=${code} reason=${reason?.toString()}`);
        this.options.onCallEnded();
      });

      // Safety timeout — resolve after 8s even if setupComplete not received
      setTimeout(() => {
        if (!this.isSetupComplete) {
          console.warn("[Gemini] Setup timeout — proceeding anyway");
          this.isSetupComplete = true;
          if (this.setupResolve) {
            this.setupResolve();
            this.setupResolve = null;
          }
        }
      }, 8000);
    });
  }

  private async sendSetup() {
    const agentName = this.options.agentName || "Alex";
    const systemPrompt = buildSystemPrompt(
      this.options.leadName,
      this.options.leadEmail,
      agentName,
      this.options.extraContext
    );

    // Use pre-fetched voice name (set in connect() before WebSocket open)
    const voiceName = this.cachedVoiceName;

    const setupMsg = {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
        // VAD config: aggressive detection so AI stops quickly when user speaks
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
            endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
            prefixPaddingMs: 20,
            silenceDurationMs: 500,
          },
          activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
        },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        tools: [{ functionDeclarations: TOOLS }],
      },
    };

    const setupJson = JSON.stringify(setupMsg);
    console.log(`[Gemini] Sending setup message (${setupJson.length} bytes, voice=${voiceName}, model=${GEMINI_MODEL})`);
    this.ws?.send(setupJson);
  }

  private async handleMessage(msg: any) {
    // Skip setup complete (already handled above)
    if (msg.setupComplete !== undefined) return;

    // Server content (audio + text responses)
    if (msg.serverContent) {
      const content = msg.serverContent;

      // Interrupted — user spoke while AI was talking, stop sending audio immediately
      if (content.interrupted) {
        console.log("[Gemini] Interrupted by user — AI stopped speaking");
        // Notify Twilio layer to clear any queued audio so user hears themselves immediately
        this.options.onInterrupted?.();
      }

      // Model turn with audio/text parts
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          // Audio chunk from Gemini — convert PCM 24kHz to μ-law 8kHz for Twilio
          if (part.inlineData?.mimeType?.startsWith("audio/") && part.inlineData?.data) {
            try {
              const pcmBuffer = Buffer.from(part.inlineData.data, "base64");
              const mulawBase64 = pcm24kHzToMulaw8kHz(pcmBuffer);
              this.options.onAudioChunk(mulawBase64);
            } catch (err) {
              console.error("[Gemini] Audio conversion error:", err);
            }
          }
          // Text transcript from model
          if (part.text) {
            this.options.onTranscript("model", part.text);
            this.transcript.push({ role: "model", text: part.text });
          }
        }
      }

      // Output audio transcription (what the AI said)
      if (content.outputTranscription?.text) {
        const text = content.outputTranscription.text;
        console.log(`[Gemini] AI said: ${text}`);
        this.options.onTranscript("model", text);
        this.transcript.push({ role: "model", text });
      }

      // Input transcription (what the user said)
      if (content.inputTranscription?.text) {
        const text = content.inputTranscription.text;
        console.log(`[Gemini] User said: ${text}`);
        this.options.onTranscript("user", text);
        this.transcript.push({ role: "user", text });
      }
    }

    // Tool call request from Gemini
    if (msg.toolCall) {
      const functionCalls = msg.toolCall.functionCalls || [];
      const responses = [];

      for (const call of functionCalls) {
        // Inject leadPhone automatically for send_confirmation_sms so the AI
        // doesn't need to know the phone number — it's already in the session
        const args = { ...(call.args || {}) };
        if (call.name === "send_confirmation_sms" && this.options.leadPhone && !args.phone) {
          args.phone = this.options.leadPhone;
        }
        const result = await executeTool(call.name, args);
        responses.push({
          id: call.id,
          name: call.name,
          response: { output: result },
        });
      }

      // Send tool responses back to Gemini
      this.ws?.send(JSON.stringify({
        toolResponse: { functionResponses: responses },
      }));
    }
  }

  /**
   * Send a chunk of μ-law 8kHz audio from Twilio to Gemini.
   * Converts PCMU → PCM 16-bit 16kHz, buffers until ~300ms accumulated,
   * then flushes to Gemini in one batch.
   */
  sendAudio(mulawBase64: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // Decode μ-law 8kHz → PCM 16-bit 16kHz
      const mulawBytes = Buffer.from(mulawBase64, "base64");
      const pcm16kBuffer = mulawToPcm16kHz(mulawBytes);

      // Accumulate in buffer
      this.audioBuffer.push(pcm16kBuffer);
      this.audioBufferSize += pcm16kBuffer.byteLength;

      // Send immediately — no buffering for minimum latency
      this.flushAudioBuffer();
    } catch (err) {
      console.error("[Gemini] sendAudio conversion error:", err);
    }
  }

  /**
   * Flush accumulated audio buffer to Gemini.
   */
  private flushAudioBuffer() {
    if (this.audioBuffer.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const combined = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.audioBufferSize = 0;

    const pcm16kBase64 = combined.toString("base64");

    // gemini-3.1-flash-live-preview uses realtimeInput.audio (not mediaChunks)
    const msg = {
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: pcm16kBase64,
        },
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a text message to Gemini (used to trigger the opening greeting).
   * Uses realtimeInput.text format required by gemini-3.1-flash-live-preview.
   */
  sendText(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[Gemini] sendText: WebSocket not open");
      return;
    }

    const msg = {
      realtimeInput: {
        text,
      },
    };
    this.ws.send(JSON.stringify(msg));
    console.log(`[Gemini] Sent text trigger: "${text}"`);
  }

  getTranscript(): Array<{ role: "user" | "model"; text: string }> {
    return this.transcript;
  }

  close() {
    // Flush any remaining buffered audio before closing
    if (this.audioBufferSize > 0) {
      this.flushAudioBuffer();
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}
// Phase 16: VAD + barge-in + 20% noise — Wed Apr 15 03:52:56 EDT 2026

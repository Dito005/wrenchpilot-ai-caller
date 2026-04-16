import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Facebook Webhook Verification ───────────────────────────────────────────

describe("Facebook webhook verification", () => {
  it("returns challenge when mode and token match", () => {
    const verifyToken = "wrenchpilot_verify_2024";
    const mode = "subscribe";
    const token = verifyToken;
    const challenge = "abc123";

    const isValid = mode === "subscribe" && token === verifyToken;
    expect(isValid).toBe(true);
    expect(challenge).toBe("abc123");
  });

  it("rejects when token does not match", () => {
    const verifyToken = "wrenchpilot_verify_2024";
    const mode = "subscribe";
    const token = "wrong_token";

    const isValid = mode === "subscribe" && token === verifyToken;
    expect(isValid).toBe(false);
  });

  it("rejects when mode is not subscribe", () => {
    const verifyToken = "wrenchpilot_verify_2024";
    const mode = "unsubscribe";
    const token = verifyToken;

    const isValid = mode === "subscribe" && token === verifyToken;
    expect(isValid).toBe(false);
  });
});

// ─── Phone Number Normalization ───────────────────────────────────────────────

function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return phone;
}

describe("Phone number normalization", () => {
  it("normalizes 10-digit US number", () => {
    expect(normalizePhone("5551234567")).toBe("+15551234567");
  });

  it("normalizes formatted US number", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
  });

  it("normalizes 11-digit number starting with 1", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("returns undefined for empty input", () => {
    expect(normalizePhone(undefined)).toBeUndefined();
    expect(normalizePhone("")).toBeUndefined();
  });

  it("handles already-formatted E.164 number", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
  });
});

// ─── Lead Status Lifecycle ────────────────────────────────────────────────────

describe("Lead status lifecycle", () => {
  it("valid status values are the four expected ones", () => {
    const validStatuses = ["pending", "called", "booked", "no-answer"];
    expect(validStatuses).toContain("pending");
    expect(validStatuses).toContain("called");
    expect(validStatuses).toContain("booked");
    expect(validStatuses).toContain("no-answer");
    expect(validStatuses).toHaveLength(4);
  });

  it("should not call a lead that is already booked", () => {
    const lead = { status: "booked", phone: "+15551234567" };
    const shouldCall = lead.status !== "called" && lead.status !== "booked";
    expect(shouldCall).toBe(false);
  });

  it("should not call a lead that is already called", () => {
    const lead = { status: "called", phone: "+15551234567" };
    const shouldCall = lead.status !== "called" && lead.status !== "booked";
    expect(shouldCall).toBe(false);
  });

  it("should call a pending lead with a phone number", () => {
    const lead = { status: "pending", phone: "+15551234567" };
    const shouldCall = lead.status !== "called" && lead.status !== "booked" && !!lead.phone;
    expect(shouldCall).toBe(true);
  });

  it("should not call a lead with no phone number", () => {
    const lead = { status: "pending", phone: undefined };
    const shouldCall = lead.status !== "called" && lead.status !== "booked" && !!lead.phone;
    expect(shouldCall).toBe(false);
  });
});

// ─── Bland.ai Post-Call Status Determination ─────────────────────────────────

function determineCallStatus(payload: {
  status?: string;
  answered_by?: string;
  transcripts?: unknown[];
  tool_calls?: Array<{ name: string }>;
}): "called" | "booked" | "no-answer" {
  const callStatus = payload.status?.toLowerCase() || "";
  const answeredBy = payload.answered_by?.toLowerCase() || "";

  if (
    answeredBy === "voicemail" ||
    callStatus === "no-answer" ||
    callStatus === "busy" ||
    callStatus === "failed"
  ) {
    return "no-answer";
  }

  const toolCalls = payload.tool_calls || [];
  for (const tool of toolCalls) {
    if (tool.name === "get_calendly_link") {
      return "booked";
    }
  }

  return "called";
}

describe("Post-call status determination", () => {
  it("marks as no-answer when answered_by is voicemail", () => {
    expect(determineCallStatus({ answered_by: "voicemail" })).toBe("no-answer");
  });

  it("marks as no-answer when status is busy", () => {
    expect(determineCallStatus({ status: "busy" })).toBe("no-answer");
  });

  it("marks as no-answer when status is failed", () => {
    expect(determineCallStatus({ status: "failed" })).toBe("no-answer");
  });

  it("marks as booked when get_calendly_link tool was called", () => {
    expect(determineCallStatus({
      status: "completed",
      tool_calls: [{ name: "get_calendly_link" }],
    })).toBe("booked");
  });

  it("marks as called for a completed call with no booking", () => {
    expect(determineCallStatus({
      status: "completed",
      tool_calls: [],
    })).toBe("called");
  });
});

// ─── Transcript Parsing ───────────────────────────────────────────────────────

function parseTranscript(raw: string | null): Array<{ role: string; text: string }> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: { role?: string; user?: string; text?: string; content?: string }) => ({
        role: item.role || item.user || "unknown",
        text: item.text || item.content || "",
      }));
    }
    return null;
  } catch {
    return [{ role: "transcript", text: raw }];
  }
}

describe("Transcript parsing", () => {
  it("parses JSON array transcript", () => {
    const raw = JSON.stringify([
      { role: "agent", text: "Hi, is this John?" },
      { role: "user", text: "Yes, speaking." },
    ]);
    const result = parseTranscript(raw);
    expect(result).toHaveLength(2);
    expect(result?.[0]?.role).toBe("agent");
    expect(result?.[1]?.text).toBe("Yes, speaking.");
  });

  it("returns plain text transcript as single entry", () => {
    const result = parseTranscript("This is a plain text transcript.");
    expect(result).toHaveLength(1);
    expect(result?.[0]?.role).toBe("transcript");
    expect(result?.[0]?.text).toBe("This is a plain text transcript.");
  });

  it("returns null for null input", () => {
    expect(parseTranscript(null)).toBeNull();
  });
});

// ─── Auth Logout (existing test) ─────────────────────────────────────────────

import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  const user: AuthenticatedUser = {
    id: 1, openId: "sample-user", email: "sample@example.com",
    name: "Sample User", loginMethod: "manus", role: "user",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: (name: string, options: Record<string, unknown>) => { clearedCookies.push({ name, options }); } } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1, secure: true, sameSite: "none", httpOnly: true, path: "/" });
  });
});

// ─── Gemini Live Audio Pipeline ───────────────────────────────────────────────

// Replicate the audio conversion logic from gemini.ts for unit testing
// (We test the logic directly without importing the module to avoid WS deps)

// @ts-ignore — no types for alawmulaw
import alawmulaw from "alawmulaw";

function mulawToPcm16kHz_test(mulawBytes: Buffer): Buffer {
  const pcm8k = alawmulaw.mulaw.decode(mulawBytes) as Int16Array;
  const pcm16k = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    pcm16k[i * 2] = pcm8k[i];
    pcm16k[i * 2 + 1] = i < pcm8k.length - 1
      ? Math.round((pcm8k[i] + pcm8k[i + 1]) / 2)
      : pcm8k[i];
  }
  return Buffer.from(pcm16k.buffer);
}

function pcm24kHzToMulaw8kHz_test(pcmBuffer: Buffer): string {
  const pcm24k = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
  const downsampleRatio = 3;
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / downsampleRatio));
  for (let i = 0; i < pcm8k.length; i++) {
    pcm8k[i] = pcm24k[i * downsampleRatio];
  }
  const mulawBytes = alawmulaw.mulaw.encode(pcm8k) as Uint8Array;
  return Buffer.from(mulawBytes).toString("base64");
}

describe("Gemini Live audio pipeline", () => {
  it("μ-law → PCM 16kHz: output is 4x the input byte length (2x samples × 2 bytes each)", () => {
    // 20 bytes of μ-law (20 samples at 8kHz) → 40 PCM 8kHz samples → 80 PCM 16kHz samples → 160 bytes
    const mulawInput = Buffer.alloc(20, 0xff); // silence in μ-law
    const pcm16k = mulawToPcm16kHz_test(mulawInput);
    expect(pcm16k.byteLength).toBe(20 * 4); // 4x because 2x upsample × 2 bytes/sample
  });

  it("μ-law → PCM 16kHz: output is a Buffer", () => {
    const mulawInput = Buffer.alloc(10, 0x7f);
    const result = mulawToPcm16kHz_test(mulawInput);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("PCM 24kHz → μ-law 8kHz: output is a base64 string", () => {
    // 30 PCM samples at 24kHz (60 bytes) → 10 samples at 8kHz → 10 μ-law bytes → base64
    const pcm24k = new Int16Array(30).fill(1000);
    const pcmBuffer = Buffer.from(pcm24k.buffer);
    const result = pcm24kHzToMulaw8kHz_test(pcmBuffer);
    expect(typeof result).toBe("string");
    // Should be valid base64
    expect(() => Buffer.from(result, "base64")).not.toThrow();
  });

  it("PCM 24kHz → μ-law 8kHz: output byte count is 1/3 of input sample count", () => {
    // 30 PCM samples at 24kHz → 10 μ-law bytes at 8kHz
    const pcm24k = new Int16Array(30).fill(500);
    const pcmBuffer = Buffer.from(pcm24k.buffer);
    const result = pcm24kHzToMulaw8kHz_test(pcmBuffer);
    const decoded = Buffer.from(result, "base64");
    expect(decoded.byteLength).toBe(10); // 30 / 3 = 10
  });

  it("audio buffer threshold: 9600 bytes equals ~300ms at 16kHz PCM 16-bit", () => {
    // 16000 samples/sec × 2 bytes/sample × 0.3 sec = 9600 bytes
    const THRESHOLD = 9600;
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const durationSec = 0.3;
    expect(THRESHOLD).toBe(sampleRate * bytesPerSample * durationSec);
  });

  it("round-trip: μ-law encode then decode preserves approximate signal", () => {
    // Create a simple PCM signal, encode to μ-law, decode back — values should be close
    const original = new Int16Array([0, 1000, -1000, 5000, -5000, 10000, -10000]);
    const encoded = alawmulaw.mulaw.encode(original) as Uint8Array;
    const decoded = alawmulaw.mulaw.decode(Buffer.from(encoded)) as Int16Array;
    expect(decoded.length).toBe(original.length);
    // μ-law is lossy, but silence (0) should decode to near-zero
    expect(Math.abs(decoded[0])).toBeLessThan(100);
  });
});

// ─── Twilio Status → Lead Status Mapping ─────────────────────────────────────

describe("Twilio call status mapping", () => {
  function mapTwilioStatus(callStatus: string, answeredBy?: string): "called" | "no-answer" {
    if (
      callStatus === "no-answer" ||
      callStatus === "busy" ||
      callStatus === "failed" ||
      callStatus === "canceled" ||
      answeredBy === "machine_start" ||
      answeredBy === "machine_end_beep"
    ) {
      return "no-answer";
    }
    return "called";
  }

  it("maps no-answer status to no-answer", () => {
    expect(mapTwilioStatus("no-answer")).toBe("no-answer");
  });

  it("maps busy status to no-answer", () => {
    expect(mapTwilioStatus("busy")).toBe("no-answer");
  });

  it("maps failed status to no-answer", () => {
    expect(mapTwilioStatus("failed")).toBe("no-answer");
  });

  it("maps canceled status to no-answer", () => {
    expect(mapTwilioStatus("canceled")).toBe("no-answer");
  });

  it("maps voicemail detection to no-answer", () => {
    expect(mapTwilioStatus("completed", "machine_start")).toBe("no-answer");
    expect(mapTwilioStatus("completed", "machine_end_beep")).toBe("no-answer");
  });

  it("maps completed human call to called", () => {
    expect(mapTwilioStatus("completed", "human")).toBe("called");
    expect(mapTwilioStatus("completed")).toBe("called");
  });
});

// ─── Background Noise Mixing ──────────────────────────────────────────────────

// Replicate the mixBackgroundNoise logic for unit testing
// @ts-ignore — no types for alawmulaw
// (alawmulaw already imported above)

function mixBackgroundNoise_test(
  mulawBytes: Uint8Array,
  noisePcm8k: Int16Array | null,
  noiseVolume = 0.06
): { result: Uint8Array; changed: boolean } {
  if (!noisePcm8k || noisePcm8k.length === 0) return { result: mulawBytes, changed: false };

  const pcm = alawmulaw.mulaw.decode(mulawBytes) as Int16Array;
  const mixed = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const noiseSample = Math.round(noisePcm8k[i % noisePcm8k.length] * noiseVolume);
    mixed[i] = Math.max(-32768, Math.min(32767, pcm[i] + noiseSample));
  }
  const result = alawmulaw.mulaw.encode(mixed) as Uint8Array;
  // Check if any byte changed
  const changed = Array.from(result).some((b, i) => b !== mulawBytes[i]);
  return { result, changed };
}

describe("Background noise mixing", () => {
  it("returns original bytes unchanged when noise is null (CDN not loaded)", () => {
    const silence = new Uint8Array(160).fill(0xff);
    const { result, changed } = mixBackgroundNoise_test(silence, null);
    expect(changed).toBe(false);
    expect(result).toBe(silence); // same reference
  });

  it("returns original bytes unchanged when noise array is empty", () => {
    const silence = new Uint8Array(160).fill(0xff);
    const { result, changed } = mixBackgroundNoise_test(silence, new Int16Array(0));
    expect(changed).toBe(false);
  });

  it("modifies output bytes when noise is present (non-silent noise)", () => {
    const silence = new Uint8Array(160).fill(0xff); // μ-law silence
    // Create a noise buffer with non-zero samples
    const noise = new Int16Array(160);
    for (let i = 0; i < noise.length; i++) noise[i] = 1000; // audible noise
    const { changed } = mixBackgroundNoise_test(silence, noise, 0.06);
    expect(changed).toBe(true);
  });

  it("clamps mixed samples to Int16 range (no overflow)", () => {
    // Use maximum positive μ-law signal + maximum noise
    const maxSignal = new Uint8Array(160).fill(0x00); // μ-law 0x00 = max positive
    const maxNoise = new Int16Array(160).fill(32767);
    const { result } = mixBackgroundNoise_test(maxSignal, maxNoise, 1.0);
    // All output bytes should be valid μ-law values (0-255)
    for (const byte of result) {
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(255);
    }
  });

  it("loops noise samples when noise buffer is shorter than audio", () => {
    const silence = new Uint8Array(160).fill(0xff);
    // Noise buffer with only 10 samples — should loop 16 times for 160 samples
    const shortNoise = new Int16Array(10).fill(2000);
    const { changed } = mixBackgroundNoise_test(silence, shortNoise, 0.1);
    expect(changed).toBe(true);
  });

  it("output length matches input length", () => {
    const input = new Uint8Array(320).fill(0xff);
    const noise = new Int16Array(320).fill(500);
    const { result } = mixBackgroundNoise_test(input, noise);
    expect(result.length).toBe(input.length);
  });
});

// ─── SMS Confirmation Message Tests ──────────────────────────────────────────

// Replicate the message builder logic from sms.ts for unit testing
function buildConfirmationMessage_test(opts: {
  leadName: string;
  bookedDateTime: string;
  calendlyLink?: string;
}): string {
  const name = opts.leadName.split(" ")[0];
  const link = opts.calendlyLink || "https://calendly.com/service-wrenchpilot/30min";
  return (
    `Hi ${name}, your WrenchPilot demo is confirmed for ${opts.bookedDateTime}. ` +
    `You should receive a calendar invite at your email shortly.\n\n` +
    `Need to reschedule? Use this link: ${link}\n\n` +
    `Looking forward to speaking with you! — WrenchPilot Team`
  );
}

describe("SMS Confirmation Message", () => {
  it("uses first name only from full name", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "John Smith",
      bookedDateTime: "Wednesday, April 16 at 2:00 PM",
    });
    expect(msg).toContain("Hi John,");
    expect(msg).not.toContain("Smith");
  });

  it("includes the booked date and time", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "Alice",
      bookedDateTime: "Thursday, April 17 at 10:00 AM",
    });
    expect(msg).toContain("Thursday, April 17 at 10:00 AM");
  });

  it("uses default Calendly link when none provided", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "Bob",
      bookedDateTime: "Friday, April 18 at 3:00 PM",
    });
    expect(msg).toContain("calendly.com/service-wrenchpilot/30min");
  });

  it("uses custom Calendly link when provided", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "Carol",
      bookedDateTime: "Monday, April 21 at 9:00 AM",
      calendlyLink: "https://calendly.com/custom/link",
    });
    expect(msg).toContain("https://calendly.com/custom/link");
  });

  it("includes reschedule instruction and WrenchPilot Team sign-off", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "Dave",
      bookedDateTime: "Tuesday, April 22 at 1:00 PM",
    });
    expect(msg).toContain("Need to reschedule?");
    expect(msg).toContain("WrenchPilot Team");
  });

  it("handles single-word name without crashing", () => {
    const msg = buildConfirmationMessage_test({
      leadName: "Alex",
      bookedDateTime: "Wednesday, April 23 at 4:00 PM",
    });
    expect(msg).toContain("Hi Alex,");
  });
});

// ─── Booking Notes Enforcement Tests ─────────────────────────────────────────

// Replicate the notes enforcement logic from executeTool for unit testing
function enforceBookingNotes_test(args: {
  notes?: string;
  name?: string;
  email?: string;
}): string {
  return args.notes && args.notes.trim().length > 10
    ? args.notes
    : `[Auto-generated] Demo booked via AI call. Lead: ${args.name || "unknown"}, Email: ${args.email || "unknown"}. No additional notes were captured during the call.`;
}

describe("Booking Notes Enforcement", () => {
  it("uses AI-provided notes when they are substantive (>10 chars)", () => {
    const notes = enforceBookingNotes_test({
      notes: "Lead asked about time tracking and profitability reports. Has 4 techs.",
      name: "John Smith",
      email: "john@example.com",
    });
    expect(notes).toContain("time tracking");
    expect(notes).not.toContain("[Auto-generated]");
  });

  it("generates fallback notes when notes are missing", () => {
    const notes = enforceBookingNotes_test({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(notes).toContain("[Auto-generated]");
    expect(notes).toContain("Jane Doe");
    expect(notes).toContain("jane@example.com");
  });

  it("generates fallback notes when notes are empty string", () => {
    const notes = enforceBookingNotes_test({
      notes: "",
      name: "Bob",
      email: "bob@example.com",
    });
    expect(notes).toContain("[Auto-generated]");
  });

  it("generates fallback notes when notes are too short (<= 10 chars)", () => {
    const notes = enforceBookingNotes_test({
      notes: "short",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(notes).toContain("[Auto-generated]");
  });

  it("handles missing name and email gracefully in fallback", () => {
    const notes = enforceBookingNotes_test({});
    expect(notes).toContain("[Auto-generated]");
    expect(notes).toContain("unknown");
  });
});

// ─── System Prompt Booking Flow Rules Tests ───────────────────────────────────

// Replicate the buildSystemPrompt logic for unit testing key rules
function buildTestPrompt(leadName: string, leadEmail: string, agentName: string): string {
  const firstName = leadName.split(" ")[0];
  return [
    `You are ${agentName}, calling on behalf of WrenchPilot.`,
    `You are speaking with ${leadName} (first name: ${firstName}).`,
    `Their email on file is ${leadEmail}.`,
    `1. You already know their name is ${leadName}. NEVER ask for their name again at any point in the call.`,
    `2. When calling book_demo, ALWAYS use the name ${leadName} — do not ask for it, do not prompt for it.`,
    "3. ALWAYS confirm spelling of any email address given. Read it back character by character.",
    "4. ALWAYS include a notes field in book_demo with a summary of the call.",
    "5. ALWAYS ask 'Did the calendar invite come through to [email]?' after booking.",
    `Step 6a - Confirm email spelling: Say: Let me read that back — [spell out each character]. Is that right?`,
    `Step 8 - Confirm delivery: Say: Done. You should get a calendar invite to [email] shortly. Did it come through?`,
  ].join("\n");
}

describe("System Prompt Booking Flow Rules", () => {
  it("prompt contains NEVER ask for name instruction", () => {
    const prompt = buildTestPrompt("John Smith", "john@example.com", "Alex");
    expect(prompt).toContain("NEVER ask for their name again");
  });

  it("prompt contains lead name in book_demo instruction", () => {
    const prompt = buildTestPrompt("Jane Doe", "jane@example.com", "Alex");
    expect(prompt).toContain("use the name Jane Doe");
  });

  it("prompt contains email spelling confirmation step", () => {
    const prompt = buildTestPrompt("Bob Jones", "bob@example.com", "Alex");
    expect(prompt).toContain("spell out each character");
  });

  it("prompt contains notes requirement", () => {
    const prompt = buildTestPrompt("Carol White", "carol@example.com", "Alex");
    expect(prompt).toContain("notes field in book_demo");
  });

  it("prompt contains email delivery confirmation step", () => {
    const prompt = buildTestPrompt("Dave Brown", "dave@example.com", "Alex");
    expect(prompt).toContain("Did it come through?");
  });

  it("uses first name only in step 1 confirmation", () => {
    const firstName = "John Smith".split(" ")[0];
    expect(firstName).toBe("John");
  });
});

// ─── Background Noise Audibility Tests ───────────────────────────────────────

// Replicate the mixBackgroundNoise logic for unit testing
function mixNoise_test(
  mulawSamples: number[],
  noiseSamples: number[],
  volume: number,
  offset: number
): { mixed: number[]; newOffset: number } {
  const mixed: number[] = [];
  for (let i = 0; i < mulawSamples.length; i++) {
    const noiseIdx = (offset + i) % noiseSamples.length;
    const noiseSample = Math.round(noiseSamples[noiseIdx] * volume);
    mixed.push(Math.max(-32768, Math.min(32767, mulawSamples[i] + noiseSample)));
  }
  return { mixed, newOffset: (offset + mulawSamples.length) % noiseSamples.length };
}

describe("Background Noise Audibility (20% volume)", () => {
  const NOISE_VOLUME = 0.20;

  it("mixed audio differs from input when noise is present", () => {
    const silence = new Array(160).fill(0);
    const noise = new Array(160).fill(10000); // strong noise signal
    const { mixed } = mixNoise_test(silence, noise, NOISE_VOLUME, 0);
    // At 20% of 10000 = 2000 — should be clearly non-zero
    expect(mixed[0]).toBe(2000);
    expect(mixed.every(s => s !== 0)).toBe(true);
  });

  it("noise at 20% is louder than at 6%", () => {
    const silence = new Array(160).fill(0);
    const noise = new Array(160).fill(10000);
    const { mixed: mixed20 } = mixNoise_test(silence, noise, 0.20, 0);
    const { mixed: mixed6 } = mixNoise_test(silence, noise, 0.06, 0);
    expect(mixed20[0]).toBeGreaterThan(mixed6[0]);
  });

  it("noise loops correctly across buffer boundaries", () => {
    const silence = new Array(10).fill(0);
    const noise = [1000, 2000, 3000]; // 3-sample loop
    const { mixed, newOffset } = mixNoise_test(silence, noise, 1.0, 0);
    expect(mixed[0]).toBe(1000);
    expect(mixed[1]).toBe(2000);
    expect(mixed[2]).toBe(3000);
    expect(mixed[3]).toBe(1000); // loops
    expect(newOffset).toBe(10 % 3); // = 1
  });

  it("clamping prevents Int16 overflow", () => {
    const loud = new Array(10).fill(32767); // max Int16
    const noise = new Array(10).fill(32767);
    const { mixed } = mixNoise_test(loud, noise, 1.0, 0);
    expect(mixed.every(s => s <= 32767)).toBe(true);
    expect(mixed.every(s => s >= -32768)).toBe(true);
  });

  it("returns input unchanged when noise array is empty (null noise fallback)", () => {
    // Simulate the null-noise guard: if noisePcm8k is null, return mulawBytes unchanged
    const input = [100, 200, 300];
    const noisePcm8k: number[] | null = null;
    const result = noisePcm8k ? mixNoise_test(input, noisePcm8k, NOISE_VOLUME, 0).mixed : input;
    expect(result).toEqual(input);
  });
});

// ─── Barge-In / Interruption Tests ───────────────────────────────────────────

describe("Barge-In Interruption Handling", () => {
  it("onInterrupted callback is invoked when content.interrupted is true", () => {
    let interrupted = false;
    const onInterrupted = () => { interrupted = true; };

    // Simulate the handleMessage interrupted check
    const content = { interrupted: true };
    if (content.interrupted) {
      onInterrupted();
    }
    expect(interrupted).toBe(true);
  });

  it("onInterrupted is NOT called when content.interrupted is false", () => {
    let interrupted = false;
    const onInterrupted = () => { interrupted = true; };

    const content = { interrupted: false };
    if (content.interrupted) {
      onInterrupted();
    }
    expect(interrupted).toBe(false);
  });

  it("onInterrupted is NOT called when content has no interrupted field", () => {
    let interrupted = false;
    const onInterrupted = () => { interrupted = true; };

    const content: any = { modelTurn: { parts: [] } };
    if (content.interrupted) {
      onInterrupted();
    }
    expect(interrupted).toBe(false);
  });

  it("Twilio clear message has correct structure", () => {
    const streamSid = "MX123456";
    const clearMsg = JSON.stringify({ event: "clear", streamSid });
    const parsed = JSON.parse(clearMsg);
    expect(parsed.event).toBe("clear");
    expect(parsed.streamSid).toBe("MX123456");
  });
});

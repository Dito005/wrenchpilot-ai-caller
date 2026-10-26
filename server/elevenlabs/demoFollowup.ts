/**
 * Layer B — `demo_followup` profile (swappable).
 * ─────────────────────────────────────────────────────────────────────────────
 * Rides on the fixed Layer A stack (layerA.ts). Agent-side settings below
 * describe how the live TEST agent is configured; this repo does not PATCH
 * the agent, it only reads it for drift (client.ts → checkAgentDrift) and
 * dials through it.
 *
 * Knowledge base is referenced by id only — the KB body lives in ElevenLabs.
 */

import type { ResolvedVoiceSlot } from "./voiceSlots";

export const CALENDLY_BOOKING_URL = "https://calendly.com/service-wrenchpilot/30min";

export const DEMO_FOLLOWUP = Object.freeze({
  profile: "demo_followup",
  agentId: "agent_7401m5szbg8je1psmfqrnjah5ya1", // TEST agent
  phoneNumberId: "phnum_1601m5t1nrg8eectqpdex82fqepv", // TEST phone
  phoneNumber: "+18638084158",
  firstMessage: "Hi, is this Adeel?",
  llm: Object.freeze({
    model: "gpt-4.1",
    temperature: 0.25,
    maxTokens: 160,
  }),
  timezone: "America/New_York",
  /** The only tools this profile may have enabled on the agent. */
  tools: Object.freeze(["end_call", "voicemail_detection"] as const),
  maxDurationSeconds: 180,
  knowledgeBaseId: "RKSbyNek0y22yaAAwVkb",
  calendlyUrl: CALENDLY_BOOKING_URL,
} as const);

export type DemoFollowupProfile = typeof DEMO_FOLLOWUP;

/** Words the persona must never say (over-eager sales filler). */
export const BANNED_PHRASES = Object.freeze([
  "amazing",
  "fantastic",
  "awesome",
  "incredible",
  "absolutely",
  "perfect",
  "wonderful",
] as const);

/**
 * Persona delivery rules for the demo_followup agent prompt.
 * Kept here so the prompt on the TEST agent can be diffed against source.
 */
export const PERSONA_RULES = Object.freeze([
  "Calm, low energy — about a 2 out of 10. Unhurried, plain, friendly.",
  "Short turns: one or two sentences, then stop and let them talk.",
  "Never say or imply you are an AI, a bot, a virtual assistant, or automated.",
  `Never use hype words: ${BANNED_PHRASES.join(", ")}.`,
  "Only after they confirm who they are, introduce yourself as {{agent_name}}, calling from WrenchPilot.",
  `To book, send them to ${CALENDLY_BOOKING_URL}. Never say a demo is booked, and never invent a date, time, or confirmation.`,
  "If it's voicemail or they want to stop, end the call politely.",
] as const);

/** The intro line spoken after the lead confirms identity. */
export function buildIntroLine(voice: ResolvedVoiceSlot): string {
  return `This is ${voice.name}, calling from WrenchPilot.`;
}

/** Returns the banned phrases found in a line of agent speech (case-insensitive, whole word). */
export function findBannedPhrases(line: string): string[] {
  return BANNED_PHRASES.filter(word => new RegExp(`\\b${word}\\b`, "i").test(line));
}

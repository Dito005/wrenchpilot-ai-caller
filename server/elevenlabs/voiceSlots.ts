/**
 * Voice slots — the ONLY way a Layer B profile may pick a TTS voice.
 * Callers pass a slot key (`male_1`) or the slot's spoken name (`Andrew`).
 * Raw ElevenLabs voice IDs and unknown names are rejected so nobody can
 * smuggle an arbitrary voice onto a live call.
 */

export const VOICE_SLOTS = Object.freeze({
  female: Object.freeze({ name: "Amy", voiceId: "oWjuL7HSoaEJRMDMP3HD" }),
  male_1: Object.freeze({ name: "Andrew", voiceId: "SF9uvIlY93SJRMdV5jeP" }),
  male_2: Object.freeze({ name: "Joseph", voiceId: "TTyZrDYo6LQowrH8mixJ" }),
  alt_1: Object.freeze({ name: "Eryn", voiceId: "dMyQqiVXTU80dDl2eNK8" }),
} as const);

export type VoiceSlotKey = keyof typeof VOICE_SLOTS;

export interface ResolvedVoiceSlot {
  slot: VoiceSlotKey;
  /** Spoken name used in the intro ("This is Andrew, calling from WrenchPilot"). */
  name: string;
  voiceId: string;
}

export const DEFAULT_VOICE_SLOT: VoiceSlotKey = "female";

export class VoiceSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceSlotError";
  }
}

const SLOT_KEYS = Object.keys(VOICE_SLOTS) as VoiceSlotKey[];

/** Resolve a slot key or slot name (case-insensitive). Throws on anything else. */
export function resolveVoiceSlot(input: string | undefined | null): ResolvedVoiceSlot {
  const raw = (input ?? DEFAULT_VOICE_SLOT).trim();
  const needle = raw.toLowerCase();

  const slot = SLOT_KEYS.find(
    key => key === needle || VOICE_SLOTS[key].name.toLowerCase() === needle
  );
  if (slot) return { slot, ...VOICE_SLOTS[slot] };

  const isRawVoiceId = SLOT_KEYS.some(key => VOICE_SLOTS[key].voiceId.toLowerCase() === needle)
    || /^[A-Za-z0-9]{20}$/.test(raw);
  if (isRawVoiceId) {
    throw new VoiceSlotError(
      `Raw voice IDs are not accepted. Use a voice slot: ${describeSlots()}.`
    );
  }
  throw new VoiceSlotError(`Unknown voice slot "${raw}". Use one of: ${describeSlots()}.`);
}

function describeSlots(): string {
  return SLOT_KEYS.map(key => `${key} (${VOICE_SLOTS[key].name})`).join(", ");
}

/**
 * Layer A — FIXED ElevenLabs ConvAI + Telnyx SIP voice stack.
 * ─────────────────────────────────────────────────────────────────────────────
 * "Quiet-bland" knobs Adeel approved (conv_2301m5wxk614frgt2rtnbqs1dgex). The
 * earlier v3 + expressive + BG-off sound was rejected (conv_2801m5x3gtzdf3aa65aqdknmg40a)
 * and must not come back. Turn/ASR/SIP values are from the live TEST agent
 * (verified 2026-10-26). Every Layer B
 * profile runs on top of this; profiles may NOT override anything here except
 * the TTS voice, and only through a named voice slot (see voiceSlots.ts).
 *
 * Changing a value here is a stack change, not a profile change — re-verify
 * against the live TEST agent (scripts/el-preflight.ts) before merging.
 */

export const LAYER_A = Object.freeze({
  tts: Object.freeze({
    modelId: "eleven_v4_turbo",
    voiceId: "oWjuL7HSoaEJRMDMP3HD", // Amy (also the `female` voice slot)
    expressiveMode: false,
    speed: 0.92,
    stability: 0.7,
    similarityBoost: 0.75,
    optimizeStreamingLatency: 3,
    outputAudioFormat: "pcm_16000",
  }),
  backgroundSound: Object.freeze({
    // Quiet office ambience under the voice.
    sourceType: "preset",
    sourceId: "office2",
    volume: 0.15,
    crossfadeLoop: true,
  }),
  turn: Object.freeze({
    model: "turn_v3",
    eagerness: "patient",
    timeoutSeconds: 10,
    speculativeTurn: true,
  }),
  asr: Object.freeze({
    provider: "scribe_realtime",
    quality: "high",
    inputAudioFormat: "pcm_16000",
  }),
  sip: Object.freeze({
    provider: "telnyx",
    address: "sip.telnyx.com",
    transport: "tcp",
  }),
} as const);

export type LayerA = typeof LAYER_A;

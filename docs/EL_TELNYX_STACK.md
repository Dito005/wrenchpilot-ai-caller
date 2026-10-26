# ElevenLabs ConvAI + Telnyx SIP stack

Outbound AI calls run on ElevenLabs Conversational AI, dialed out over a Telnyx SIP trunk. The config is split in two layers:

- **Layer A** (fixed, `server/elevenlabs/layerA.ts`) is the voice stack every profile shares.
- **Layer B** (swappable, e.g. `server/elevenlabs/demoFollowup.ts`) is the per-use-case agent, phone number, prompt settings and voice slot.

The repo never PATCHes an agent or phone number. It **reads** them (preflight and drift check) and **dials** through them.

## Layer A: quiet-bland (fixed)

These are the knobs Adeel approved on `conv_2301m5wxk614frgt2rtnbqs1dgex`. The earlier v3 + expressive + background-off sound (`conv_2801m5x3gtzdf3aa65aqdknmg40a`) was **rejected**. The drift check now blocks it.

| Area | Setting |
|---|---|
| TTS | `eleven_v4_turbo`, voice Amy `oWjuL7HSoaEJRMDMP3HD`, `expressive_mode` false, speed 0.92, stability 0.7, similarity_boost 0.75, optimize_streaming_latency 3, `pcm_16000` |
| Background | preset `office2`, volume 0.15, crossfade_loop true |
| Turn | `turn_v3`, eagerness patient, timeout 10 s, speculative_turn true |
| ASR | `scribe_realtime`, quality high, `pcm_16000` |
| SIP | Telnyx `sip.telnyx.com`, transport TCP |

Profiles may only change the TTS voice, and only through a voice slot.

## Layer B: `demo_followup`

| | |
|---|---|
| Agent (TEST) | `agent_7401m5szbg8je1psmfqrnjah5ya1` |
| Phone (TEST) | `phnum_1601m5t1nrg8eectqpdex82fqepv` → +1 863-808-4158 |
| First message | "Hi, is this Adeel?" |
| LLM | gpt-4.1, temperature 0.25, max_tokens 160, timezone America/New_York |
| Tools | `end_call`, `voicemail_detection` only |
| Max duration | 180 s |
| Knowledge base | id `RKSbyNek0y22yaAAwVkb` (body lives in ElevenLabs only) |

### Voice slots

| Slot | Name | Voice ID |
|---|---|---|
| `female` (default) | Amy | `oWjuL7HSoaEJRMDMP3HD` |
| `male_1` | Andrew | `SF9uvIlY93SJRMdV5jeP` |
| `male_2` | Joseph | `TTyZrDYo6LQowrH8mixJ` |
| `alt_1` | Eryn | `dMyQqiVXTU80dDl2eNK8` |

Callers pass a slot key or a slot name. Raw voice IDs and unknown names are rejected. Non-Amy slots are sent as a per-call `conversation_config_override.tts.voice_id`, so the TEST agent must allow that override. The slot name is passed as the `{{agent_name}}` dynamic variable, and also inside `{{intro_line}}` ("This is Andrew, calling from WrenchPilot.").

The other dynamic variables are `lead_name`, `lead_first_name`, `lead_email`, `calendly_url`, `voice_slot` and `profile`.

### Persona delivery rules

These live in `PERSONA_RULES`; the agent prompt should match them.

- Calm, about 2/10 energy. Short turns.
- Never self-identify as an AI, bot or assistant.
- No hype words (amazing, fantastic, awesome, incredible, absolutely, perfect, wonderful).
- Intro comes only after the lead confirms identity: `{{agent_name}}`, calling from WrenchPilot.
- Booking goes through https://calendly.com/service-wrenchpilot/30min. Never claim a booking was made, and never invent a time.

## Dial flow (`server/elevenlabs/client.ts`)

1. **Prod guard.** Anything naming prod Amy is refused in-process: `agent_8401m4ppna9dens85pfp17f4h78d`, `phnum_5501m4pprynve1298ja32t04a3ma`, +1 229-632-0387 as the from or to number.
2. **Voice slot** resolution.
3. **Preflight.** `GET /v1/convai/phone-numbers/{TEST phone}` must still show the TEST agent, the +18638084158 number, `sip_trunk`, and `sip.telnyx.com`/TCP when the API reports trunk details. Then `GET /v1/convai/agents/{TEST agent}` is diffed against Layer A and the profile.
   - Any value that is present and different is **drift**, and it blocks the dial.
   - A field the API doesn't report is listed as *unverified* and does not block.
4. **Dial.** `POST /v1/convai/sip-trunk/outbound-call` with `agent_id`, `agent_phone_number_id`, `to_number` and `conversation_initiation_client_data`. This only happens when `EL_PLACE_CALLS_APPROVED=true`; dry runs stop before this step.

The returned `conversation_id` is stored in `call_logs.blandCallId` (the legacy column name).

## Flags

| Env | Effect |
|---|---|
| `ELEVENLABS_API_KEY` | Required for preflight and dial (`xi-api-key` header). |
| `EL_DEMO_FOLLOWUP_ENABLED=true` | `callerBot.dialNumber` and the lead scheduler use EL demo_followup instead of Twilio + Gemini Live. |
| `EL_PLACE_CALLS_APPROVED=true` | Allows real outbound calls. **Keep false until Adeel says go.** |

With the routing flag on and the approval flag off, every dial attempt is refused with `FORBIDDEN`. `callerBot.dialElDemoFollowup` with `dryRun: true` still works.

## Read-only checks

```bash
ELEVENLABS_API_KEY=... npx tsx scripts/el-preflight.ts          # Amy
ELEVENLABS_API_KEY=... npx tsx scripts/el-preflight.ts male_1   # Andrew
```

The tRPC equivalents are `callerBot.elDemoFollowupPreflight` (query) and `callerBot.dialElDemoFollowup({ dryRun: true, ... })`.

A read-only live GET on 2026-10-26 (America/New_York) confirmed that the TEST agent matches quiet-bland Layer A and is still on the TEST phone. These field paths in the agent response are verified:

- TTS: `conversation_config.tts.{model_id, voice_id, expressive_mode, stability, speed, similarity_boost}`
- Background: `conversation_config.conversation.background_sound.{source_type, source_id, volume, crossfade_loop}`
- Timezone: `conversation_config.agent.prompt.timezone`

Every preflight runs a fresh GET (nothing is cached). If that GET matches, preflight passes. Dialing is still blocked until `EL_PLACE_CALLS_APPROVED=true`.

## Not in this repo

- **Telnyx AI Assistants (Ultra).** This caller never had a Telnyx Assistants path. The previous live path was Twilio + Gemini Live, and the EL flag bypasses it. Telnyx is used only as the SIP trunk behind ElevenLabs.
- **Bland.** Not used on this path.

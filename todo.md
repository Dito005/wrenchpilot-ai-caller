# WrenchPilot AI Caller — TODO

## Database & Schema
- [x] Add `leads` table (name, phone, email, source, status, call_id, transcript, booking_url, created_at)
- [x] Add `call_logs` table (lead_id, bland_call_id, status, transcript, recording_url, outcome, created_at)
- [x] Run migration SQL

## Backend — Facebook Webhook
- [x] GET /api/webhooks/facebook — challenge-response verification endpoint
- [x] POST /api/webhooks/facebook — receive leadgen payload, fetch lead data from Graph API, store lead
- [x] 5-minute delayed call trigger using setTimeout

## Backend — Calendly Integration
- [x] GET Calendly scheduled events by invitee email (pre-call check)
- [x] Calendly in-call booking tool for Bland.ai (get_calendly_link tool)

## Backend — Bland.ai Integration
- [x] Phone number provisioning endpoint (via tRPC settings.provisionPhone)
- [x] Dispatch outbound call with full AI task/script
- [x] Bland.ai in-call tool: check_calendly_booking + get_calendly_link
- [x] POST /api/webhooks/bland — post-call webhook handler (record outcome, transcript, status)

## Admin Dashboard
- [x] Leads table with status badges (pending, called, booked, no-answer)
- [x] Lead detail view with call transcript
- [x] Calendly booking confirmation display
- [x] Phone number provisioning UI (Settings page)
- [x] Real-time status refresh (15s auto-refresh)
- [x] Manual lead add with 5-minute call scheduling
- [x] Webhook configuration guide (Settings page)

## Tests
- [x] Facebook webhook verification test
- [x] Phone number normalization test
- [x] Lead status lifecycle test
- [x] Bland.ai post-call status determination test
- [x] Transcript parsing test
- [x] Auth logout test

## Phase 2 — Fixes & Enhancements
- [x] Diagnose and fix Facebook webhook lead ingestion (leads not appearing in dashboard)
- [x] Upgrade Bland.ai to most realistic voice (turbo model + best voice)
- [x] Add system-wide ON/OFF pause toggle (stops auto-calling when paused)
- [x] Build comprehensive Testing tab: fire test call, voice selector, AI profile preview
- [x] Add voice list from Bland.ai API to Testing tab selector
- [x] Show AI agent profile (name, script preview) in Testing tab
- [x] Ensure leads from Facebook webhook appear in Leads dashboard in real time

## Phase 3 — Voice Realism
- [x] Add background_track: "office" to Bland.ai call dispatch for ambient office sounds
- [x] Make background track configurable in Settings (office / cafe / restaurant / none)

## Phase 4 — Calendly Real Booking + Voice Consistency
- [x] Research Calendly scheduling API to create bookings programmatically
- [x] Build /api/tools/book-calendly endpoint that collects name, email, date/time and creates a real Calendly event
- [x] Update Bland.ai call task/script to ask for preferred date/time and call the booking tool
- [x] Add verbal confirmation step: AI reads back the booked slot and asks if they received the confirmation email
- [x] Pin voice to a single consistent ID across all call dispatches (no randomness)
- [x] Ensure voice setting from Settings is always respected, never overridden

## Phase 5 — Gemini Live + Twilio Rebuild
- [x] Store TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, GOOGLE_AI_API_KEY secrets
- [x] Install twilio, @google/genai (Gemini SDK) npm packages
- [x] Build gemini.ts — Gemini 3.1 Flash Live WebSocket session manager with tool calling
- [x] Build twilio.ts — outbound call dispatch, TwiML media stream, call status callbacks
- [x] Build /api/twiml/voice — TwiML endpoint that connects call to Gemini Live WebSocket
- [x] Build /api/twiml/stream — WebSocket media stream bridge between Twilio and Gemini Live
- [x] Wire Calendly tools (get_available_slots, book_demo) into Gemini tool declarations
- [x] Update callScheduler.ts to use Twilio dispatch instead of Bland.ai
- [x] Update routers.ts fireTestCall to use Twilio dispatch
- [x] Update post-call webhook to handle Twilio status callbacks
- [x] Update admin dashboard to show Twilio call status and Gemini transcripts
- [x] Provision Twilio phone number for outbound calls
- [x] Remove Bland.ai dependency from all active call paths
- [x] Run all tests and confirm system works end-to-end

## Phase 6 — Fix Twilio Call Dispatch
- [x] Diagnose why outbound calls are not connecting
- [x] Fix TwiML URL to use the published domain (wrenchai-bokbst2i.manus.space)
- [x] Handle Twilio trial account verified number restriction
- [x] Test call end-to-end and confirm it connects

## Phase 6b — Twilio Trial Account & Diagnostics
- [x] Detect Twilio trial account mode and show warning in Settings when calling unverified numbers
- [x] Add TwiML URL health check endpoint so Settings can verify the published URL is reachable by Twilio
- [x] Confirm post-fix test call outcome is recorded in the database (transcript + status)

## Phase 6c — Call Persistence & Trial Warnings
- [x] Warn before dispatching test call if Twilio is trial and the number is not in verified list
- [x] Create call_logs row for test calls (leadId=0) so transcript + status can be persisted

## Phase 7 — Audio Fix & Facebook Webhook
- [x] Fix Gemini Live audio pipeline — call connects but no voice heard
- [x] Fix codec negotiation between Twilio mulaw 8kHz and Gemini Live PCM
- [x] Fix audio chunking and response handling in media stream bridge (300ms buffer)
- [x] Add Facebook Lead Ads webhook setup guide (correct Meta Developer location)
- [x] Add audio pipeline unit tests (round-trip, buffer threshold, conversion ratios)
- [x] Verify end-to-end: call connects, AI voice heard, Gemini responds

## Phase 8 — Root Cause Audio Fix (Silent Call)
- [x] Diagnosed: Gemini model `gemini-2.0-flash-live-001` no longer exists → 1008 Policy Violation on every call
- [x] Fixed: Updated model to `gemini-2.5-flash-native-audio-latest` (the only model supporting bidiGenerateContent)
- [x] Fixed: TwiML stream URL hardcoded to published domain (Cloudflare strips x-forwarded-host → wrong internal URL)
- [x] Fixed: Media stream handler uses TwiML customParameters as fallback (eliminates activeSessions race condition)
- [x] Fixed: buildTwiML now embeds leadName, leadEmail, agentName, extraContext as <Parameter> tags
- [x] Verified: Full pipeline test — audio received in 1.6s, 21 audio chunks returned from Gemini

## Phase 9 — Latency & Background Noise
- [x] Switch Gemini model to gemini-3.1-flash-live-preview
- [x] Reduce audio buffer from 300ms to 20ms (send each Twilio chunk immediately)
- [x] Add background office noise (server-side PCM mixing at 6% volume)
- [x] Fixed race condition: pre-fetch voice setting before WebSocket open
- [x] Fixed deprecated mediaChunks: updated to realtimeInput.audio format
- [x] Verified: audio received in 666ms, 15 chunks, full pipeline working

## Phase 10 — Validation Gaps
- [x] Add unit test: background noise mixing modifies outbound μ-law audio and handles CDN failure safely
- [x] Add unit test: noise looping, clamping, length preservation, and null-safety all verified (6 tests)

## Phase 11 — Script, Noise, Voice, Calendly
- [x] Rewrite system prompt: natural/authoritative tone, not salesy, one question at a time (done in Phase 12)
- [x] Add correct pricing: Shop solution up to 20 techs = $300/month; Solo solution = $4,995 (done in Phase 12)
- [x] Add Calendly email confirmation step: ask for email, book, confirm they received the invite (done in Phase 12)
- [x] Fix background noise: CDN URL verified accessible, mixing code confirmed in pipeline (done in Phase 12)
- [x] Fix voice selector: Settings → Agent voice dropdown wired to gemini_voice setting, Charon default (done in Phase 12)
- [x] Fix Calendly booking: 7-day range fix, 109 slots found, notes parameter added (done in Phase 12)

## Phase 12 — Script v2, Voice, Calendly Notes, Noise
- [x] Fix TS error in buildSystemPrompt (template literal nesting issue — escaped backtick)
- [x] Rewrite call script: brief intro, confirm name, mention inquiry, offer demo, answer questions, book
- [x] Add full product knowledge: time tracking, profitability reports, customer portal, reporting
- [x] Add "write notes to demo" fallback for questions outside AI knowledge
- [x] Fix Calendly date range: 7-day window (not 14), start_time 1hr from now — 109 slots found
- [x] Add Calendly booking notes: write call summary and any questions asked into the booking notes
- [x] Fix voice: use Charon (deep male voice) as default, mark as recommended
- [x] Verified background noise CDN URL accessible (200 OK, 160KB WAV)
- [x] Fix voice selector in Settings: default to Charon, IDs match Gemini voice names

## Phase 13 — Post-Call SMS Confirmation
- [x] Add send_confirmation_sms tool to Gemini tool definitions (phone, booked_time, lead_name params)
- [x] Implement Twilio SMS helper in server/sms.ts (send SMS from provisioned number)
- [x] Wire send_confirmation_sms tool executor in gemini.ts executeTool()
- [x] Pass lead phone number into GeminiSession via TwiML params and activeSessions store
- [x] Update system prompt: after booking confirmed, instruct AI to call send_confirmation_sms
- [x] SMS message: first name, booked date/time, calendar invite note, Calendly reschedule link
- [x] 6 SMS message unit tests added (first name, date/time, links, sign-off)
- [x] 52 tests total passing

## Phase 14 — Booking Flow Fixes
- [x] Never re-ask for name — CRITICAL RULES section + NAME RULE section both enforce this
- [x] Add spelling confirmation: EMAIL SPELLING RULE + Step 6a read back character by character
- [x] Name spelling check: AI uses firstName from session, never asks for it
- [x] Enforce meeting notes: BOOKING NOTES — REQUIRED section with example notes
- [x] Add email delivery confirmation: Step 8 asks 'Did the calendar invite come through to [email]?'
- [x] Handle invite not received: Step 8 fallback with spam folder tip and Calendly link
- [x] SMS confirmation: Step 9 calls send_confirmation_sms after email confirmation
- [x] 52 tests passing, 0 TS errors

## Phase 15 — Background Noise Fix
- [x] Diagnosed: 6% volume too quiet for phone audio compression
- [x] Increased noise volume from 6% to 20%
- [x] Generated new ambient noise file: brown noise HVAC + pink noise chatter (30s, 8kHz)
- [x] Uploaded new CDN URL: office_ambient_v2_8k_8d66d4a3.wav
- [x] Mixing applied to every outbound audio chunk via mixBackgroundNoise()

## Phase 16 — Latency & Interruption Fix
- [x] Confirmed model is gemini-3.1-flash-live-preview
- [x] Added realtimeInputConfig.automaticActivityDetection: START_SENSITIVITY_HIGH, END_SENSITIVITY_HIGH, silenceDurationMs=500
- [x] Added activityHandling: START_OF_ACTIVITY_INTERRUPTS (barge-in support)
- [x] Added interrupted flag handler in handleMessage
- [x] Reduced audio buffer threshold to 1 (send every single Twilio chunk immediately)
- [x] Audio received in 1.0s in end-to-end test, 63 tests passing

/**
 * ElevenLabs ConvAI outbound over Telnyx SIP — demo_followup path.
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow for every dial:
 *   1. Prod guard   — refuse anything that names production Amy.
 *   2. Voice slot   — resolve slot key/name; raw IDs rejected.
 *   3. Preflight    — GET the TEST phone number and confirm it is still
 *                     assigned to the TEST agent (and on Telnyx SIP if the API
 *                     reports trunk details). GET the TEST agent and diff it
 *                     against Layer A + the profile (drift = refuse).
 *   4. Dial         — POST /v1/convai/sip-trunk/outbound-call, only when
 *                     EL_PLACE_CALLS_APPROVED=true (otherwise refused).
 *
 * Read-only except step 4. Nothing here PATCHes an agent or phone number.
 */

import { LAYER_A } from "./layerA";
import { DEMO_FOLLOWUP, buildIntroLine } from "./demoFollowup";
import { assertNotProd } from "./guards";
import { resolveVoiceSlot, type ResolvedVoiceSlot } from "./voiceSlots";

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

type FetchLike = typeof fetch;

export interface ElClientOptions {
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export class ElevenLabsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export class PreflightError extends Error {
  constructor(message: string, readonly problems: string[]) {
    super(message);
    this.name = "PreflightError";
  }
}

/** Feature flag: route outbound calls through EL demo_followup instead of Twilio + Gemini. */
export function isElDemoFollowupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EL_DEMO_FOLLOWUP_ENABLED === "true";
}

/**
 * Second, independent gate for real dials. Routing can be switched to EL with
 * EL_DEMO_FOLLOWUP_ENABLED while this stays off: every dial is then forced to
 * a dry run. Only set EL_PLACE_CALLS_APPROVED=true once Adeel has said go.
 */
export function isPlaceCallApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EL_PLACE_CALLS_APPROVED === "true";
}

export class PlaceCallNotApprovedError extends Error {
  constructor() {
    super("Live dialing is not approved (EL_PLACE_CALLS_APPROVED is not true). Only dry runs are allowed.");
    this.name = "PlaceCallNotApprovedError";
  }
}

function resolveApiKey(options: ElClientOptions): string {
  const key = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set");
  return key;
}

async function elRequest<T>(
  method: "GET" | "POST",
  path: string,
  options: ElClientOptions,
  body?: unknown
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${ELEVENLABS_API_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": resolveApiKey(options),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ElevenLabsError(`ElevenLabs ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ─── Read helpers ────────────────────────────────────────────────────────────

export interface ElPhoneNumber {
  phone_number?: string;
  phone_number_id?: string;
  provider?: string;
  assigned_agent?: { agent_id?: string; agent_name?: string } | null;
  outbound_trunk?: { address?: string; transport?: string } | null;
  provider_config?: { address?: string; transport?: string } | null;
}

export function getPhoneNumber(phoneNumberId: string, options: ElClientOptions = {}) {
  assertNotProd({ phoneNumberId });
  return elRequest<ElPhoneNumber>("GET", `/v1/convai/phone-numbers/${encodeURIComponent(phoneNumberId)}`, options);
}

export function getAgent(agentId: string, options: ElClientOptions = {}) {
  assertNotProd({ agentId });
  return elRequest<Record<string, unknown>>("GET", `/v1/convai/agents/${encodeURIComponent(agentId)}`, options);
}

// ─── Phone preflight ─────────────────────────────────────────────────────────

/** Problems that make the TEST phone unsafe to dial from. Empty array = OK. */
export function checkPhoneAssignment(phone: ElPhoneNumber): string[] {
  const problems: string[] = [];
  const assigned = phone.assigned_agent?.agent_id;

  try {
    assertNotProd({ agentId: assigned, phoneNumberId: phone.phone_number_id, phoneNumber: phone.phone_number });
  } catch (err) {
    problems.push((err as Error).message);
  }
  if (assigned !== DEMO_FOLLOWUP.agentId) {
    problems.push(`Phone ${DEMO_FOLLOWUP.phoneNumberId} is assigned to ${assigned ?? "no agent"}, expected TEST agent ${DEMO_FOLLOWUP.agentId}.`);
  }
  if (phone.phone_number && phone.phone_number.replace(/\D/g, "") !== DEMO_FOLLOWUP.phoneNumber.replace(/\D/g, "")) {
    problems.push(`Phone number is ${phone.phone_number}, expected ${DEMO_FOLLOWUP.phoneNumber}.`);
  }
  if (phone.provider && phone.provider !== "sip_trunk") {
    problems.push(`Phone provider is ${phone.provider}, expected sip_trunk (Telnyx).`);
  }
  const trunk = phone.outbound_trunk ?? phone.provider_config;
  if (trunk?.address && !trunk.address.includes(LAYER_A.sip.address)) {
    problems.push(`Outbound SIP address is ${trunk.address}, expected ${LAYER_A.sip.address}.`);
  }
  if (trunk?.transport && trunk.transport.toLowerCase() !== LAYER_A.sip.transport) {
    problems.push(`Outbound SIP transport is ${trunk.transport}, expected ${LAYER_A.sip.transport}.`);
  }
  return problems;
}

// ─── Agent drift check ───────────────────────────────────────────────────────

export interface DriftReport {
  /** Field present on the agent with a different value — blocks dialing. */
  drift: string[];
  /** Field not found at any known path — reported, does not block. */
  unverified: string[];
}

/**
 * Walk a dotted path. A null on the way down returns null (e.g. a disabled
 * background_sound object means "off"); a missing key returns undefined.
 */
function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null) return null;
    if (typeof cur !== "object" || !(key in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function readFirst(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = readPath(obj, p);
    if (v !== undefined) return v;
  }
  return undefined;
}

const CC = "conversation_config";

const FIELD_CHECKS: Array<{ label: string; paths: string[]; expected: unknown }> = [
  { label: "tts.model_id", paths: [`${CC}.tts.model_id`], expected: LAYER_A.tts.modelId },
  { label: "tts.voice_id", paths: [`${CC}.tts.voice_id`], expected: LAYER_A.tts.voiceId },
  { label: "tts.expressive_mode", paths: [`${CC}.tts.expressive_mode`], expected: LAYER_A.tts.expressiveMode },
  { label: "tts.speed", paths: [`${CC}.tts.speed`], expected: LAYER_A.tts.speed },
  { label: "tts.stability", paths: [`${CC}.tts.stability`], expected: LAYER_A.tts.stability },
  { label: "tts.similarity_boost", paths: [`${CC}.tts.similarity_boost`], expected: LAYER_A.tts.similarityBoost },
  { label: "tts.optimize_streaming_latency", paths: [`${CC}.tts.optimize_streaming_latency`], expected: LAYER_A.tts.optimizeStreamingLatency },
  { label: "tts.agent_output_audio_format", paths: [`${CC}.tts.agent_output_audio_format`], expected: LAYER_A.tts.outputAudioFormat },
  {
    label: "background_sound.source_type",
    paths: [`${CC}.background_sound.source_type`, `${CC}.agent.background_sound.source_type`, `${CC}.tts.background_sound.source_type`],
    expected: LAYER_A.backgroundSound.sourceType,
  },
  {
    label: "background_sound.source_id",
    paths: [`${CC}.background_sound.source_id`, `${CC}.agent.background_sound.source_id`, `${CC}.tts.background_sound.source_id`],
    expected: LAYER_A.backgroundSound.sourceId,
  },
  {
    label: "background_sound.volume",
    paths: [`${CC}.background_sound.volume`, `${CC}.agent.background_sound.volume`, `${CC}.tts.background_sound.volume`],
    expected: LAYER_A.backgroundSound.volume,
  },
  {
    label: "background_sound.crossfade_loop",
    paths: [`${CC}.background_sound.crossfade_loop`, `${CC}.agent.background_sound.crossfade_loop`, `${CC}.tts.background_sound.crossfade_loop`],
    expected: LAYER_A.backgroundSound.crossfadeLoop,
  },
  { label: "turn.turn_model", paths: [`${CC}.turn.turn_model`, `${CC}.turn.model`], expected: LAYER_A.turn.model },
  { label: "turn.turn_eagerness", paths: [`${CC}.turn.turn_eagerness`], expected: LAYER_A.turn.eagerness },
  { label: "turn.turn_timeout", paths: [`${CC}.turn.turn_timeout`], expected: LAYER_A.turn.timeoutSeconds },
  { label: "turn.speculative_turn", paths: [`${CC}.turn.speculative_turn`], expected: LAYER_A.turn.speculativeTurn },
  { label: "asr.provider", paths: [`${CC}.asr.provider`], expected: LAYER_A.asr.provider },
  { label: "asr.quality", paths: [`${CC}.asr.quality`], expected: LAYER_A.asr.quality },
  { label: "asr.user_input_audio_format", paths: [`${CC}.asr.user_input_audio_format`], expected: LAYER_A.asr.inputAudioFormat },
  { label: "agent.first_message", paths: [`${CC}.agent.first_message`], expected: DEMO_FOLLOWUP.firstMessage },
  { label: "agent.prompt.llm", paths: [`${CC}.agent.prompt.llm`], expected: DEMO_FOLLOWUP.llm.model },
  { label: "agent.prompt.temperature", paths: [`${CC}.agent.prompt.temperature`], expected: DEMO_FOLLOWUP.llm.temperature },
  { label: "agent.prompt.max_tokens", paths: [`${CC}.agent.prompt.max_tokens`], expected: DEMO_FOLLOWUP.llm.maxTokens },
  {
    label: "timezone",
    paths: [`${CC}.agent.prompt.timezone`, `${CC}.agent.timezone`, `${CC}.conversation.timezone`],
    expected: DEMO_FOLLOWUP.timezone,
  },
  { label: "conversation.max_duration_seconds", paths: [`${CC}.conversation.max_duration_seconds`], expected: DEMO_FOLLOWUP.maxDurationSeconds },
];

function enabledToolNames(agent: unknown): Set<string> | undefined {
  const builtIn = readPath(agent, `${CC}.agent.prompt.built_in_tools`);
  const tools = readPath(agent, `${CC}.agent.prompt.tools`);
  const toolIds = readPath(agent, `${CC}.agent.prompt.tool_ids`);
  if (builtIn === undefined && tools === undefined && toolIds === undefined) return undefined;

  const names = new Set<string>();
  if (builtIn && typeof builtIn === "object") {
    for (const [name, cfg] of Object.entries(builtIn)) if (cfg) names.add(name);
  }
  if (Array.isArray(tools)) {
    for (const t of tools) {
      const tool = t as { name?: string; params?: { system_tool_type?: string } };
      const name = tool.params?.system_tool_type ?? tool.name;
      if (name) names.add(name);
    }
  }
  if (Array.isArray(toolIds)) {
    for (const id of toolIds) names.add(`tool_id:${String(id)}`);
  }
  return names;
}

/** Diff a GET /v1/convai/agents/{id} payload against Layer A + demo_followup. */
export function checkAgentDrift(agent: unknown, voice?: ResolvedVoiceSlot): DriftReport {
  const report: DriftReport = { drift: [], unverified: [] };

  for (const check of FIELD_CHECKS) {
    const actual = readFirst(agent, check.paths);
    if (actual === undefined) report.unverified.push(check.label);
    else if (actual !== check.expected) {
      report.drift.push(`${check.label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(check.expected)}`);
    }
  }

  const tools = enabledToolNames(agent);
  if (!tools) report.unverified.push("agent.prompt tools");
  else {
    const expected = new Set<string>(DEMO_FOLLOWUP.tools);
    const extra = Array.from(tools).filter(t => !expected.has(t));
    const missing = Array.from(expected).filter(t => !tools.has(t));
    if (extra.length) report.drift.push(`unexpected tools enabled: ${extra.join(", ")}`);
    if (missing.length) report.drift.push(`expected tools missing: ${missing.join(", ")}`);
  }

  const kb = readPath(agent, `${CC}.agent.prompt.knowledge_base`);
  if (!Array.isArray(kb)) report.unverified.push("agent.prompt.knowledge_base");
  else if (!kb.some(doc => (doc as { id?: string })?.id === DEMO_FOLLOWUP.knowledgeBaseId)) {
    report.drift.push(`knowledge base ${DEMO_FOLLOWUP.knowledgeBaseId} is not attached`);
  }

  // A non-default voice slot is sent as a per-call TTS override; the agent must allow it.
  if (voice && voice.voiceId !== LAYER_A.tts.voiceId) {
    const allowed = readPath(agent, "platform_settings.overrides.conversation_config_override.tts.voice_id");
    if (allowed === false) {
      report.drift.push(`voice slot ${voice.slot} needs the tts.voice_id override enabled on the TEST agent`);
    } else if (allowed === undefined) {
      report.unverified.push("platform_settings tts.voice_id override");
    }
  }

  return report;
}

// ─── Preflight + dial ────────────────────────────────────────────────────────

export interface PreflightResult {
  ok: boolean;
  problems: string[];
  unverified: string[];
}

/** Read-only check that the TEST phone + agent are safe to dial through. */
export async function preflightDemoFollowup(
  voice: ResolvedVoiceSlot = resolveVoiceSlot(undefined),
  options: ElClientOptions = {}
): Promise<PreflightResult> {
  assertNotProd({
    agentId: DEMO_FOLLOWUP.agentId,
    phoneNumberId: DEMO_FOLLOWUP.phoneNumberId,
    phoneNumber: DEMO_FOLLOWUP.phoneNumber,
  });

  const phone = await getPhoneNumber(DEMO_FOLLOWUP.phoneNumberId, options);
  const problems = checkPhoneAssignment(phone);
  // Don't read the agent at all if the phone already points somewhere unexpected.
  if (problems.length) return { ok: false, problems, unverified: [] };

  const agent = await getAgent(DEMO_FOLLOWUP.agentId, options);
  const drift = checkAgentDrift(agent, voice);
  problems.push(...drift.drift);
  return { ok: problems.length === 0, problems, unverified: drift.unverified };
}

export interface DemoFollowupDialInput {
  toNumber: string;
  leadName?: string;
  leadEmail?: string;
  /** Slot key (`male_1`) or slot name (`Andrew`). Defaults to `female` (Amy). */
  voiceSlot?: string;
  /** Build and validate the request but do not POST it. */
  dryRun?: boolean;
}

export interface OutboundCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data: {
    dynamic_variables: Record<string, string>;
    conversation_config_override?: { tts: { voice_id: string } };
  };
}

export interface DemoFollowupDialResult {
  dryRun: boolean;
  request: OutboundCallRequest;
  preflight: PreflightResult;
  conversationId?: string;
  sipCallId?: string;
}

/** Normalize to E.164 (US default), matching the Twilio dialer's rules. */
export function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  throw new ElevenLabsError(`Cannot normalize phone number "${phone}" to E.164`);
}

export function buildOutboundCallRequest(input: DemoFollowupDialInput, voice: ResolvedVoiceSlot): OutboundCallRequest {
  const toNumber = normalizeE164(input.toNumber);
  assertNotProd({ agentId: DEMO_FOLLOWUP.agentId, phoneNumberId: DEMO_FOLLOWUP.phoneNumberId, toNumber });

  const leadName = input.leadName?.trim() || "";
  const request: OutboundCallRequest = {
    agent_id: DEMO_FOLLOWUP.agentId,
    agent_phone_number_id: DEMO_FOLLOWUP.phoneNumberId,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: {
        profile: DEMO_FOLLOWUP.profile,
        agent_name: voice.name,
        voice_slot: voice.slot,
        intro_line: buildIntroLine(voice),
        lead_name: leadName,
        lead_first_name: leadName.split(/\s+/)[0] ?? "",
        lead_email: input.leadEmail?.trim() || "",
        calendly_url: DEMO_FOLLOWUP.calendlyUrl,
      },
    },
  };
  // Amy is the agent's own voice; only other slots need a per-call override.
  if (voice.voiceId !== LAYER_A.tts.voiceId) {
    request.conversation_initiation_client_data.conversation_config_override = { tts: { voice_id: voice.voiceId } };
  }
  return request;
}

/**
 * Place (or dry-run) a demo_followup call. Throws PreflightError if the TEST
 * phone is no longer on the TEST agent or the agent has drifted from Layer A.
 */
export async function dialDemoFollowup(
  input: DemoFollowupDialInput,
  options: ElClientOptions = {}
): Promise<DemoFollowupDialResult> {
  const voice = resolveVoiceSlot(input.voiceSlot);
  const request = buildOutboundCallRequest(input, voice);

  const preflight = await preflightDemoFollowup(voice, options);
  if (!preflight.ok) {
    throw new PreflightError(`demo_followup preflight failed: ${preflight.problems.join("; ")}`, preflight.problems);
  }
  if (input.dryRun) return { dryRun: true, request, preflight };
  if (!isPlaceCallApproved()) throw new PlaceCallNotApprovedError();

  // Re-check the ids on the exact payload we are about to send.
  assertNotProd({ agentId: request.agent_id, phoneNumberId: request.agent_phone_number_id, toNumber: request.to_number });
  const res = await elRequest<{ success?: boolean; message?: string; conversation_id?: string | null; sip_call_id?: string | null }>(
    "POST",
    "/v1/convai/sip-trunk/outbound-call",
    options,
    request
  );
  if (res.success === false) {
    throw new ElevenLabsError(`ElevenLabs outbound call rejected: ${res.message ?? "unknown reason"}`);
  }
  return {
    dryRun: false,
    request,
    preflight,
    conversationId: res.conversation_id ?? undefined,
    sipCallId: res.sip_call_id ?? undefined,
  };
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LAYER_A } from "./layerA";
import { DEMO_FOLLOWUP, buildIntroLine, findBannedPhrases } from "./demoFollowup";
import { PROD_AMY, ProdGuardError, assertNotProd } from "./guards";
import { VoiceSlotError, resolveVoiceSlot } from "./voiceSlots";
import {
  PreflightError,
  buildOutboundCallRequest,
  checkAgentDrift,
  checkPhoneAssignment,
  dialDemoFollowup,
  isElDemoFollowupEnabled,
  PlaceCallNotApprovedError,
} from "./client";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function testPhone(overrides: Record<string, unknown> = {}) {
  return {
    phone_number: DEMO_FOLLOWUP.phoneNumber,
    phone_number_id: DEMO_FOLLOWUP.phoneNumberId,
    provider: "sip_trunk",
    assigned_agent: { agent_id: DEMO_FOLLOWUP.agentId, agent_name: "TEST demo_followup" },
    outbound_trunk: { address: "sip.telnyx.com", transport: "tcp" },
    ...overrides,
  };
}

function testAgent() {
  return {
    agent_id: DEMO_FOLLOWUP.agentId,
    conversation_config: {
      tts: {
        model_id: "eleven_v4_turbo",
        voice_id: "oWjuL7HSoaEJRMDMP3HD",
        expressive_mode: false,
        speed: 0.92,
        stability: 0.7,
        similarity_boost: 0.75,
        optimize_streaming_latency: 3,
        agent_output_audio_format: "pcm_16000",
      },
      turn: { turn_model: "turn_v3", turn_eagerness: "patient", turn_timeout: 10, speculative_turn: true },
      asr: { provider: "scribe_realtime", quality: "high", user_input_audio_format: "pcm_16000" },
      conversation: {
        max_duration_seconds: 180,
        background_sound: { source_type: "preset", source_id: "office2", volume: 0.15, crossfade_loop: true },
      },
      agent: {
        first_message: "Hi, is this Adeel?",
        prompt: {
          llm: "gpt-4.1",
          temperature: 0.25,
          max_tokens: 160,
          timezone: "America/New_York",
          built_in_tools: { end_call: { name: "end_call" }, voicemail_detection: { name: "voicemail_detection" }, transfer_to_number: null },
          tool_ids: [],
          knowledge_base: [{ id: "RKSbyNek0y22yaAAwVkb", type: "text" }],
        },
      },
    },
    platform_settings: { overrides: { conversation_config_override: { tts: { voice_id: true } } } },
  };
}

function mockFetch(routes: { phone?: unknown; agent?: unknown; outbound?: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/v1/convai/phone-numbers/")) return json(routes.phone ?? testPhone());
    if (url.includes("/v1/convai/agents/")) return json(routes.agent ?? testAgent());
    if (url.endsWith("/v1/convai/sip-trunk/outbound-call") && init?.method === "POST") {
      return json(routes.outbound ?? { success: true, message: "ok", conversation_id: "conv_123", sip_call_id: "sip_456" });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const opts = (fetchImpl: typeof fetch) => ({ apiKey: "test-key", fetchImpl });

// ─── Layer A ─────────────────────────────────────────────────────────────────

describe("Layer A", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(LAYER_A)).toBe(true);
    expect(Object.isFrozen(LAYER_A.tts)).toBe(true);
    expect(() => {
      (LAYER_A.tts as { speed: number }).speed = 1;
    }).toThrow();
  });

  it("matches the verified TEST agent stack", () => {
    expect(LAYER_A.tts).toMatchObject({
      modelId: "eleven_v4_turbo",
      expressiveMode: false,
      voiceId: "oWjuL7HSoaEJRMDMP3HD",
      stability: 0.7,
      speed: 0.92,
      similarityBoost: 0.75,
    });
    expect(LAYER_A.backgroundSound).toEqual({ sourceType: "preset", sourceId: "office2", volume: 0.15, crossfadeLoop: true });
    expect(LAYER_A.sip).toEqual({ provider: "telnyx", address: "sip.telnyx.com", transport: "tcp" });
  });
});

// ─── Voice slots ─────────────────────────────────────────────────────────────

describe("voice slots", () => {
  it("defaults to female/Amy", () => {
    expect(resolveVoiceSlot(undefined)).toEqual({ slot: "female", name: "Amy", voiceId: "oWjuL7HSoaEJRMDMP3HD" });
  });

  it("resolves by slot key or name, case-insensitive", () => {
    expect(resolveVoiceSlot("male_1").name).toBe("Andrew");
    expect(resolveVoiceSlot("joseph").slot).toBe("male_2");
    expect(resolveVoiceSlot(" ERYN ").voiceId).toBe("dMyQqiVXTU80dDl2eNK8");
  });

  it("rejects raw voice IDs", () => {
    expect(() => resolveVoiceSlot("SF9uvIlY93SJRMdV5jeP")).toThrow(VoiceSlotError);
    expect(() => resolveVoiceSlot("21m00Tcm4TlvDq8ikWAM")).toThrow(/Raw voice IDs/);
  });

  it("rejects unknown names", () => {
    expect(() => resolveVoiceSlot("Rachel")).toThrow(/Unknown voice slot/);
    expect(() => resolveVoiceSlot("")).toThrow(VoiceSlotError);
  });

  it("intro uses the slot name and WrenchPilot", () => {
    expect(buildIntroLine(resolveVoiceSlot("male_1"))).toBe("This is Andrew, calling from WrenchPilot.");
  });
});

describe("persona", () => {
  it("flags hype words", () => {
    expect(findBannedPhrases("That's amazing, fantastic news")).toEqual(["amazing", "fantastic"]);
    expect(findBannedPhrases("Sounds good. Here's the link.")).toEqual([]);
  });
});

// ─── Prod guard ──────────────────────────────────────────────────────────────

describe("prod guard", () => {
  it("refuses prod agent, phone id and number", () => {
    expect(() => assertNotProd({ agentId: PROD_AMY.agentId })).toThrow(ProdGuardError);
    expect(() => assertNotProd({ phoneNumberId: PROD_AMY.phoneNumberId })).toThrow(ProdGuardError);
    expect(() => assertNotProd({ toNumber: "(229) 632-0387" })).toThrow(ProdGuardError);
  });

  it("allows the TEST ids", () => {
    expect(() =>
      assertNotProd({ agentId: DEMO_FOLLOWUP.agentId, phoneNumberId: DEMO_FOLLOWUP.phoneNumberId, phoneNumber: DEMO_FOLLOWUP.phoneNumber })
    ).not.toThrow();
  });

  it("refuses to build a request that dials the prod line", () => {
    expect(() => buildOutboundCallRequest({ toNumber: "+1 229 632 0387" }, resolveVoiceSlot("female"))).toThrow(ProdGuardError);
  });
});

// ─── Preflight ───────────────────────────────────────────────────────────────

describe("phone preflight", () => {
  it("passes when TEST phone is on TEST agent over Telnyx tcp", () => {
    expect(checkPhoneAssignment(testPhone())).toEqual([]);
  });

  it("fails when phone moved to another agent", () => {
    const problems = checkPhoneAssignment(testPhone({ assigned_agent: { agent_id: "agent_other" } }));
    expect(problems.join(" ")).toMatch(/expected TEST agent/);
  });

  it("fails loudly when phone is on prod Amy", () => {
    const problems = checkPhoneAssignment(testPhone({ assigned_agent: { agent_id: PROD_AMY.agentId } }));
    expect(problems.join(" ")).toMatch(/PROD Amy/);
  });

  it("fails on wrong SIP transport", () => {
    expect(checkPhoneAssignment(testPhone({ outbound_trunk: { address: "sip.telnyx.com", transport: "udp" } }))).toHaveLength(1);
  });
});

describe("agent drift", () => {
  it("is clean for the verified TEST agent", () => {
    expect(checkAgentDrift(testAgent(), resolveVoiceSlot("male_1"))).toEqual({ drift: [], unverified: [] });
  });

  it("passes a fresh GET matching the verified live quiet-bland TEST agent", () => {
    // Exactly the fields Caller Bot read live, at the paths it read them from.
    const agent = testAgent();
    expect(agent.conversation_config.tts).toMatchObject({
      model_id: "eleven_v4_turbo",
      voice_id: "oWjuL7HSoaEJRMDMP3HD",
      expressive_mode: false,
      stability: 0.7,
      speed: 0.92,
      similarity_boost: 0.75,
    });
    expect(agent.conversation_config.conversation.background_sound).toEqual({
      source_type: "preset",
      source_id: "office2",
      volume: 0.15,
      crossfade_loop: true,
    });
    expect(agent.conversation_config.agent.prompt.timezone).toBe("America/New_York");
    expect(checkAgentDrift(agent)).toEqual({ drift: [], unverified: [] });
  });

  it("reports changed Layer A values", () => {
    const agent = testAgent();
    agent.conversation_config.tts.speed = 1.1;
    agent.conversation_config.turn.turn_eagerness = "eager";
    const report = checkAgentDrift(agent);
    expect(report.drift).toHaveLength(2);
    expect(report.drift[0]).toMatch(/tts.speed/);
  });

  it("reports background sound changed or turned off", () => {
    const agent = testAgent();
    agent.conversation_config.conversation.background_sound.volume = 0.4;
    expect(checkAgentDrift(agent).drift.join(" ")).toMatch(/background_sound.volume/);
    (agent.conversation_config.conversation as Record<string, unknown>).background_sound = null;
    expect(checkAgentDrift(agent).drift).toHaveLength(4);
  });

  it("reports the rejected v3 + expressive sound", () => {
    const agent = testAgent();
    agent.conversation_config.tts.model_id = "eleven_v3_conversational";
    agent.conversation_config.tts.expressive_mode = true;
    expect(checkAgentDrift(agent).drift).toHaveLength(2);
  });

  it("reports extra tools", () => {
    const agent = testAgent();
    (agent.conversation_config.agent.prompt.built_in_tools as Record<string, unknown>).transfer_to_number = { name: "transfer" };
    expect(checkAgentDrift(agent).drift.join(" ")).toMatch(/unexpected tools enabled: transfer_to_number/);
  });

  it("treats unknown field paths as unverified, not drift", () => {
    const agent = testAgent();
    delete (agent.conversation_config.agent.prompt as Record<string, unknown>).timezone;
    expect(checkAgentDrift(agent)).toEqual({ drift: [], unverified: ["timezone"] });
  });

  it("blocks non-default voice slots when the agent disallows the voice override", () => {
    const agent = testAgent();
    agent.platform_settings.overrides.conversation_config_override.tts.voice_id = false;
    expect(checkAgentDrift(agent, resolveVoiceSlot("female")).drift).toEqual([]);
    expect(checkAgentDrift(agent, resolveVoiceSlot("male_2")).drift.join(" ")).toMatch(/override/);
  });
});

// ─── Dial ────────────────────────────────────────────────────────────────────

describe("dialDemoFollowup", () => {
  // These exercise the request shape against a mocked fetch only — no real call.
  beforeEach(() => {
    process.env.EL_PLACE_CALLS_APPROVED = "true";
  });
  afterEach(() => {
    delete process.env.EL_PLACE_CALLS_APPROVED;
  });

  it("refuses a live dial without EL_PLACE_CALLS_APPROVED, and never POSTs", async () => {
    delete process.env.EL_PLACE_CALLS_APPROVED;
    const fetchImpl = mockFetch({});
    await expect(dialDemoFollowup({ toNumber: "+15550100000" }, opts(fetchImpl))).rejects.toThrow(PlaceCallNotApprovedError);
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("dry run preflights but never POSTs", async () => {
    const fetchImpl = mockFetch({});
    const res = await dialDemoFollowup({ toNumber: "555-010-0000", leadName: "Adeel K", dryRun: true }, opts(fetchImpl));
    expect(res.dryRun).toBe(true);
    expect(res.request.to_number).toBe("+15550100000");
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("POSTs the TEST agent + TEST phone with slot name as agent_name", async () => {
    const fetchImpl = mockFetch({});
    const res = await dialDemoFollowup({ toNumber: "+15550100000", leadName: "Adeel K", voiceSlot: "Andrew" }, opts(fetchImpl));
    expect(res.conversationId).toBe("conv_123");

    const post = fetchImpl.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST")!;
    expect(post[0]).toBe("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call");
    expect((post[1] as RequestInit).headers).toMatchObject({ "xi-api-key": "test-key" });
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.agent_id).toBe(DEMO_FOLLOWUP.agentId);
    expect(body.agent_phone_number_id).toBe(DEMO_FOLLOWUP.phoneNumberId);
    expect(body.conversation_initiation_client_data.dynamic_variables).toMatchObject({
      agent_name: "Andrew",
      lead_first_name: "Adeel",
      intro_line: "This is Andrew, calling from WrenchPilot.",
      calendly_url: "https://calendly.com/service-wrenchpilot/30min",
    });
    expect(body.conversation_initiation_client_data.conversation_config_override).toEqual({ tts: { voice_id: "SF9uvIlY93SJRMdV5jeP" } });
  });

  it("sends no TTS override for the default Amy slot", async () => {
    const fetchImpl = mockFetch({});
    const res = await dialDemoFollowup({ toNumber: "+15550100000" }, opts(fetchImpl));
    expect(res.request.conversation_initiation_client_data.conversation_config_override).toBeUndefined();
  });

  it("refuses to dial when the phone is no longer on the TEST agent, and skips the agent GET", async () => {
    const fetchImpl = mockFetch({ phone: testPhone({ assigned_agent: { agent_id: "agent_someone_else" } }) });
    await expect(dialDemoFollowup({ toNumber: "+15550100000" }, opts(fetchImpl))).rejects.toThrow(PreflightError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to dial on Layer A drift", async () => {
    const agent = testAgent();
    agent.conversation_config.tts.model_id = "eleven_v3_conversational";
    const fetchImpl = mockFetch({ agent });
    await expect(dialDemoFollowup({ toNumber: "+15550100000" }, opts(fetchImpl))).rejects.toThrow(/tts.model_id/);
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("rejects raw voice IDs before any network call", async () => {
    const fetchImpl = mockFetch({});
    await expect(dialDemoFollowup({ toNumber: "+15550100000", voiceSlot: "TTyZrDYo6LQowrH8mixJ" }, opts(fetchImpl))).rejects.toThrow(VoiceSlotError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses the prod line before any network call", async () => {
    const fetchImpl = mockFetch({});
    await expect(dialDemoFollowup({ toNumber: PROD_AMY.phoneNumber }, opts(fetchImpl))).rejects.toThrow(ProdGuardError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires ELEVENLABS_API_KEY", async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      await expect(dialDemoFollowup({ toNumber: "+15550100000" }, { fetchImpl: mockFetch({}) })).rejects.toThrow(/ELEVENLABS_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    }
  });
});

describe("feature flag", () => {
  it("is off unless exactly 'true'", () => {
    expect(isElDemoFollowupEnabled({})).toBe(false);
    expect(isElDemoFollowupEnabled({ EL_DEMO_FOLLOWUP_ENABLED: "1" })).toBe(false);
    expect(isElDemoFollowupEnabled({ EL_DEMO_FOLLOWUP_ENABLED: "true" })).toBe(true);
  });
});

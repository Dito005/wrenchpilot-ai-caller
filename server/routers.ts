import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getAllLeads, getLeadById, getCallLogsByLeadId, getSetting, setSetting } from "./db";
import { dispatchTwilioCall, purchaseTwilioNumber, getTwilioCallDetails, listTwilioCalls, listTwilioMessages, getActiveSessions } from "./twilio";
import { scheduleCall, executeCall } from "./callScheduler";
import { TRPCError } from "@trpc/server";
import {
  dispatchElDemoFollowupCall,
  isElDemoFollowupEnabled,
  preflightDemoFollowup,
  resolveVoiceSlot,
  toTrpcError,
  DEMO_FOLLOWUP,
  VOICE_SLOTS,
} from "./elevenlabs";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Leads ─────────────────────────────────────────────────────────────────

  leads: router({
    list: publicProcedure.query(async () => getAllLeads()),

    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const lead = await getLeadById(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
        const callLogs = await getCallLogsByLeadId(input.id);
        return { lead, callLogs };
      }),

    triggerCall: publicProcedure
      .input(z.object({ leadId: z.number(), baseUrl: z.string() }))
      .mutation(async ({ input }) => {
        const lead = await getLeadById(input.leadId);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead not found" });
        if (!lead.phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Lead has no phone number" });
        await executeCall(input.leadId, input.baseUrl);
        return { success: true };
      }),

    addManual: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        phone: z.string().min(7),
        email: z.string().email().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { createLead, getDb } = await import("./db");
        await createLead({
          name: input.name,
          phone: input.phone,
          email: input.email,
          status: "pending",
          facebookLeadId: `manual_${Date.now()}`,
        });

        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const { leads } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        const [lead] = await db.select().from(leads).orderBy(desc(leads.id)).limit(1);
        if (!lead) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Use the published domain directly — production proxy strips forwarded headers
        const baseUrl = process.env.NODE_ENV === "development"
          ? `${ctx.req.headers["x-forwarded-proto"] || ctx.req.protocol}://${ctx.req.headers["x-forwarded-host"] || ctx.req.headers.host}`
          : "https://wrenchai-bokbst2i.manus.space";
        scheduleCall(lead.id, baseUrl);
        return { success: true, leadId: lead.id };
      }),
  }),

  // ─── Caller Bot Monitor (now using Twilio + Gemini Live) ──────────────────

  callerBot: router({
    // Get active live sessions (Gemini Live sessions currently in progress)
    getActiveSessions: publicProcedure.query(async () => {
      return { sessions: getActiveSessions() };
    }),

    // Get Twilio call details by SID
    getLiveCall: publicProcedure
      .input(z.object({ callId: z.string() }))
      .query(async ({ input }) => {
        try {
          const details = await getTwilioCallDetails(input.callId);
          return { success: true, data: details };
        } catch (e: any) {
          return { success: false, error: e.message, data: null };
        }
      }),

    // List recent Twilio calls
    listRecentCalls: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const calls = await listTwilioCalls(input?.limit || 20);
        return { calls };
      }),

    /** SMS/MMS sent and received on the Twilio number (for message history). */
    listRecentMessages: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const messages = await listTwilioMessages(input?.limit ?? 100);
        return { messages };
      }),

    /**
     * Place an AI outbound call from the dialer (same stack as test calls).
     * Optional leadId loads name/email/context from the database.
     */
    dialNumber: publicProcedure
      .input(z.object({
        phone: z.string().min(7),
        name: z.string().min(1).optional(),
        email: z.string().optional(),
        leadId: z.number().optional(),
        /** EL path only: voice slot key or name (female/Amy, male_1/Andrew, …). */
        voiceSlot: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const baseUrl = process.env.NODE_ENV === "development"
          ? `${ctx.req.headers["x-forwarded-proto"] || ctx.req.protocol}://${ctx.req.headers["x-forwarded-host"] || ctx.req.headers.host}`
          : "https://wrenchai-bokbst2i.manus.space";

        let leadName = input.name?.trim() || "Lead";
        let leadEmail = input.email?.trim() || "";
        let leadIdForCall = 0;

        if (input.leadId != null) {
          const lead = await getLeadById(input.leadId);
          if (lead) {
            leadIdForCall = lead.id;
            if (lead.name) leadName = lead.name;
            if (lead.email) leadEmail = lead.email;
          }
        }

        // EL ConvAI + Telnyx SIP demo_followup bypasses Twilio + Gemini entirely.
        if (isElDemoFollowupEnabled()) {
          try {
            const { conversationId } = await dispatchElDemoFollowupCall({
              toNumber: input.phone,
              leadName,
              leadEmail,
              leadId: leadIdForCall,
              voiceSlot: input.voiceSlot,
            });
            return { success: true, callId: conversationId };
          } catch (err) {
            throw toTrpcError(err);
          }
        }

        const digits = input.phone.replace(/\D/g, "");
        let phone = input.phone.trim();
        if (digits.length === 10) phone = `+1${digits}`;
        else if (digits.length === 11 && digits.startsWith("1")) phone = `+${digits}`;

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
          try {
            const twilio = (await import("twilio")).default;
            const client = twilio(accountSid, authToken);
            const account = await client.api.v2010.accounts(accountSid).fetch();
            if (account.type === "Trial") {
              const callerIds = await client.outgoingCallerIds.list({ limit: 50 });
              const verifiedNumbers = callerIds.map((c: { phoneNumber: string }) => c.phoneNumber);
              const isVerified = verifiedNumbers.some((n: string) => n.replace(/\D/g, "") === digits);
              if (!isVerified) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `Twilio trial accounts can only call verified numbers. ${phone} is not verified. Verify it at console.twilio.com/phone-numbers/verified, or upgrade your Twilio account to call any number.`,
                });
              }
            }
          } catch (err: unknown) {
            const e = err as { code?: string; message?: string };
            if (e.code === "PRECONDITION_FAILED") throw err;
            console.warn("[Twilio] Could not check trial restrictions:", e.message);
          }
        }

        const { createCallLog, updateCallLog } = await import("./db");
        const callLog = await createCallLog({
          leadId: leadIdForCall,
          blandCallId: `dial_${Date.now()}`,
          status: "called",
        });

        const callSid = await dispatchTwilioCall({
          phone,
          leadName,
          leadEmail,
          leadId: leadIdForCall,
          webhookBaseUrl: baseUrl,
        });

        await updateCallLog(callLog.id, { blandCallId: callSid });

        return { success: true, callId: callSid };
      }),

    // ─── ElevenLabs ConvAI + Telnyx SIP (demo_followup) ─────────────────────

    /** Read-only: is the TEST phone still on the TEST agent, and does the agent match Layer A? */
    elDemoFollowupPreflight: publicProcedure
      .input(z.object({ voiceSlot: z.string().optional() }).optional())
      .query(async ({ input }) => {
        try {
          const voice = resolveVoiceSlot(input?.voiceSlot);
          const result = await preflightDemoFollowup(voice);
          return { enabled: isElDemoFollowupEnabled(), voice, ...result };
        } catch (err) {
          throw toTrpcError(err);
        }
      }),

    elVoiceSlots: publicProcedure.query(() => ({
      slots: Object.entries(VOICE_SLOTS).map(([slot, v]) => ({ slot, name: v.name })),
      profile: DEMO_FOLLOWUP.profile,
    })),

    /** Dial (or dry-run) demo_followup through EL. Requires EL_DEMO_FOLLOWUP_ENABLED=true unless dryRun. */
    dialElDemoFollowup: publicProcedure
      .input(z.object({
        phone: z.string().min(7),
        name: z.string().optional(),
        email: z.string().optional(),
        voiceSlot: z.string().optional(),
        dryRun: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        if (!input.dryRun && !isElDemoFollowupEnabled()) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "EL_DEMO_FOLLOWUP_ENABLED is not true; only dryRun is allowed." });
        }
        try {
          const result = await dispatchElDemoFollowupCall({
            toNumber: input.phone,
            leadName: input.name,
            leadEmail: input.email,
            leadId: 0,
            voiceSlot: input.voiceSlot,
            dryRun: input.dryRun,
          });
          return { success: true, callId: result.conversationId, dryRun: result.dryRun, request: result.request };
        } catch (err) {
          throw toTrpcError(err);
        }
      }),

    // Fire a test call using Twilio + Gemini Live
    fireTestCall: publicProcedure
      .input(z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        email: z.string().optional(),
        currentSoftware: z.string().optional(),
        techCount: z.string().optional(),
        voice: z.string().optional(), // kept for UI compatibility, Gemini uses its own voice
      }))
      .mutation(async ({ input, ctx }) => {
        // Use the published domain directly — production proxy strips forwarded headers
        const baseUrl = process.env.NODE_ENV === "development"
          ? `${ctx.req.headers["x-forwarded-proto"] || ctx.req.protocol}://${ctx.req.headers["x-forwarded-host"] || ctx.req.headers.host}`
          : "https://wrenchai-bokbst2i.manus.space";

        // Normalize phone to E.164
        const digits = input.phone.replace(/\D/g, "");
        let phone = input.phone;
        if (digits.length === 10) phone = `+1${digits}`;
        else if (digits.length === 11 && digits.startsWith("1")) phone = `+${digits}`;

        // Check Twilio trial account restrictions before dispatching
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
          try {
            const twilio = (await import("twilio")).default;
            const client = twilio(accountSid, authToken);
            const account = await client.api.v2010.accounts(accountSid).fetch();
            if (account.type === "Trial") {
              const callerIds = await client.outgoingCallerIds.list({ limit: 50 });
              const verifiedNumbers = callerIds.map((c: any) => c.phoneNumber);
              const isVerified = verifiedNumbers.some((n: string) => n.replace(/\D/g, "") === digits);
              if (!isVerified) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `Twilio trial accounts can only call verified numbers. ${phone} is not verified. Verify it at console.twilio.com/phone-numbers/verified, or upgrade your Twilio account to call any number.`,
                });
              }
            }
          } catch (err: any) {
            if (err.code === "PRECONDITION_FAILED") throw err;
            // Non-fatal: if account check fails, proceed with the call
            console.warn("[Twilio] Could not check trial restrictions:", err.message);
          }
        }

        const extraContext = input.currentSoftware
          ? `Lead currently uses ${input.currentSoftware}. Tech count: ${input.techCount || "unknown"}.`
          : undefined;

        // Create a call_logs row for test calls so transcript + status can be persisted
        const { createCallLog } = await import("./db");
        const callLog = await createCallLog({
          leadId: 0, // 0 = test call, not tied to a real lead
          blandCallId: `test_${Date.now()}`, // temporary placeholder
          status: "called",
        });

        const callSid = await dispatchTwilioCall({
          phone,
          leadName: input.name,
          leadEmail: input.email || "",
          leadId: 0,
          webhookBaseUrl: baseUrl,
          extraContext,
        });

        // Update the call log with the real Twilio SID
        const { updateCallLog } = await import("./db");
        await updateCallLog(callLog.id, { blandCallId: callSid });

        return { success: true, callId: callSid };
      }),
  }),

  // ─── Settings ──────────────────────────────────────────────────────────────

  settings: router({
    get: publicProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        const value = await getSetting(input.key);
        return { key: input.key, value };
      }),

    // Provision a Twilio phone number
    provisionPhone: publicProcedure
      .input(z.object({ areaCode: z.string().optional() }))
      .mutation(async ({ input }) => {
        const existing = await getSetting("twilio_phone_number");
        if (existing) return { phoneNumber: existing, alreadyProvisioned: true };

        const phoneNumber = await purchaseTwilioNumber(input.areaCode || "415");
        await setSetting("twilio_phone_number", phoneNumber);
        return { phoneNumber, alreadyProvisioned: false };
      }),

    getPhoneNumber: publicProcedure.query(async () => {
      const phoneNumber = await getSetting("twilio_phone_number");
      return { phoneNumber };
    }),

    // System on/off toggle
    getSystemEnabled: publicProcedure.query(async () => {
      const val = await getSetting("system_enabled");
      return { enabled: val !== "false" };
    }),

    setSystemEnabled: publicProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await setSetting("system_enabled", input.enabled ? "true" : "false");
        return { enabled: input.enabled };
      }),

    // Agent configuration (name, call delay)
    getAgentConfig: publicProcedure.query(async () => {
      const agentName = await getSetting("agent_name") || "Alex";
      const callDelay = await getSetting("call_delay_minutes") || "5";
      // Gemini voice options
      const geminiVoice = await getSetting("gemini_voice") || "Charon";
      return { agentName, callDelay: parseInt(callDelay), geminiVoice };
    }),

    setAgentConfig: publicProcedure
      .input(z.object({
        agentName: z.string().optional(),
        callDelay: z.number().optional(),
        geminiVoice: z.string().optional(),
        backgroundTrack: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        if (input.agentName) await setSetting("agent_name", input.agentName);
        if (input.callDelay !== undefined) await setSetting("call_delay_minutes", String(input.callDelay));
        if (input.geminiVoice) await setSetting("gemini_voice", input.geminiVoice);
        if (input.backgroundTrack) await setSetting("background_track", input.backgroundTrack);
        return { success: true };
      }),

    // Check Twilio account status (trial vs. full, verified numbers)
    getTwilioAccountStatus: publicProcedure.query(async () => {
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) return { isTrial: false, verifiedNumbers: [], error: "Twilio not configured" };

        const twilio = (await import("twilio")).default;
        const client = twilio(accountSid, authToken);

        // Fetch account info
        const account = await client.api.v2010.accounts(accountSid).fetch();
        const isTrial = account.type === "Trial";

        // Fetch verified outgoing caller IDs (for trial accounts)
        let verifiedNumbers: string[] = [];
        if (isTrial) {
          const callerIds = await client.outgoingCallerIds.list({ limit: 20 });
          verifiedNumbers = callerIds.map((c: any) => c.phoneNumber);
        }

        return { isTrial, verifiedNumbers, accountStatus: account.status };
      } catch (err: any) {
        return { isTrial: false, verifiedNumbers: [], error: err.message };
      }
    }),

    // Check TwiML URL health (verify the published endpoint is reachable)
    checkTwimlHealth: publicProcedure.query(async () => {
      const PUBLISHED_BASE = "https://wrenchai-bokbst2i.manus.space";
      try {
        const res = await fetch(`${PUBLISHED_BASE}/api/twiml/voice`, { method: "GET" });
        const text = await res.text();
        const isValid = text.includes("<Response>") && text.includes("<Stream");
        return { reachable: res.ok, valid: isValid, statusCode: res.status, url: `${PUBLISHED_BASE}/api/twiml/voice` };
      } catch (err: any) {
        return { reachable: false, valid: false, statusCode: 0, error: err.message, url: `${PUBLISHED_BASE}/api/twiml/voice` };
      }
    }),

    // List available Gemini Live voices
    listVoices: publicProcedure.query(async () => {
      return {
        voices: [
          { id: "Charon", name: "Charon", gender: "Male", description: "Deep, confident, authoritative — recommended", recommended: true },
          { id: "Aoede", name: "Aoede", gender: "Female", description: "Warm, natural, conversational" },
          { id: "Fenrir", name: "Fenrir", gender: "Male", description: "Calm, steady, trustworthy" },
          { id: "Kore", name: "Kore", gender: "Female", description: "Clear, articulate, professional" },
          { id: "Puck", name: "Puck", gender: "Male", description: "Energetic, friendly, upbeat" },
        ],
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

import { Router, Request, Response } from "express";
import { fetchLeadData } from "./facebook";
import { createLead, getLeadByFacebookId, updateLead, getCallLogByBlandId, createCallLog, updateCallLog, getSetting } from "./db";
import { scheduleCall } from "./callScheduler";
import { checkExistingBooking, getBookingLink, getAvailableSlots, formatSlotsForSpeech, createBooking } from "./calendly";
import { purchaseTwilioNumber, buildTwiML, buildVoicemailTwiML } from "./twilio";

export const webhookRouter = Router();

// ─── Facebook Webhook Verification (GET) ─────────────────────────────────────

webhookRouter.get("/facebook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN || "wrenchpilot_verify_2024";

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[Facebook] Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.warn("[Facebook] Webhook verification failed", { mode, token });
    res.sendStatus(403);
  }
});

// ─── Facebook Lead Ads Webhook (POST) ────────────────────────────────────────

webhookRouter.post("/facebook", async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry || []) {
      const pageId = entry.id;
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;

        const leadgenId = change.value?.leadgen_id;
        const formId = change.value?.form_id;
        if (!leadgenId) continue;

        const existing = await getLeadByFacebookId(leadgenId);
        if (existing) {
          console.log(`[Facebook] Lead ${leadgenId} already exists, skipping`);
          continue;
        }

        console.log(`[Facebook] New lead received: ${leadgenId}`);

        let leadData: { id?: string; formId?: string; pageId?: string; name?: string; phone?: string; email?: string };
        try {
          leadData = await fetchLeadData(leadgenId);
        } catch (err) {
          console.error("[Facebook] Failed to fetch lead data:", err);
          leadData = { id: leadgenId, formId, pageId };
        }

        await createLead({
          facebookLeadId: leadgenId,
          facebookFormId: formId || leadData.formId,
          facebookPageId: pageId,
          name: leadData.name,
          phone: leadData.phone,
          email: leadData.email,
          status: "pending",
        });

        const lead = await getLeadByFacebookId(leadgenId);
        if (!lead) continue;

        // Use the published domain directly — production proxy strips forwarded headers
        const baseUrl = process.env.NODE_ENV === "development"
          ? `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`
          : "https://wrenchai-bokbst2i.manus.space";

        scheduleCall(lead.id, baseUrl);
        console.log(`[Facebook] Lead #${lead.id} stored and call scheduled`);
      }
    }
  } catch (error) {
    console.error("[Facebook] Error processing webhook:", error);
  }
});

// ─── Twilio TwiML Voice Endpoint ──────────────────────────────────────────────
// Called by Twilio when the outbound call is answered.
// Returns TwiML that connects the call to our Gemini Live WebSocket stream.

// Helper to get the correct public stream URL
// IMPORTANT: Production server is behind Cloudflare which strips x-forwarded-host,
// so req.headers.host returns the internal Cloud Run URL, not the public domain.
const PUBLISHED_DOMAIN = "wrenchai-bokbst2i.manus.space";
function getStreamUrl(req: Request): string {
  if (process.env.NODE_ENV === "development") {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || PUBLISHED_DOMAIN;
    const wsProtocol = String(protocol) === "https" ? "wss" : "ws";
    return `${wsProtocol}://${host}/api/twiml/stream`;
  }
  return `wss://${PUBLISHED_DOMAIN}/api/twiml/stream`;
}

function buildWebhookTwiML(req: Request, res: Response) {
  const streamUrl = getStreamUrl(req);
  console.log(`[TwiML] Stream URL: ${streamUrl}`);
  const q = req.query as Record<string, string>;
  const twiml = buildTwiML(streamUrl, {
    leadId: q.leadId,
    leadName: q.leadName,
    leadEmail: q.leadEmail,
    leadPhone: q.leadPhone,
    agentName: q.agentName,
    extraContext: q.extraContext,
  });
  console.log(`[TwiML] Params: leadId=${q.leadId}, leadName=${q.leadName}, agentName=${q.agentName}`);
  res.set("Content-Type", "text/xml");
  res.send(twiml);
}

webhookRouter.post("/twiml/voice", buildWebhookTwiML);
webhookRouter.get("/twiml/voice", buildWebhookTwiML);

// ─── Twilio AMD (Answering Machine Detection) Callback ───────────────────────

webhookRouter.post("/twilio-amd", async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const { CallSid, AnsweredBy } = req.body;
    console.log(`[Twilio AMD] CallSid=${CallSid}, AnsweredBy=${AnsweredBy}`);

    if (AnsweredBy === "machine_start" || AnsweredBy === "machine_end_beep" || AnsweredBy === "machine_end_silence") {
      // It's a voicemail — find the session and get lead info
      const { activeSessions } = await import("./twilio") as any;
      // We'll handle this in the status callback
      console.log(`[Twilio AMD] Voicemail detected for ${CallSid}`);
    }
  } catch (err) {
    console.error("[Twilio AMD] Error:", err);
  }
});

// ─── Twilio Status Callback ───────────────────────────────────────────────────

webhookRouter.post("/twilio-status", async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
    console.log(`[Twilio Status] CallSid=${CallSid}, Status=${CallStatus}, Duration=${CallDuration}s, AnsweredBy=${AnsweredBy}`);

    // Map Twilio status to our status
    let status: "called" | "booked" | "no-answer" = "called";
    if (CallStatus === "no-answer" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "canceled") {
      status = "no-answer";
    } else if (AnsweredBy === "machine_start" || AnsweredBy === "machine_end_beep") {
      status = "no-answer"; // Treat voicemail as no-answer
    }

    // Find the call log by Twilio SID (stored in blandCallId column)
    const existingLog = await getCallLogByBlandId(CallSid);

    if (existingLog) {
      // Only update to no-answer if not already booked
      if (existingLog.status !== "booked") {
        await updateCallLog(existingLog.id, {
          status,
          durationSeconds: CallDuration ? parseInt(CallDuration) : undefined,
          outcome: CallStatus,
        });
      }
      // Update lead status
      if (existingLog.status !== "booked") {
        await updateLead(existingLog.leadId, { status });
      }
    } else if (CallStatus === "completed" || CallStatus === "no-answer" || CallStatus === "busy") {
      // Log may not exist yet if status callback fires before stream stop
      console.log(`[Twilio Status] No log found for ${CallSid}, will be created by stream handler`);
    }
  } catch (err) {
    console.error("[Twilio Status] Error:", err);
  }
});

// ─── Phone Number Provisioning ────────────────────────────────────────────────

webhookRouter.post("/provision-phone", async (req: Request, res: Response) => {
  try {
    const { areaCode } = req.body;
    const phoneNumber = await purchaseTwilioNumber(areaCode || "415");
    return res.json({ success: true, phoneNumber });
  } catch (error: any) {
    console.error("[Provision] Error purchasing phone number:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to purchase phone number" });
  }
});

// ─── In-Call Tool Endpoints (used by Gemini Live via server-side execution) ───
// Note: These are kept for compatibility but Gemini tools now execute server-side
// directly in gemini.ts via the executeTool function.

webhookRouter.post("/check-booking", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ has_booking: false });
    const result = await checkExistingBooking(email);
    return res.json({ has_booking: result?.hasBooking || false, start_time: result?.startTime || null });
  } catch (error) {
    return res.json({ has_booking: false });
  }
});

webhookRouter.get("/available-slots", async (_req: Request, res: Response) => {
  try {
    const slots = await getAvailableSlots(8);
    const slotsSpeech = formatSlotsForSpeech(slots);
    return res.json({
      has_slots: slots.length > 0,
      slots_speech: slots.length > 0 ? slotsSpeech : "No available slots found.",
      slots: slots.map(s => ({ start_time: s.start_time })),
    });
  } catch (error) {
    return res.json({ has_slots: false, slots_speech: "Unable to fetch slots.", slots: [] });
  }
});

webhookRouter.post("/book-demo", async (req: Request, res: Response) => {
  try {
    const { name, email, start_time, phone } = req.body;
    if (!name || !email || !start_time) {
      return res.json({ success: false, error: "Missing required fields" });
    }
    const result = await createBooking({ name, email, startTime: start_time, phone });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

webhookRouter.get("/calendly-link", (_req: Request, res: Response) => {
  return res.json({ booking_link: getBookingLink() });
});

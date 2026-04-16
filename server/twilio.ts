/**
 * Twilio Service Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles:
 *  - Outbound call dispatch via Twilio REST API
 *  - Phone number provisioning
 *  - TwiML response generation (connects call to Gemini Live WebSocket stream)
 *  - Media stream WebSocket bridge (Twilio ↔ Gemini Live)
 *  - Post-call status callback handling
 */

import twilio from "twilio";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { GeminiLiveSession } from "./gemini";
import { getSetting, updateLead, updateCallLog, getCallLogByBlandId, createCallLog } from "./db";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// ─── Active Sessions Store ────────────────────────────────────────────────────

interface CallSession {
  callSid: string;
  leadId: number;
  leadName: string;
  leadEmail: string;
  leadPhone?: string;  // Lead's phone number for post-booking SMS
  agentName: string;
  extraContext?: string;
  geminiSession?: GeminiLiveSession;
  transcript: Array<{ role: "user" | "model"; text: string }>;
  startedAt: Date;
}

const activeSessions = new Map<string, CallSession>();

export function getActiveSessions() {
  return Array.from(activeSessions.values()).map(s => ({
    callSid: s.callSid,
    leadId: s.leadId,
    leadName: s.leadName,
    startedAt: s.startedAt,
    transcriptLength: s.transcript.length,
  }));
}

// ─── Outbound Call Dispatch ───────────────────────────────────────────────────

export interface DispatchCallOptions {
  phone: string;
  leadName: string;
  leadEmail: string;
  leadPhone?: string;  // Lead's phone for SMS confirmation (usually same as phone)
  leadId: number;
  webhookBaseUrl: string;
  fromNumber?: string;
  extraContext?: string;
}

export async function dispatchTwilioCall(options: DispatchCallOptions): Promise<string> {
  const client = getTwilioClient();

  // Get the provisioned Twilio number from settings
  const fromNumber = options.fromNumber || await getSetting("twilio_phone_number");
  if (!fromNumber) {
    throw new Error("No Twilio phone number provisioned. Go to Settings → Phone to provision one.");
  }

  const agentName = await getSetting("agent_name") || "Alex";

  // Always use the published domain for TwiML URLs so Twilio can reach them
  // Fall back to webhookBaseUrl if it looks like a real public URL
  const PUBLISHED_DOMAIN = "https://wrenchai-bokbst2i.manus.space";
  const isPublicUrl = options.webhookBaseUrl &&
    !options.webhookBaseUrl.includes("localhost") &&
    !options.webhookBaseUrl.includes("127.0.0") &&
    !options.webhookBaseUrl.includes("3000-");
  const publicBase = isPublicUrl ? options.webhookBaseUrl : PUBLISHED_DOMAIN;

  // The TwiML URL that Twilio will call when the call connects
  const leadPhone = options.leadPhone || options.phone;
  const twimlUrl = `${publicBase}/api/twiml/voice?leadId=${options.leadId}&leadName=${encodeURIComponent(options.leadName)}&leadEmail=${encodeURIComponent(options.leadEmail)}&leadPhone=${encodeURIComponent(leadPhone)}&agentName=${encodeURIComponent(agentName)}${options.extraContext ? `&extraContext=${encodeURIComponent(options.extraContext)}` : ""}`;

  // Status callback URL for call completion
  const statusCallbackUrl = `${publicBase}/api/webhooks/twilio-status`;

  console.log(`[Twilio] TwiML URL: ${twimlUrl}`);

  console.log(`[Twilio] Dispatching call to ${options.phone} from ${fromNumber}`);

  const call = await client.calls.create({
    to: options.phone,
    from: fromNumber,
    url: twimlUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    asyncAmdStatusCallback: `${publicBase}/api/webhooks/twilio-amd`,
    asyncAmdStatusCallbackMethod: "POST",
  });

  console.log(`[Twilio] Call dispatched: SID=${call.sid}`);

  // Store session metadata
  activeSessions.set(call.sid, {
    callSid: call.sid,
    leadId: options.leadId,
    leadName: options.leadName,
    leadEmail: options.leadEmail,
    leadPhone: options.leadPhone || options.phone,
    agentName,
    extraContext: options.extraContext,
    transcript: [],
    startedAt: new Date(),
  });

  return call.sid;
}

// ─── TwiML Voice Response ─────────────────────────────────────────────────────

export interface TwiMLParams {
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;  // Lead's phone number for post-booking SMS
  agentName?: string;
  extraContext?: string;
}

/**
 * Generates TwiML that connects the answered call to our Gemini Live WebSocket.
 * Embeds lead parameters so the media stream handler can create the Gemini session
 * without relying on the in-memory activeSessions map (avoids race conditions).
 */
export function buildTwiML(streamUrl: string, params?: TwiMLParams): string {
  const paramLines = params ? [
    params.leadId ? `      <Parameter name="leadId" value="${params.leadId}"/>` : "",
    params.leadName ? `      <Parameter name="leadName" value="${encodeXml(params.leadName)}"/>` : "",
    params.leadEmail ? `      <Parameter name="leadEmail" value="${encodeXml(params.leadEmail)}"/>` : "",
    params.agentName ? `      <Parameter name="agentName" value="${encodeXml(params.agentName)}"/>` : "",
    params.extraContext ? `      <Parameter name="extraContext" value="${encodeXml(params.extraContext)}"/>` : "",
    params.leadPhone ? `      <Parameter name="leadPhone" value="${encodeXml(params.leadPhone)}"/>` : "",
  ].filter(Boolean).join("\n") : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
${paramLines}
    </Stream>
  </Connect>
</Response>`;
}

function encodeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * TwiML for answering machine — leaves a voicemail message.
 */
export function buildVoicemailTwiML(leadName: string, agentName: string): string {
  const message = `Hi ${leadName}, this is ${agentName} calling from WrenchPilot. I'm reaching out about your interest in our AI-powered shop management platform. We help heavy-duty truck shops eliminate 90 percent of their admin work and give owners real-time profit visibility — all for $299.99 a month. I'd love to show you a quick demo. Please visit calendly.com/service-wrenchpilot/30min to book a free 30-minute demo at your convenience. Have a great day!`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">${message}</Say>
  <Hangup/>
</Response>`;
}

// ─── Media Stream WebSocket Handler ──────────────────────────────────────────

/**
 * Attaches a WebSocket server to the HTTP server for Twilio Media Streams.
 * Twilio sends μ-law 8kHz audio chunks; we forward them to Gemini Live
 * and stream Gemini's audio responses back to Twilio.
 */
export function attachMediaStreamHandler(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/api/twiml/stream" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log("[Twilio Stream] New media stream connection");

    let callSid: string | null = null;
    let geminiSession: GeminiLiveSession | null = null;
    let streamSid: string | null = null;

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.event) {
          case "connected":
            console.log("[Twilio Stream] Connected");
            break;

          case "start": {
            callSid = msg.start?.callSid;
            streamSid = msg.start?.streamSid;
            console.log(`[Twilio Stream] Stream started: callSid=${callSid}, streamSid=${streamSid}`);

            // Get lead info from activeSessions map, OR fall back to TwiML custom parameters
            // (TwiML embeds lead info as <Parameter> tags which Twilio sends in customParameters)
            const session = callSid ? activeSessions.get(callSid) : null;
            const customParams = msg.start?.customParameters || {};

            const leadName = session?.leadName || customParams.leadName || "there";
            const leadEmail = session?.leadEmail || customParams.leadEmail || "";
            const leadPhone = session?.leadPhone || customParams.leadPhone || undefined;
            const agentName = session?.agentName || customParams.agentName || "Alex";
            const extraContext = session?.extraContext || customParams.extraContext || undefined;

            console.log(`[Twilio Stream] Lead: ${leadName} (${leadEmail}), Agent: ${agentName}`);

            const transcript: Array<{ role: "user" | "model"; text: string }> = [];

            // Initialize Gemini Live session
            geminiSession = new GeminiLiveSession({
              leadName,
              leadEmail,
              leadPhone,
              agentName,
              extraContext,

              onAudioChunk: (audioBase64: string) => {
                // Send Gemini's audio back to Twilio
                if (ws.readyState === WebSocket.OPEN && streamSid) {
                  ws.send(JSON.stringify({
                    event: "media",
                    streamSid,
                    media: {
                      payload: audioBase64,
                    },
                  }));
                }
              },

              onTranscript: (role: "user" | "model", text: string) => {
                transcript.push({ role, text });
                if (session) session.transcript.push({ role, text });
              },

              onCallEnded: () => {
                console.log(`[Twilio Stream] Gemini session ended for callSid=${callSid}`);
              },

              onInterrupted: () => {
                // User started speaking — send Twilio a "clear" message to stop buffered AI audio
                // This prevents the AI voice from overlapping with the user's speech
                if (ws.readyState === WebSocket.OPEN && streamSid) {
                  ws.send(JSON.stringify({
                    event: "clear",
                    streamSid,
                  }));
                  console.log(`[Twilio Stream] Sent clear to stop AI audio (barge-in)`);
                }
              },
            });

            if (session) session.geminiSession = geminiSession;

            try {
              await geminiSession.connect();
              console.log(`[Twilio Stream] Gemini Live connected for callSid=${callSid}`);

              // Trigger the opening greeting
              geminiSession.sendText("The call has just connected. Please start the conversation with your greeting now.");
            } catch (err) {
              console.error("[Twilio Stream] Failed to connect Gemini:", err);
            }
            break;
          }

          case "media": {
            // Forward audio from Twilio to Gemini
            if (geminiSession && msg.media?.payload) {
              geminiSession.sendAudio(msg.media.payload);
            }
            break;
          }

          case "stop": {
            console.log(`[Twilio Stream] Stream stopped: callSid=${callSid}`);
            if (geminiSession) {
              geminiSession.close();
            }
            if (callSid) {
              const session = activeSessions.get(callSid);
              if (session) {
                // Save transcript to database
                await saveCallTranscript(callSid, session);
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error("[Twilio Stream] Message error:", err);
      }
    });

    ws.on("close", () => {
      console.log(`[Twilio Stream] WebSocket closed: callSid=${callSid}`);
      if (geminiSession) geminiSession.close();
    });

    ws.on("error", (err) => {
      console.error("[Twilio Stream] WebSocket error:", err);
    });
  });

  console.log("[Twilio] Media stream WebSocket handler attached at /api/twiml/stream");
}

// ─── Save Transcript ──────────────────────────────────────────────────────────

async function saveCallTranscript(callSid: string, session: CallSession) {
  try {
    const transcriptText = session.transcript
      .map(t => `${t.role === "model" ? "Agent" : "Lead"}: ${t.text}`)
      .join("\n");

    const existingLog = await getCallLogByBlandId(callSid);
    if (existingLog) {
      await updateCallLog(existingLog.id, {
        transcript: transcriptText,
      });
    }

    activeSessions.delete(callSid);
  } catch (err) {
    console.error("[Twilio] Failed to save transcript:", err);
  }
}

// ─── Phone Number Provisioning ────────────────────────────────────────────────

export async function purchaseTwilioNumber(areaCode: string = "415"): Promise<string> {
  const client = getTwilioClient();

  // Search for available numbers
  const available = await client.availablePhoneNumbers("US")
    .local.list({ areaCode: parseInt(areaCode), limit: 5, voiceEnabled: true });

  if (available.length === 0) {
    // Try without area code restriction
    const anyAvailable = await client.availablePhoneNumbers("US")
      .local.list({ limit: 5, voiceEnabled: true });
    if (anyAvailable.length === 0) {
      throw new Error("No available phone numbers found");
    }
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: anyAvailable[0].phoneNumber,
    });
    return purchased.phoneNumber;
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
  });

  console.log(`[Twilio] Purchased phone number: ${purchased.phoneNumber}`);
  return purchased.phoneNumber;
}

// ─── Get Call Details ─────────────────────────────────────────────────────────

export async function getTwilioCallDetails(callSid: string) {
  const client = getTwilioClient();
  try {
    const call = await client.calls(callSid).fetch();
    return {
      sid: call.sid,
      status: call.status,
      duration: call.duration,
      from: call.from,
      to: call.to,
      startTime: call.startTime,
      endTime: call.endTime,
      answeredBy: (call as any).answeredBy,
    };
  } catch (err) {
    console.error(`[Twilio] Failed to fetch call ${callSid}:`, err);
    return null;
  }
}

// ─── List Recent Calls ────────────────────────────────────────────────────────

export async function listTwilioCalls(limit: number = 20) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return [];
  }
  const client = getTwilioClient();
  try {
    const calls = await client.calls.list({ limit });
    return calls.map(c => ({
      sid: c.sid,
      to: c.to,
      from: c.from,
      status: String(c.status),
      duration: c.duration,
      startTime: c.startTime?.toISOString() ?? null,
      endTime: c.endTime?.toISOString() ?? null,
      direction: c.direction,
    }));
  } catch (err) {
    console.error("[Twilio] Failed to list calls:", err);
    return [];
  }
}

/** Outbound SMS and other Twilio messages (newest first). */
export async function listTwilioMessages(limit: number = 100) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return [];
  }
  const client = getTwilioClient();
  try {
    const messages = await client.messages.list({ limit });
    return messages.map(m => ({
      sid: m.sid,
      to: m.to,
      from: m.from,
      body: m.body ?? "",
      dateSent: m.dateSent?.toISOString() ?? null,
      direction: m.direction ?? "",
      status: m.status ?? "",
    }));
  } catch (err) {
    console.error("[Twilio] Failed to list messages:", err);
    return [];
  }
}

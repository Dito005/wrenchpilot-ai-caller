import axios from "axios";

const BLAND_BASE = "https://api.bland.ai/v1";
const CALENDLY_BOOKING_URL = "https://calendly.com/service-wrenchpilot/30min";

function getBlandHeaders() {
  const key = process.env.BLAND_AI_API_KEY;
  if (!key) throw new Error("BLAND_AI_API_KEY is not set");
  return { authorization: key, "Content-Type": "application/json" };
}

/**
 * Purchase a new inbound/outbound phone number from Bland.ai.
 * Returns the purchased phone number in E.164 format.
 */
export async function purchasePhoneNumber(areaCode = "415"): Promise<string> {
  const res = await axios.post(
    `${BLAND_BASE}/inbound/purchase`,
    { area_code: areaCode },
    { headers: getBlandHeaders() }
  );
  return res.data.phone_number as string;
}

/**
 * Build the AI task prompt for the outbound sales call.
 * Greets the lead by name, introduces WrenchPilot, pitches the product,
 * and books a real Calendly demo using the available_slots and book_demo tools.
 */
function buildCallTask(leadName: string, extraContext?: string): string {
  const firstName = leadName?.split(" ")[0] || "there";

  const contextBlock = extraContext
    ? `\n## Lead Context\n${extraContext}\n`
    : "";

  return `You are Alex, a professional sales representative calling on behalf of WrenchPilot — an AI-powered heavy-duty truck shop management platform. You are warm, confident, and conversational. You never sound robotic or scripted.
${contextBlock}
## Step 1 — Confirm Identity
Start with: "Hi, is this ${firstName}?"

Wait for their response. If they confirm, continue immediately:
"Hey ${firstName}! This is Alex calling from WrenchPilot. I'm reaching out because you recently showed interest in our shop management software — I just wanted to take 30 seconds to introduce myself and see if booking a quick demo would make sense for you."

If they say no or wrong number, apologize and end the call politely.

## Step 2 — Pitch WrenchPilot (weave these naturally into conversation)
- WrenchPilot is an AI-powered platform built specifically for heavy-duty truck repair shops
- It eliminates 90% of admin work — no more manual job cards, chasing invoices, or spreadsheets
- Shop owners get real-time profit visibility: see exactly how much each job is making as it happens
- Handles work orders, estimates, invoicing, parts tracking, and customer communication all in one place
- Pro plan is $299.99 per month — no contracts, cancel any time
- Most shops see ROI within the first 30 days

## Step 3 — Handle Objections
- "What does it cost?" → "Our Pro plan is $299.99 a month, and most shops make that back in the first week just from the time they save on admin."
- "How does it work?" → "It's a cloud-based platform — your techs log jobs on any device, the AI handles the paperwork, and you see your profit in real time. We'd show you the whole thing in the demo."
- "We already use [other software like Fullbay, Mitchell, etc.]" → "Totally understand — a lot of our customers switched from systems like that. The big difference is WrenchPilot was built from the ground up for heavy-duty shops, so it actually fits how you work. The demo would show you the difference in about 10 minutes."
- "I'm not interested" → "No problem at all — can I ask what's your biggest challenge running the shop right now? Even if WrenchPilot isn't a fit, I'd love to understand."
- "I'm busy" → "I completely get it — that's exactly why I'm calling. The demo is only 30 minutes and I can work around your schedule. What does your week look like?"
- "Send me info by email" → "Absolutely, I'll send that over. But I'd also love to show you live — it's way more impactful than any email. Can we grab 30 minutes this week?"

## Step 4 — Book the Demo (CRITICAL — follow this exactly)
When the lead is interested in booking:

1. First, call the **get_available_slots** tool to fetch real available time slots.
   Say: "Let me pull up our available times for you."

2. Read the available slots aloud naturally:
   "I've got a few options — [read the slots]. Which of those works best for you?"

3. Once they pick a time, ask for their email:
   "Perfect! And what's the best email to send the calendar invite to?"

4. Call the **book_demo** tool with their name, email, the selected start_time (in ISO format), and their phone number.
   Say while booking: "Give me just one second, I'm booking that in for you right now."

5. After the tool returns success, confirm verbally:
   "You're all set, ${firstName}! I've booked your WrenchPilot demo for [date and time]. You'll get a Google Calendar invite and a confirmation email at [their email] in the next few minutes. Is there anything else you'd like to know before the demo?"

6. If the tool returns an error or no slots are available, fall back to the booking link:
   "I'm having a small technical issue on my end — let me send you our booking link directly: it's calendly.com/service-wrenchpilot/30min. You can grab any time that works for you there."

## Step 5 — Close the Call
- If booked: "Awesome, ${firstName}! We'll see you at the demo — you're going to love what WrenchPilot can do for your shop. Have a great day!"
- If not interested: "No worries at all, ${firstName}. I'll shoot you a quick email with some info just in case. Have a great day!"
- If voicemail: "Hey ${firstName}, this is Alex from WrenchPilot — I was reaching out about our shop management software. Give us a call back or check us out at wrenchpilot.io. Have a great day!"

## Rules
- Keep the conversation natural and conversational — never read from a script word for word
- Never be pushy or aggressive
- Always confirm the lead's name before pitching
- If they ask to be removed from the list, say "Absolutely, I'll remove you right away. Sorry for the interruption!" and end the call
- Maximum call length: 10 minutes
- Always use the book_demo tool to create a real booking — do not just share the link unless the tool fails`;
}

/**
 * Dispatch an outbound call via Bland.ai.
 * Returns the Bland.ai call_id.
 */
export async function dispatchCall(params: {
  phone: string;
  leadName: string;
  leadEmail: string;
  leadId: number;
  fromNumber?: string;
  webhookUrl: string;
  extraContext?: string;
  voice?: string;
  model?: string;
  firstSentence?: string;
  backgroundTrack?: string;
}): Promise<string> {
  // Derive the base URL for tool endpoints
  const baseUrl = params.webhookUrl.replace("/api/webhooks/bland", "");

  const payload = {
    phone_number: params.phone,
    task: buildCallTask(params.leadName, params.extraContext),
    voice: params.voice || "june",
    model: "base", // base supports Custom Tools (required for Calendly booking); turbo does not
    language: "en-US",
    max_duration: 10,
    wait_for_greeting: true,
    record: true,
    amd: true, // answering machine detection
    reduce_latency: false, // false = higher quality, more natural-sounding voice
    interruption_threshold: 150, // ms — allows natural pauses without cutting off
    temperature: 0.6,
    background_track: params.backgroundTrack || "office", // ambient office sounds for realism
    noise_cancellation: false, // keep false so background track plays naturally
    first_sentence: params.firstSentence || undefined,
    from: params.fromNumber || undefined,
    webhook: params.webhookUrl,
    metadata: {
      lead_id: params.leadId,
      lead_email: params.leadEmail,
      lead_name: params.leadName,
    },
    tools: [
      // ── Tool 1: Check if lead already has a booking ──────────────────────
      {
        name: "check_existing_booking",
        description: "Check if the lead already has a Calendly demo booked using their email address",
        input_schema: {
          type: "object",
          properties: {
            email: {
              type: "string",
              description: "The lead's email address",
            },
          },
          required: ["email"],
        },
        speech: "Let me check if you already have a demo scheduled...",
        url: `${baseUrl}/api/tools/check-booking`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { email: "{{email}}" },
        response_data: [
          {
            name: "has_booking",
            data: "$.has_booking",
            context: "Whether the lead already has a Calendly booking (true/false)",
          },
          {
            name: "booking_start_time",
            data: "$.start_time",
            context: "The start time of the existing booking if one exists",
          },
        ],
      },
      // ── Tool 2: Get available demo slots ─────────────────────────────────
      {
        name: "get_available_slots",
        description: "Get the next available time slots for the WrenchPilot demo so you can offer them to the lead",
        input_schema: {
          type: "object",
          properties: {},
          required: [],
        },
        speech: "Let me pull up our available times for you...",
        url: `${baseUrl}/api/tools/available-slots`,
        method: "GET",
        headers: { "Content-Type": "application/json" },
        response_data: [
          {
            name: "slots_speech",
            data: "$.slots_speech",
            context: "A human-readable list of available time slots to read aloud to the lead",
          },
          {
            name: "slots",
            data: "$.slots",
            context: "Array of available slots with start_time in ISO format",
          },
          {
            name: "has_slots",
            data: "$.has_slots",
            context: "Whether any slots are available (true/false)",
          },
        ],
      },
      // ── Tool 3: Book the demo (creates real Calendly invitee) ─────────────
      {
        name: "book_demo",
        description: "Book a WrenchPilot demo on Calendly for the lead. Call this after the lead has agreed to a specific time slot.",
        input_schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The lead's full name",
            },
            email: {
              type: "string",
              description: "The lead's email address for the calendar invite",
            },
            start_time: {
              type: "string",
              description: "The selected time slot in ISO 8601 format (e.g. 2025-04-15T14:00:00Z)",
            },
            phone: {
              type: "string",
              description: "The lead's phone number (optional)",
            },
          },
          required: ["name", "email", "start_time"],
        },
        speech: "Give me just one second, I'm booking that in for you right now...",
        url: `${baseUrl}/api/tools/book-demo`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          name: "{{name}}",
          email: "{{email}}",
          start_time: "{{start_time}}",
          phone: "{{phone}}",
        },
        response_data: [
          {
            name: "success",
            data: "$.success",
            context: "Whether the booking was created successfully (true/false)",
          },
          {
            name: "confirmation_message",
            data: "$.confirmation_message",
            context: "A confirmation message to read to the lead including the booked date and time",
          },
          {
            name: "cancel_url",
            data: "$.cancel_url",
            context: "URL the lead can use to cancel the booking if needed",
          },
          {
            name: "error",
            data: "$.error",
            context: "Error message if the booking failed",
          },
        ],
      },
    ],
  };

  const res = await axios.post(`${BLAND_BASE}/calls`, payload, {
    headers: getBlandHeaders(),
  });

  return res.data.call_id as string;
}

/**
 * Fetch call details from Bland.ai by call_id.
 */
export async function getCallDetails(callId: string) {
  const res = await axios.get(`${BLAND_BASE}/calls/${callId}`, {
    headers: getBlandHeaders(),
  });
  return res.data;
}

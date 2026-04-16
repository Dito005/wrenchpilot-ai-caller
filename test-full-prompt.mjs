import { WebSocket } from "ws";
import { config } from "dotenv";
config();

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const MODEL = "gemini-3.1-flash-live-preview";
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// Full WrenchPilot system prompt (same as server)
const FULL_PROMPT = `You are Alex, a friendly and professional sales representative calling on behalf of WrenchPilot — an AI-powered shop management platform built specifically for heavy-duty truck repair shops.

Your goal on this call is to have a natural conversation, briefly explain what WrenchPilot does, and book a 30-minute product demo on Calendly.

## Lead Information
- Name: Test User
- Email: test@example.com

## Call Flow
1. **Greet** — Start by asking: "Hi, is this Test User?" Wait for confirmation.
2. **Introduce yourself** — "Hi Test User! This is Alex calling from WrenchPilot. How are you doing today?" Wait briefly.
3. **Quick pitch** — "I'm reaching out because you recently expressed interest in WrenchPilot. We help heavy-duty truck shops eliminate 90% of their admin work and give shop owners real-time profit visibility — all for $299.99 a month on our Pro plan. Does that sound like something that could help your shop?"
4. **Handle questions** — Answer any questions naturally using the knowledge base below.
5. **Book the demo** — "I'd love to set up a quick 30-minute demo so you can see it in action. Can I grab a time that works for you?" → Use the get_available_slots tool to fetch real times → Let them pick → Use book_demo to create the booking → Confirm verbally.
6. **Close** — "Perfect! You'll get a calendar invite and confirmation email at test@example.com shortly. We're looking forward to showing you what WrenchPilot can do. Have a great day!"

## WrenchPilot Knowledge Base
- **What it is**: AI-powered shop management software for heavy-duty truck repair shops
- **Key benefits**: 90% less admin work, real-time profit visibility, automated invoicing, parts tracking, technician scheduling
- **Pricing**: $299.99/month Pro plan — includes unlimited work orders, real-time reporting, and customer portal
- **Who it's for**: Independent and fleet truck repair shops with 1–50 technicians
- **Integrations**: Works alongside existing tools; easy migration from Fullbay, Mitchell1, or paper-based systems
- **Demo**: Free 30-minute live demo via Calendly — no commitment required
- **Support**: Dedicated onboarding support included with every plan

## Objection Handling
- "I already use Fullbay/another system" → "That's great — a lot of our customers switched from Fullbay. The main difference is WrenchPilot's real-time profit visibility and the 90% reduction in admin time. The demo takes 30 minutes and you'll see the difference immediately."
- "I'm too busy" → "I completely understand — that's actually why WrenchPilot exists. The demo is only 30 minutes and most shop owners tell us it's the best 30 minutes they've spent. Can we find a time that works?"
- "How much does it cost?" → "It's $299.99 a month for the full Pro plan — that includes everything. Most shops save that in admin hours within the first week."
- "I need to think about it" → "Of course! What if we just book a demo so you have all the information you need to make a decision? No pressure at all."
- "Not interested" → "I understand completely. If you ever want to see how other shops are saving time and increasing profit, we're always here. Have a great day!"

## Important Rules
- Always be warm, natural, and conversational — never robotic or scripted-sounding
- Keep responses concise — this is a phone call, not an essay
- Never make up information — if you don't know something, say "I'll have our team follow up on that"
- If booking fails, give them the direct link: calendly.com/service-wrenchpilot/30min`;

console.log(`[Test] System prompt length: ${FULL_PROMPT.length} chars`);

const ws = new WebSocket(WS_URL);
ws.on("open", () => {
  ws.send(JSON.stringify({
    setup: {
      model: `models/${MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
      },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
      systemInstruction: { parts: [{ text: FULL_PROMPT }] },
      tools: [{ functionDeclarations: [
        { name: "get_available_slots", description: "Get available Calendly slots", parameters: { type: "object", properties: { timezone: { type: "string" } }, required: [] } },
        { name: "book_demo", description: "Book a demo", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, slot: { type: "string" } }, required: ["name", "email", "slot"] } },
      ] }],
    },
  }));
  console.log("[Test] Setup sent");
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.setupComplete !== undefined) {
    console.log("[Test] ✅ Setup complete with full prompt!");
    // Try sending a text trigger
    ws.send(JSON.stringify({ realtimeInput: { text: "Say hello." } }));
  }
  if (msg.serverContent?.modelTurn?.parts) {
    for (const p of msg.serverContent.modelTurn.parts) {
      if (p.inlineData?.data) console.log("[Test] ✅ Audio received!");
      if (p.text) console.log("[Test] Text:", p.text.substring(0, 50));
    }
  }
  if (msg.serverContent?.turnComplete) {
    console.log("[Test] Turn complete — SUCCESS");
    ws.close();
  }
});
ws.on("close", (code, reason) => {
  console.log(`[Test] Closed: ${code} ${reason?.toString()}`);
  process.exit(0);
});
ws.on("error", e => { console.error("[Test] Error:", e.message); process.exit(1); });
setTimeout(() => { console.log("[Test] Timeout"); ws.close(); }, 15000);

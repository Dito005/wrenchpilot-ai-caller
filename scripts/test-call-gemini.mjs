/**
 * Test script: fire a Twilio + Gemini Live call to Adeel
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

// Use the Twilio REST API directly since we can't import TS from mjs
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}

const PUBLISHED_BASE = "https://wrenchai-bokbst2i.manus.space";
const fromNumber = "+17039978510"; // Existing Twilio number

const leadName = "Adeel";
const leadEmail = "adeel@test.com";
const agentName = "Alex";
const extraContext = "Uses Fullbay, 1-5 technicians";
const leadId = "999";

const twimlUrl = `${PUBLISHED_BASE}/api/twiml/voice?leadId=${leadId}&leadName=${encodeURIComponent(leadName)}&leadEmail=${encodeURIComponent(leadEmail)}&agentName=${encodeURIComponent(agentName)}&extraContext=${encodeURIComponent(extraContext)}`;
const statusCallbackUrl = `${PUBLISHED_BASE}/api/webhooks/twilio-status`;

console.log("Firing test call...");
console.log("TwiML URL:", twimlUrl);
console.log("From:", fromNumber);
console.log("To: +16478095407");

const response = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      To: "+16478095407",
      From: fromNumber,
      Url: twimlUrl,
      StatusCallback: statusCallbackUrl,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST",
    }).toString(),
  }
);

const data = await response.json();
if (data.sid) {
  console.log("✅ Call dispatched successfully!");
  console.log("Call SID:", data.sid);
  console.log("Status:", data.status);
} else {
  console.error("❌ Call failed:", JSON.stringify(data, null, 2));
}

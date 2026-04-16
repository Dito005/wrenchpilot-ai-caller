/**
 * SMS Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends post-call booking confirmation SMS via Twilio.
 * Uses the same provisioned Twilio number that makes outbound calls.
 */

import twilio from "twilio";
import { getSetting } from "./db";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

function getTwilioClient() {
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export interface SendConfirmationSmsOptions {
  toPhone: string;       // Lead's phone number (E.164 format)
  leadName: string;
  bookedDateTime: string; // Human-readable, e.g. "Wednesday, April 16 at 2:00 PM"
  calendlyLink?: string;
}

/**
 * Send a booking confirmation SMS to the lead.
 * Returns true on success, false on failure (non-throwing).
 */
export async function sendBookingConfirmationSms(opts: SendConfirmationSmsOptions): Promise<boolean> {
  try {
    const fromNumber = await getSetting("twilio_phone_number");
    if (!fromNumber) {
      console.warn("[SMS] No provisioned Twilio number found — cannot send SMS");
      return false;
    }

    const body = buildConfirmationMessage(opts);

    const client = getTwilioClient();
    const message = await client.messages.create({
      to: opts.toPhone,
      from: fromNumber,
      body,
    });

    console.log(`[SMS] Confirmation sent to ${opts.toPhone}: SID=${message.sid}`);
    return true;
  } catch (err: any) {
    console.error("[SMS] Failed to send confirmation:", err.message);
    return false;
  }
}

function buildConfirmationMessage(opts: SendConfirmationSmsOptions): string {
  const name = opts.leadName.split(" ")[0]; // first name only
  const link = opts.calendlyLink || "https://calendly.com/service-wrenchpilot/30min";

  return (
    `Hi ${name}, your WrenchPilot demo is confirmed for ${opts.bookedDateTime}. ` +
    `You should receive a calendar invite at your email shortly.\n\n` +
    `Need to reschedule? Use this link: ${link}\n\n` +
    `Looking forward to speaking with you! — WrenchPilot Team`
  );
}

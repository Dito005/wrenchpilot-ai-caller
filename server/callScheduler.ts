import { checkExistingBooking } from "./calendly";
import { dispatchTwilioCall } from "./twilio";
import { getLeadById, updateLead, createCallLog, getSetting } from "./db";

/**
 * Schedule an outbound call for a lead after a configurable delay.
 * Reads the delay from settings (call_delay_minutes), defaults to 5 minutes.
 * Before calling, checks if the lead already has a Calendly booking.
 */
export async function scheduleCall(leadId: number, webhookBaseUrl: string): Promise<void> {
  const delayMinStr = await getSetting("call_delay_minutes").catch(() => null);
  const delayMin = delayMinStr ? parseInt(delayMinStr) : 5;
  const delayMs = (isNaN(delayMin) || delayMin < 1 ? 5 : delayMin) * 60 * 1000;

  const scheduledAt = new Date(Date.now() + delayMs);
  console.log(`[Scheduler] Call for lead #${leadId} scheduled at ${scheduledAt.toISOString()} (${delayMin} min delay)`);

  updateLead(leadId, { callScheduledAt: scheduledAt }).catch((err) =>
    console.error("[Scheduler] Failed to update callScheduledAt:", err)
  );

  setTimeout(async () => {
    await executeCall(leadId, webhookBaseUrl);
  }, delayMs);
}

/**
 * Execute the outbound call for a lead using Twilio + Gemini Live.
 * Skips if the lead already has a Calendly booking or the system is paused.
 */
export async function executeCall(leadId: number, webhookBaseUrl: string): Promise<void> {
  try {
    const lead = await getLeadById(leadId);
    if (!lead) {
      console.error(`[Scheduler] Lead #${leadId} not found`);
      return;
    }

    if (lead.status === "called" || lead.status === "booked") {
      console.log(`[Scheduler] Lead #${leadId} already has status "${lead.status}", skipping call`);
      return;
    }

    if (!lead.phone) {
      console.warn(`[Scheduler] Lead #${leadId} has no phone number, skipping call`);
      await updateLead(leadId, { status: "no-answer" });
      return;
    }

    // Check for existing Calendly booking
    if (lead.email) {
      const booking = await checkExistingBooking(lead.email);
      if (booking?.hasBooking) {
        console.log(`[Scheduler] Lead #${leadId} already has a Calendly booking, skipping call`);
        await updateLead(leadId, {
          status: "booked",
          hadExistingBooking: 1,
          calendlyEventId: booking.eventUri,
          calendlyBookingUrl: booking.bookingUrl,
        });
        return;
      }
    }

    // Check if the system is paused
    const systemEnabled = await getSetting("system_enabled");
    if (systemEnabled === "false") {
      console.log(`[Scheduler] System is paused — skipping call for lead #${leadId}`);
      return;
    }

    // Dispatch via Twilio + Gemini Live
    const callSid = await dispatchTwilioCall({
      phone: lead.phone,
      leadName: lead.name || "there",
      leadEmail: lead.email || "",
      leadPhone: lead.phone,  // Pass phone so AI can send SMS confirmation after booking
      leadId: lead.id,
      webhookBaseUrl,
    });

    console.log(`[Scheduler] Call dispatched for lead #${leadId}, Twilio SID: ${callSid}`);

    // Update lead status — reuse blandCallId column for Twilio SID (same purpose)
    await updateLead(leadId, {
      status: "called",
      blandCallId: callSid,
      calledAt: new Date(),
    });

    await createCallLog({
      leadId: lead.id,
      blandCallId: callSid,
      status: "called",
    });
  } catch (error) {
    console.error(`[Scheduler] Error executing call for lead #${leadId}:`, error);
  }
}

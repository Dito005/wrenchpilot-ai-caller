import { TRPCError } from "@trpc/server";
import { createCallLog } from "../db";
import { dialDemoFollowup, ElevenLabsError, PlaceCallNotApprovedError, PreflightError, type DemoFollowupDialInput } from "./client";
import { ProdGuardError } from "./guards";
import { VoiceSlotError } from "./voiceSlots";

export { isElDemoFollowupEnabled, isPlaceCallApproved, preflightDemoFollowup } from "./client";
export { LAYER_A } from "./layerA";
export { DEMO_FOLLOWUP } from "./demoFollowup";
export { VOICE_SLOTS, resolveVoiceSlot } from "./voiceSlots";

/**
 * Dial demo_followup and record it in call_logs (conversation_id goes in the
 * legacy blandCallId column, same as Twilio SIDs). Returns the conversation id.
 */
export async function dispatchElDemoFollowupCall(
  input: DemoFollowupDialInput & { leadId: number }
): Promise<{ conversationId: string; dryRun: boolean; request: unknown }> {
  const result = await dialDemoFollowup(input);
  if (result.dryRun) return { conversationId: "", dryRun: true, request: result.request };

  const conversationId = result.conversationId ?? `el_${result.sipCallId ?? Date.now()}`;
  // The call is already live — a logging failure must not surface as a failed dial.
  await createCallLog({ leadId: input.leadId, blandCallId: conversationId, status: "called" }).catch(err =>
    console.error("[ElevenLabs] Failed to write call log:", err)
  );
  console.log(`[ElevenLabs] demo_followup call placed: conversation=${conversationId} sip=${result.sipCallId ?? "n/a"}`);
  return { conversationId, dryRun: false, request: result.request };
}

/** Map EL-path errors onto tRPC codes so the dialer UI shows a useful message. */
export function toTrpcError(err: unknown): unknown {
  if (err instanceof VoiceSlotError) return new TRPCError({ code: "BAD_REQUEST", message: err.message });
  if (err instanceof ProdGuardError) return new TRPCError({ code: "FORBIDDEN", message: err.message });
  if (err instanceof PlaceCallNotApprovedError) return new TRPCError({ code: "FORBIDDEN", message: err.message });
  if (err instanceof PreflightError) return new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  if (err instanceof ElevenLabsError) return new TRPCError({ code: "BAD_GATEWAY", message: err.message });
  return err;
}

/**
 * READ-ONLY preflight for the EL demo_followup path. Never dials.
 *
 *   ELEVENLABS_API_KEY=... npx tsx scripts/el-preflight.ts [voiceSlot]
 *
 * GETs the TEST phone + TEST agent and diffs them against Layer A and the
 * demo_followup profile. Exit code 0 = safe to dial, 1 = problems found.
 */
import { preflightDemoFollowup } from "../server/elevenlabs/client";
import { resolveVoiceSlot } from "../server/elevenlabs/voiceSlots";
import { DEMO_FOLLOWUP } from "../server/elevenlabs/demoFollowup";

const voice = resolveVoiceSlot(process.argv[2]);
console.log(`demo_followup preflight — agent ${DEMO_FOLLOWUP.agentId}, phone ${DEMO_FOLLOWUP.phoneNumberId}, voice ${voice.slot} (${voice.name})`);

const result = await preflightDemoFollowup(voice);
for (const p of result.problems) console.log(`  ✗ ${p}`);
for (const u of result.unverified) console.log(`  ? not reported by API: ${u}`);
console.log(result.ok ? "OK — TEST phone is on TEST agent and matches Layer A." : "BLOCKED — fix the agent in ElevenLabs before dialing.");
process.exit(result.ok ? 0 : 1);

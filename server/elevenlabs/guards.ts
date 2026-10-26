/**
 * Production Amy — NEVER touched from this repo.
 * Any request that names one of these identifiers is refused before it leaves
 * the process, regardless of env vars or feature flags.
 */

export const PROD_AMY = Object.freeze({
  agentId: "agent_8401m4ppna9dens85pfp17f4h78d",
  phoneNumber: "+12296320387",
  phoneNumberId: "phnum_5501m4pprynve1298ja32t04a3ma",
} as const);

export class ProdGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProdGuardError";
  }
}

/** Digits only, with a leading US country code dropped so 10/11-digit forms compare equal. */
function digits(value: string): string {
  const d = value.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** Throws if any of the given identifiers belongs to production Amy. */
export function assertNotProd(ids: {
  agentId?: string | null;
  phoneNumberId?: string | null;
  phoneNumber?: string | null;
  toNumber?: string | null;
}): void {
  if (ids.agentId && ids.agentId.trim() === PROD_AMY.agentId) {
    throw new ProdGuardError(`Refusing: ${PROD_AMY.agentId} is the PROD Amy agent.`);
  }
  if (ids.phoneNumberId && ids.phoneNumberId.trim() === PROD_AMY.phoneNumberId) {
    throw new ProdGuardError(`Refusing: ${PROD_AMY.phoneNumberId} is the PROD Amy phone number.`);
  }
  const prodDigits = digits(PROD_AMY.phoneNumber);
  for (const number of [ids.phoneNumber, ids.toNumber]) {
    if (number && digits(number) === prodDigits) {
      throw new ProdGuardError(`Refusing: ${PROD_AMY.phoneNumber} is the PROD Amy line.`);
    }
  }
}

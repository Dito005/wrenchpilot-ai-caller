import axios from "axios";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

function getPageAccessToken(): string {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN is not set");
  return token;
}

export interface FacebookLeadData {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  formId?: string;
  pageId?: string;
}

/**
 * Fetch lead field data from the Facebook Graph API.
 * Maps common field names (full_name, phone_number, email) to our schema.
 */
export async function fetchLeadData(leadgenId: string): Promise<FacebookLeadData> {
  const token = getPageAccessToken();

  const res = await axios.get(`${GRAPH_BASE}/${leadgenId}`, {
    params: {
      access_token: token,
      fields: "field_data,form_id,ad_id,created_time",
    },
  });

  const data = res.data;
  const fieldData: Array<{ name: string; values: string[] }> = data.field_data || [];

  const getValue = (fieldName: string): string | undefined => {
    const field = fieldData.find(
      (f) =>
        f.name.toLowerCase().includes(fieldName.toLowerCase()) ||
        f.name.toLowerCase().replace(/_/g, "").includes(fieldName.toLowerCase().replace(/_/g, ""))
    );
    return field?.values?.[0];
  };

  // Try multiple common field name patterns
  const name =
    getValue("full_name") ||
    getValue("fullname") ||
    getValue("name") ||
    [getValue("first_name"), getValue("last_name")].filter(Boolean).join(" ") ||
    undefined;

  const phone =
    getValue("phone_number") ||
    getValue("phonenumber") ||
    getValue("phone") ||
    getValue("mobile") ||
    undefined;

  const email =
    getValue("email") ||
    getValue("email_address") ||
    undefined;

  return {
    id: leadgenId,
    name: name?.trim() || undefined,
    phone: normalizePhone(phone),
    email: email?.trim().toLowerCase() || undefined,
    formId: data.form_id,
  };
}

/**
 * Normalize phone number to E.164 format.
 * Assumes US number if no country code present.
 */
function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  // Strip all non-digit characters
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return phone; // Return as-is if we can't normalize
}

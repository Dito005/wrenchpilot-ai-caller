import axios from "axios";

const CALENDLY_BASE = "https://api.calendly.com";
const CALENDLY_BOOKING_URL = "https://calendly.com/service-wrenchpilot/30min";

// The WrenchPilot Demo event type URI (fetched from Calendly API)
const DEMO_EVENT_TYPE_URI = "https://api.calendly.com/event_types/d8aad7dc-ebdd-4aff-859a-57382d6b3913";

function getCalendlyHeaders() {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) throw new Error("CALENDLY_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Get the authenticated Calendly user URI.
 * Cached after first call.
 */
let _userUri: string | null = null;
export async function getCalendlyUserUri(): Promise<string> {
  if (_userUri) return _userUri;

  const envUri = process.env.CALENDLY_USER_URI;
  if (envUri) {
    _userUri = envUri;
    return _userUri;
  }

  const res = await axios.get(`${CALENDLY_BASE}/users/me`, {
    headers: getCalendlyHeaders(),
  });
  _userUri = res.data.resource.uri as string;
  return _userUri;
}

/**
 * Check if a given email already has a scheduled Calendly event.
 * Returns the event URI and booking URL if found, null otherwise.
 */
export async function checkExistingBooking(email: string): Promise<{
  hasBooking: boolean;
  eventUri?: string;
  bookingUrl?: string;
  startTime?: string;
} | null> {
  try {
    const userUri = await getCalendlyUserUri();

    const res = await axios.get(`${CALENDLY_BASE}/scheduled_events`, {
      headers: getCalendlyHeaders(),
      params: {
        user: userUri,
        status: "active",
        count: 100,
      },
    });

    const events = res.data.collection as Array<{
      uri: string;
      status: string;
      start_time: string;
      event_type: string;
      invitees_counter: { total: number };
    }>;

    for (const event of events) {
      const eventUuid = event.uri.split("/").pop();
      const inviteesRes = await axios.get(
        `${CALENDLY_BASE}/scheduled_events/${eventUuid}/invitees`,
        {
          headers: getCalendlyHeaders(),
          params: { email },
        }
      );

      const invitees = inviteesRes.data.collection as Array<{
        email: string;
        cancel_url: string;
        reschedule_url: string;
      }>;

      if (invitees.length > 0) {
        return {
          hasBooking: true,
          eventUri: event.uri,
          startTime: event.start_time,
          bookingUrl: invitees[0]?.reschedule_url || CALENDLY_BOOKING_URL,
        };
      }
    }

    return { hasBooking: false };
  } catch (error: unknown) {
    console.error("[Calendly] Error checking booking:", error);
    return { hasBooking: false };
  }
}

/**
 * Get available time slots for the WrenchPilot Demo event type.
 * Returns the next N available slots within the next 14 days.
 */
export async function getAvailableSlots(count = 8): Promise<Array<{
  start_time: string;
  status: string;
}>> {
  try {
    // Calendly API: date range must be <= 7 days, start_time must be at least 1hr in the future
    const startFrom = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const sevenDaysOut = new Date(startFrom.getTime() + 7 * 24 * 60 * 60 * 1000);

    const res = await axios.get(`${CALENDLY_BASE}/event_type_available_times`, {
      headers: getCalendlyHeaders(),
      params: {
        event_type: DEMO_EVENT_TYPE_URI,
        start_time: startFrom.toISOString(),
        end_time: sevenDaysOut.toISOString(),
      },
    });

    const slots = res.data.collection as Array<{ start_time: string; status: string }>;
    return slots.slice(0, count);
  } catch (error) {
    console.error("[Calendly] Error fetching available slots:", error);
    return [];
  }
}

/**
 * Format available slots into a human-readable list for the AI to read aloud.
 * e.g. "Tuesday April 15th at 2 PM, Wednesday April 16th at 10 AM"
 */
export function formatSlotsForSpeech(slots: Array<{ start_time: string }>): string {
  if (!slots.length) return "no available slots";

  return slots.slice(0, 5).map((slot, i) => {
    const d = new Date(slot.start_time);
    const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return `option ${i + 1}: ${day} at ${time}`;
  }).join(", ");
}

/**
 * Create a real Calendly booking (invitee) for the WrenchPilot Demo.
 * Returns the booking confirmation details.
 */
export async function createBooking(params: {
  name: string;
  email: string;
  startTime: string; // ISO 8601 UTC
  phone?: string;
  timezone?: string;
  notes?: string; // Call summary for the demo team
}): Promise<{
  success: boolean;
  bookingUri?: string;
  cancelUrl?: string;
  rescheduleUrl?: string;
  startTime?: string;
  error?: string;
}> {
  try {
    const nameParts = params.name.trim().split(" ");
    const firstName = nameParts[0] || params.name;
    const lastName = nameParts.slice(1).join(" ") || "";

    const body: Record<string, unknown> = {
      event_type: DEMO_EVENT_TYPE_URI,
      start_time: params.startTime,
      invitee: {
        name: params.name,
        first_name: firstName,
        last_name: lastName,
        email: params.email,
        timezone: params.timezone || "America/Toronto",
      },
      location: {
        kind: "google_conference",
      },
    };

    // Add phone and notes as question answers if provided
    const qna: Array<{ question: string; answer: string; position: number }> = [];
    if (params.phone) {
      qna.push({ question: "Phone Number", answer: params.phone, position: 0 });
    }
    if (params.notes) {
      qna.push({ question: "Notes", answer: params.notes, position: 1 });
    }
    if (qna.length > 0) {
      body.questions_and_answers = qna;
    }

    const res = await axios.post(`${CALENDLY_BASE}/invitees`, body, {
      headers: getCalendlyHeaders(),
    });

    const invitee = res.data.resource;
    return {
      success: true,
      bookingUri: invitee.uri,
      cancelUrl: invitee.cancel_url,
      rescheduleUrl: invitee.reschedule_url,
      startTime: invitee.scheduled_event?.start_time || params.startTime,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const axiosError = error as { response?: { data?: unknown } };
    const detail = axiosError?.response?.data
      ? JSON.stringify(axiosError.response.data)
      : msg;
    console.error("[Calendly] Error creating booking:", detail);
    return { success: false, error: detail };
  }
}

/**
 * Returns the WrenchPilot demo booking URL.
 */
export function getBookingLink(): string {
  return CALENDLY_BOOKING_URL;
}

/**
 * Returns the event type URI for the WrenchPilot Demo.
 */
export function getDemoEventTypeUri(): string {
  return DEMO_EVENT_TYPE_URI;
}

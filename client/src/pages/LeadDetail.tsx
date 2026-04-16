import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Phone, Calendar, Clock, PhoneCall, UserX, ExternalLink, Mic } from "lucide-react";
import { toast } from "sonner";

type LeadStatus = "pending" | "called" | "booked" | "no-answer";

const STATUS_COLORS: Record<LeadStatus, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  called: "bg-blue-50 text-blue-700 border-blue-200",
  booked: "bg-green-50 text-green-700 border-green-200",
  "no-answer": "bg-red-50 text-red-700 border-red-200",
};

function parseTranscript(raw: string | null): Array<{ role: string; text: string }> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: { role?: string; user?: string; text?: string; content?: string }) => ({
        role: item.role || item.user || "unknown",
        text: item.text || item.content || "",
      }));
    }
    return null;
  } catch {
    // Plain text transcript
    return [{ role: "transcript", text: raw }];
  }
}

export default function LeadDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const leadId = parseInt(params.id || "0");

  const { data, isLoading, refetch } = trpc.leads.get.useQuery({ id: leadId });

  const triggerCall = trpc.leads.triggerCall.useMutation({
    onSuccess: () => {
      toast.success("Call triggered successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading lead details...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Lead not found.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>Back to Dashboard</Button>
      </div>
    );
  }

  const { lead, callLogs } = data;
  const statusColor = STATUS_COLORS[lead.status as LeadStatus] || STATUS_COLORS.pending;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back + Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-bold">{lead.name || "Unknown Lead"}</h1>
            <p className="text-sm text-muted-foreground">Lead #{lead.id} · Received {new Date(lead.createdAt).toLocaleString()}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${statusColor}`}>
          {lead.status}
        </span>
      </div>

      {/* Lead Info */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="shadow-none border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm">{lead.phone || "No phone number"}</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              <span className="text-sm">{lead.email || "No email"}</span>
            </div>
            {lead.facebookLeadId && (
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                <span className="text-xs text-muted-foreground font-mono">{lead.facebookLeadId}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Call Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.callScheduledAt && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Scheduled: {new Date(lead.callScheduledAt).toLocaleString()}</span>
              </div>
            )}
            {lead.calledAt && (
              <div className="flex items-center gap-2 text-sm">
                <PhoneCall className="h-4 w-4 text-blue-500" />
                <span>Called at: {new Date(lead.calledAt).toLocaleString()}</span>
              </div>
            )}
            {lead.blandCallId && (
              <div className="flex items-center gap-2 text-sm">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{lead.blandCallId}</span>
              </div>
            )}
            {lead.hadExistingBooking === 1 && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Calendar className="h-4 w-4" />
                <span>Had existing booking — call skipped</span>
              </div>
            )}
            {lead.calendlyBookingUrl && (
              <a
                href={lead.calendlyBookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-green-700 hover:underline"
              >
                <Calendar className="h-4 w-4" />
                View Calendly Booking
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {(lead.status === "pending" || lead.status === "no-answer") && lead.phone && (
              <Button
                size="sm"
                className="gap-2 mt-2"
                disabled={triggerCall.isPending}
                onClick={() => triggerCall.mutate({ leadId: lead.id, baseUrl: window.location.origin })}
              >
                <Phone className="h-4 w-4" />
                {triggerCall.isPending ? "Calling..." : "Call Now"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Call Logs */}
      {callLogs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold">Call History</h2>
          {callLogs.map(log => {
            const transcript = parseTranscript(log.transcript);
            return (
              <Card key={log.id} className="shadow-none border">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">
                      Call on {new Date(log.createdAt).toLocaleString()}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {log.durationSeconds && (
                        <span className="text-xs text-muted-foreground">{log.durationSeconds}s</span>
                      )}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[log.status as LeadStatus] || STATUS_COLORS.pending}`}>
                        {log.status}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {log.recordingUrl && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Recording</p>
                      <audio controls src={log.recordingUrl} className="w-full h-8" />
                    </div>
                  )}
                  {log.calendlyBookingUrl && (
                    <a
                      href={log.calendlyBookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-green-700 hover:underline"
                    >
                      <Calendar className="h-4 w-4" />
                      Demo booked during this call
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {transcript && transcript.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Transcript</p>
                      <div className="bg-muted/40 rounded-lg p-3 space-y-2 max-h-80 overflow-y-auto text-sm">
                        {transcript.map((line, i) => (
                          <div key={i} className={`flex gap-2 ${line.role === "assistant" || line.role === "agent" ? "justify-start" : "justify-end"}`}>
                            <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-sm ${
                              line.role === "assistant" || line.role === "agent"
                                ? "bg-background border text-foreground"
                                : "bg-primary text-primary-foreground"
                            }`}>
                              <span className="text-xs opacity-60 block mb-0.5 capitalize">{line.role}</span>
                              {line.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, Clock, User,
  Mic, RefreshCw, Play, ChevronDown, ChevronUp, ExternalLink,
  Activity, Volume2, CheckCircle2, Radio, Loader2, Power, Zap
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallRecord = {
  sid?: string;
  id?: string;
  c_id?: string;
  to: string;
  from: string;
  status: string;
  duration?: string | null;
  call_length?: number;
  answered_by?: string;
  created_at?: string;
  startTime?: string | null;
  endTime?: string | null;
  ended_at?: string;
  direction?: string;
  metadata?: Record<string, unknown>;
};

type TranscriptLine = {
  user: string;
  text?: string;
  content?: string;
  message?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status, answeredBy }: { status: string; answeredBy?: string }) {
  if (status === "completed" && answeredBy === "voicemail") {
    return <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 gap-1 text-xs"><PhoneMissed className="h-3 w-3" />Voicemail</Badge>;
  }
  switch (status?.toLowerCase()) {
    case "completed":
      return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />Completed</Badge>;
    case "in-progress":
    case "in_progress":
      return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 gap-1 text-xs animate-pulse"><Radio className="h-3 w-3" />Live</Badge>;
    case "initiated":
      return <Badge variant="outline" className="text-sky-600 border-sky-300 bg-sky-50 gap-1 text-xs animate-pulse"><Loader2 className="h-3 w-3 animate-spin" />Calling…</Badge>;
    case "queued":
      return <Badge variant="outline" className="text-yellow-600 border-yellow-300 bg-yellow-50 gap-1 text-xs"><Clock className="h-3 w-3" />Queued</Badge>;
    case "failed":
    case "no-answer":
      return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 gap-1 text-xs"><PhoneMissed className="h-3 w-3" />No Answer</Badge>;
    default:
      return <Badge variant="outline" className="text-gray-500 border-gray-300 text-xs">{status || "Unknown"}</Badge>;
  }
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function getCallId(call: CallRecord): string {
  return (call.sid || call.id || call.c_id || "") as string;
}

// ── Transcript Viewer ─────────────────────────────────────────────────────────

function TranscriptViewer({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const { data: callData, isLoading, refetch } = trpc.callerBot.getLiveCall.useQuery(
    { callId },
    { enabled: open, refetchInterval: open ? 5000 : false }
  );
  const data = callData?.data ? {
    status: (callData.data as any).status,
    answeredBy: (callData.data as any).answeredBy,
    duration: (callData.data as any).duration,
    recordingUrl: null,
    transcripts: [],
    summary: "",
  } : null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <Mic className="h-3 w-3" />
        {open ? "Hide Transcript" : "View Transcript"}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 border rounded-lg overflow-hidden">
          {data && (
            <div className="flex items-center gap-4 px-3 py-2 bg-muted border-b text-xs text-muted-foreground">
              <span>Status: <strong>{data.status}</strong></span>
              {data.answeredBy && <span>Answered by: <strong>{data.answeredBy}</strong></span>}
              {data.duration && <span>Duration: <strong>{formatDuration(data.duration)}</strong></span>}
              {data.recordingUrl && (
                <a href={data.recordingUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline ml-auto">
                  <Play className="h-3 w-3" /> Listen
                </a>
              )}
              <button onClick={() => refetch()} className="hover:text-foreground">
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-3 space-y-2 bg-white">
            {isLoading && <div className="text-sm text-muted-foreground text-center py-4">Loading transcript...</div>}
            {data && data.transcripts.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">
                {data.status === "queued" || data.status === "in_progress"
                  ? "Call in progress — transcript will appear here..."
                  : "No transcript available"}
              </div>
            )}
            {data && data.transcripts.map((line: TranscriptLine, i: number) => {
              const isAgent = line.user === "assistant" || line.user === "agent";
              const text = line.text || line.content || line.message || "";
              return (
                <div key={i} className={`flex gap-2 ${isAgent ? "" : "flex-row-reverse"}`}>
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${isAgent ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                    {isAgent ? "A" : "L"}
                  </div>
                  <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm
                    ${isAgent ? "bg-blue-600 text-white rounded-tl-none" : "bg-gray-100 text-gray-800 rounded-tr-none"}`}>
                    {text}
                  </div>
                </div>
              );
            })}
            {data?.summary && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                <p className="font-medium text-yellow-800 mb-1">AI Summary</p>
                <p className="text-yellow-700">{data.summary}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CallerBot() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testSoftware, setTestSoftware] = useState("");
  const [testTechs, setTestTechs] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [lastCallId, setLastCallId] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.callerBot.listRecentCalls.useQuery(
    { limit: 30 },
    { refetchInterval: autoRefresh ? 8000 : false }
  );
  const { data: systemData, refetch: refetchSystem } = trpc.settings.getSystemEnabled.useQuery();
  const { data: agentConfig } = trpc.settings.getAgentConfig.useQuery();
  const { data: voicesData } = trpc.settings.listVoices.useQuery();

  useEffect(() => {
    if (agentConfig && !selectedVoice) setSelectedVoice(agentConfig.geminiVoice || "Aoede");
  }, [agentConfig]);

  const setEnabled = trpc.settings.setSystemEnabled.useMutation({
    onSuccess: (d) => {
      toast.success(d.enabled ? "System enabled — calls will fire automatically" : "System paused — no new calls will be made");
      refetchSystem();
    },
    onError: (e) => toast.error("Failed: " + e.message),
  });

  const fireTestCall = trpc.callerBot.fireTestCall.useMutation({
    onSuccess: (res) => {
      toast.success(`Call dispatched! ID: ${res.callId}`);
      setLastCallId(res.callId);
      setTimeout(() => refetch(), 3000);
    },
    onError: (e) => {
      // Show a specific, actionable message for Twilio trial account restrictions
      if (e.message?.includes("trial") || e.message?.includes("verified")) {
        toast.error(e.message, { duration: 10000, description: "Go to Settings → Phone to see your verified numbers or upgrade your Twilio account." });
      } else {
        toast.error("Failed to fire call: " + e.message);
      }
    },
  });

  const calls: CallRecord[] = data?.calls || [];
  const liveCalls = calls.filter(c => c.status === "in_progress" || c.status === "in-progress" || c.status === "initiated");
  const completedCalls = calls.filter(c => c.status === "completed");
  const noAnswerCalls = calls.filter(c => c.status === "failed" || c.status === "no-answer");
  const isEnabled = systemData?.enabled !== false;
  const voices = voicesData?.voices || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            Caller Bot
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Monitor live calls, fire test calls, and configure the AI voice agent.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* System Toggle */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium
            ${isEnabled ? "border-green-300 bg-green-50 text-green-700" : "border-orange-300 bg-orange-50 text-orange-700"}`}>
            <Power className="h-3.5 w-3.5" />
            <span>{isEnabled ? "System ON" : "System PAUSED"}</span>
            <button
              onClick={() => setEnabled.mutate({ enabled: !isEnabled })}
              disabled={setEnabled.isPending}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ml-1
                ${isEnabled ? "bg-green-500" : "bg-gray-300"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                ${isEnabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </button>
          </div>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            className="gap-1.5"
          >
            <Zap className={`h-3.5 w-3.5 ${autoRefresh ? "animate-pulse" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Calls", value: calls.length, color: "text-gray-800", bg: "" },
          { label: "Live Now", value: liveCalls.length, color: liveCalls.length > 0 ? "text-blue-600" : "text-gray-800", bg: liveCalls.length > 0 ? "bg-blue-50 border-blue-200" : "" },
          { label: "Completed", value: completedCalls.length, color: "text-green-600", bg: completedCalls.length > 0 ? "bg-green-50 border-green-200" : "" },
          { label: "No Answer", value: noAnswerCalls.length, color: "text-red-500", bg: "" },
        ].map((s) => (
          <Card key={s.label} className={`shadow-none border ${s.bg}`}>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="monitor">
        <TabsList className="grid grid-cols-2 w-64">
          <TabsTrigger value="monitor" className="gap-1.5">
            <Radio className="h-3.5 w-3.5" />Monitor
          </TabsTrigger>
          <TabsTrigger value="test" className="gap-1.5">
            <PhoneCall className="h-3.5 w-3.5" />Test Call
          </TabsTrigger>
        </TabsList>

        {/* ── Monitor Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="monitor" className="mt-4 space-y-4">
          {/* Live Calls */}
          {liveCalls.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse inline-block" />
                Live Calls
              </h2>
              <div className="space-y-2">
                {liveCalls.map(call => {
                  const cid = getCallId(call);
                  return (
                    <Card key={cid} className="border-blue-200 bg-blue-50/30 shadow-none">
                      <CardContent className="pt-3 pb-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                              <Phone className="h-4 w-4 text-blue-600 animate-pulse" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{(call.metadata as any)?.lead_name || call.to}</p>
                              <p className="text-xs text-muted-foreground font-mono">{call.to}</p>
                            </div>
                          </div>
                          <StatusBadge status={call.status} answeredBy={call.answered_by} />
                        </div>
                        <TranscriptViewer callId={cid} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* All Calls */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recent Calls (Last 30)
            </h2>
            <Card className="shadow-none border">
              <CardContent className="p-0">
                {isLoading && (
                  <div className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading calls...
                  </div>
                )}
                {!isLoading && calls.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <PhoneOff className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No calls yet. Use the Test Call tab to get started.</p>
                  </div>
                )}
                {calls.map((call, i) => {
                  const cid = getCallId(call);
                  return (
                    <div key={cid || i}
                      className={`px-4 py-3 hover:bg-muted/40 transition-colors ${i !== calls.length - 1 ? "border-b" : ""}`}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {call.status === "completed" ? <PhoneCall className="h-4 w-4 text-green-500" />
                            : call.status === "in_progress" || call.status === "in-progress" ? <Phone className="h-4 w-4 text-blue-500 animate-pulse" />
                            : call.status === "failed" || call.status === "no-answer" ? <PhoneMissed className="h-4 w-4 text-red-500" />
                            : <Clock className="h-4 w-4 text-yellow-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{(call.metadata as any)?.lead_name || call.to}</span>
                            <span className="text-xs text-muted-foreground font-mono">{call.to}</span>
                            {(call.metadata as any)?.test_call && (
                              <Badge variant="outline" className="text-xs text-purple-600 border-purple-300 bg-purple-50">Test</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span>{formatTime(call.created_at)}</span>
                            {call.call_length && <span>{formatDuration(call.call_length)}</span>}
                            {call.answered_by && <span>· {call.answered_by}</span>}
                          </div>
                          {cid && <TranscriptViewer callId={cid} />}
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <StatusBadge status={call.status} answeredBy={call.answered_by} />
                          {cid && (
                            <a href={`https://console.twilio.com/us1/monitor/calls/${cid}`} target="_blank" rel="noopener noreferrer"
                              className="p-1 rounded hover:bg-muted transition-colors" title="View in Twilio Console">
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Test Call Tab ────────────────────────────────────────────────── */}
        <TabsContent value="test" className="mt-4">
          <div className="grid grid-cols-5 gap-5">
            {/* Left: Form */}
            <div className="col-span-3 space-y-4">
              <Card className="shadow-none border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-blue-600" />
                    Fire a Test Call
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="tName">
                        <User className="h-3.5 w-3.5 inline mr-1" />Lead Name *
                      </Label>
                      <Input id="tName" value={testName} onChange={e => setTestName(e.target.value)} placeholder="e.g. Adeel" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tPhone">
                        <Phone className="h-3.5 w-3.5 inline mr-1" />Phone Number *
                      </Label>
                      <Input id="tPhone" value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+1 647 809 5407" />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="tEmail">Email (optional)</Label>
                    <Input id="tEmail" type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="lead@shop.com" />
                    <p className="text-xs text-muted-foreground">Used to check if lead already has a Calendly booking before calling</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="tSoftware">Current Software</Label>
                      <Input id="tSoftware" value={testSoftware} onChange={e => setTestSoftware(e.target.value)} placeholder="Fullbay, Mitchell 1…" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="tTechs">Tech Count</Label>
                      <Input id="tTechs" value={testTechs} onChange={e => setTestTechs(e.target.value)} placeholder="1-5, 6-10, 10+" />
                    </div>
                  </div>

                  <Button
                    className="w-full gap-2"
                    onClick={() => fireTestCall.mutate({
                      phone: testPhone,
                      name: testName,
                      email: testEmail || undefined,
                      currentSoftware: testSoftware || undefined,
                      techCount: testTechs || undefined,
                      voice: selectedVoice || undefined,
                    })}
                    disabled={fireTestCall.isPending || !testPhone || !testName}
                  >
                    {fireTestCall.isPending
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Calling…</>
                      : <><PhoneCall className="h-4 w-4" />Fire Test Call</>}
                  </Button>

                  {lastCallId && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs font-semibold text-green-800 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />Call initiated
                      </p>
                      <p className="text-xs text-green-700 font-mono mt-0.5">ID: {lastCallId}</p>
                      <p className="text-xs text-green-600 mt-1">Switch to the Monitor tab to see the live transcript.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Voice Selector + Agent Profile */}
            <div className="col-span-2 space-y-4">
              <Card className="shadow-none border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-purple-600" />
                    Voice for This Call
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {voices.map((v) => {
                    const active = selectedVoice === v.id || (!selectedVoice && v.id === (agentConfig?.geminiVoice || "Aoede"));
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVoice(v.id)}
                        className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all
                          ${active ? "border-purple-400 bg-purple-50 ring-1 ring-purple-300" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                          ${v.gender === "Female" ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700"}`}>
                          {v.name[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm">{v.name}</span>
                            {(v as any).recommended && (
                              <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 px-1 py-0 leading-4">Best</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{v.description}</p>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 text-purple-600 shrink-0" />}
                      </button>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    To change the default voice for all calls, go to Settings.
                  </p>
                </CardContent>
              </Card>

              {/* Agent Profile Preview */}
              <Card className="shadow-none border bg-gray-50/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />Agent Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: "Name", value: agentConfig?.agentName || "Alex" },
                    { label: "Default Voice", value: agentConfig?.geminiVoice || "Aoede" },
                    { label: "Call Delay", value: `${agentConfig?.callDelay || 5} min after lead` },
                    { label: "Model", value: "Gemini 2.0 Flash Live" },
                    { label: "Calendly", value: "30min demo booking" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-medium capitalize">{value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

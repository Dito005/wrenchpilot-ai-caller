import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Settings2, Phone, Volume2, User, Webhook, CheckCircle2,
  Copy, ExternalLink, Power, Loader2, AlertCircle, Info,
  ChevronRight, Facebook, Calendar, Zap
} from "lucide-react";

// ── Copy Button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} className="gap-1.5 shrink-0">
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : (label || "Copy")}
    </Button>
  );
}

function CodeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-xs font-mono text-gray-800 truncate border">
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Settings() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookCallbackUrl = `${origin}/api/webhooks/facebook`;
  const twilioStatusUrl = `${origin}/api/webhooks/twilio-status`;
  const verifyToken = "wrenchpilot_verify_2024";

  // Agent config local state
  const [agentName, setAgentName] = useState("Alex");
  const [callDelay, setCallDelay] = useState(5);
  const [selectedVoice, setSelectedVoice] = useState("Charon");
  const [selectedBgTrack, setSelectedBgTrack] = useState("office");
  const [areaCode, setAreaCode] = useState("415");

  const bgTracks = [
    { id: "office", label: "Office", description: "Faint typing, chatter, keyboard clicks — sounds like a real office call", icon: "🏢", recommended: true },
    { id: "cafe",   label: "Café",   description: "Soft background talking and clinking — relaxed and conversational", icon: "☕" },
    { id: "restaurant", label: "Restaurant", description: "Subtle ambient dining sounds — more refined and quiet", icon: "🍽️" },
    { id: "none",   label: "None",   description: "No background audio — clean but can sound robotic", icon: "🔇" },
  ];

  // Queries
  const { data: systemData, refetch: refetchSystem } = trpc.settings.getSystemEnabled.useQuery();
  const { data: agentConfig } = trpc.settings.getAgentConfig.useQuery();
  const { data: voicesData } = trpc.settings.listVoices.useQuery();
  const { data: phoneData, refetch: refetchPhone } = trpc.settings.getPhoneNumber.useQuery();
  const { data: twilioStatus, isLoading: twilioStatusLoading } = trpc.settings.getTwilioAccountStatus.useQuery();
  const { data: twimlHealth, isLoading: twimlHealthLoading, refetch: refetchTwimlHealth } = trpc.settings.checkTwimlHealth.useQuery();

  useEffect(() => {
    if (agentConfig) {
      setAgentName(agentConfig.agentName);
      setCallDelay(agentConfig.callDelay);
      setSelectedVoice(agentConfig.geminiVoice || "Charon");
      setSelectedBgTrack((agentConfig as any).backgroundTrack || "office");
    }
  }, [agentConfig]);

  const isEnabled = systemData?.enabled !== false;
  const voices = voicesData?.voices || [];

  const setEnabled = trpc.settings.setSystemEnabled.useMutation({
    onSuccess: (d) => {
      toast.success(d.enabled ? "System enabled — calls will fire automatically" : "System paused — no new calls will be made");
      refetchSystem();
    },
    onError: (e) => toast.error("Failed: " + e.message),
  });

  const saveAgentConfig = trpc.settings.setAgentConfig.useMutation({
    onSuccess: () => toast.success("Agent configuration saved"),
    onError: (e) => toast.error("Failed to save: " + e.message),
  });

  const provisionPhone = trpc.settings.provisionPhone.useMutation({
    onSuccess: (d) => {
      if (d.alreadyProvisioned) {
        toast.info(`Phone number already provisioned: ${d.phoneNumber}`);
      } else {
        toast.success(`Phone number provisioned: ${d.phoneNumber}`);
      }
      refetchPhone();
    },
    onError: (e) => toast.error("Failed to provision: " + e.message),
  });

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings2 className="h-6 w-6 text-gray-600" />
          Settings
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure your AI caller agent, voice, integrations, and system behaviour.
        </p>
      </div>

      <Tabs defaultValue="agent">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="agent" className="gap-1.5 text-xs">
            <User className="h-3.5 w-3.5" />Agent
          </TabsTrigger>
          <TabsTrigger value="phone" className="gap-1.5 text-xs">
            <Phone className="h-3.5 w-3.5" />Phone
          </TabsTrigger>
          <TabsTrigger value="facebook" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" />Facebook
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5 text-xs">
            <Webhook className="h-3.5 w-3.5" />Webhooks
          </TabsTrigger>
        </TabsList>

        {/* ── Agent Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="agent" className="mt-5 space-y-5">
          {/* System Toggle */}
          <Card className={`shadow-none border ${isEnabled ? "border-green-200 bg-green-50/50" : "border-orange-200 bg-orange-50/50"}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center
                    ${isEnabled ? "bg-green-100" : "bg-orange-100"}`}>
                    <Power className={`h-5 w-5 ${isEnabled ? "text-green-600" : "text-orange-500"}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      System is {isEnabled ? "Active" : "Paused"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isEnabled
                        ? "New Facebook leads will be called automatically after the configured delay."
                        : "No new calls will be fired. Existing scheduled calls are also paused."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setEnabled.mutate({ enabled: !isEnabled })}
                  disabled={setEnabled.isPending}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${isEnabled ? "bg-green-500" : "bg-gray-300"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                    ${isEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Agent Profile */}
          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4 text-blue-600" />
                AI Agent Profile
              </CardTitle>
              <CardDescription>Configure how the AI agent presents itself on calls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="agentName">Agent Name</Label>
                  <Input
                    id="agentName"
                    value={agentName}
                    onChange={e => setAgentName(e.target.value)}
                    placeholder="Alex"
                  />
                  <p className="text-xs text-muted-foreground">The name the AI introduces itself as on calls.</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="callDelay">Call Delay (minutes)</Label>
                  <Input
                    id="callDelay"
                    type="number"
                    min={1}
                    max={60}
                    value={callDelay}
                    onChange={e => setCallDelay(parseInt(e.target.value) || 5)}
                  />
                  <p className="text-xs text-muted-foreground">How long after a lead comes in before calling.</p>
                </div>
              </div>

              {/* Voice Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5" />
                  Voice
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {voices.map((v) => {
                    const active = selectedVoice === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVoice(v.id)}
                        className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all
                          ${active
                            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0
                          ${v.gender === "Female" ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700"}`}>
                          {v.name[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-sm">{v.name}</span>
                            <span className="text-xs text-muted-foreground">{v.gender}</span>
                            {(v as any).recommended && (
                              <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 px-1 py-0 leading-4">
                                Recommended
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{v.description}</p>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Background Track Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5" />
                  Background Sound
                  <Badge variant="outline" className="text-xs text-blue-700 border-blue-300 bg-blue-50 ml-1">Makes calls sound real</Badge>
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {bgTracks.map((t) => {
                    const active = selectedBgTrack === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedBgTrack(t.id)}
                        className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all
                          ${active
                            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
                      >
                        <span className="text-xl shrink-0 mt-0.5">{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm">{t.label}</span>
                            {t.recommended && (
                              <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 px-1 py-0 leading-4">Best</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{t.description}</p>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={() => saveAgentConfig.mutate({ geminiVoice: selectedVoice, agentName, callDelay, backgroundTrack: selectedBgTrack })}
                disabled={saveAgentConfig.isPending}
                className="gap-2"
              >
                {saveAgentConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save Agent Configuration
              </Button>
            </CardContent>
          </Card>

          {/* Calendly Info */}
          <Card className="shadow-none border bg-gray-50/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                Calendly Demo Link
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white rounded-md text-xs font-mono text-gray-800 border truncate">
                  https://calendly.com/service-wrenchpilot/30min
                </code>
                <CopyButton text="https://calendly.com/service-wrenchpilot/30min" />
                <a href="https://calendly.com/service-wrenchpilot/30min" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />Open
                  </Button>
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                This link is shared with leads during calls. The AI checks this calendar before calling to avoid duplicate bookings.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Phone Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="phone" className="mt-5 space-y-5">

          {/* Twilio Account Status */}
          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-600" />
                Twilio Account Status
              </CardTitle>
              <CardDescription>Verify your Twilio account and check if the voice endpoint is reachable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {twilioStatusLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking account…</div>
              ) : twilioStatus?.error ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-800 text-sm">Twilio not connected</p>
                    <p className="text-xs text-red-700 mt-0.5">{twilioStatus.error}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">Account connected</span>
                    <Badge variant="outline" className={`text-xs ${twilioStatus?.isTrial ? 'text-orange-700 border-orange-300 bg-orange-50' : 'text-green-700 border-green-300 bg-green-50'}`}>
                      {twilioStatus?.isTrial ? 'Trial Account' : 'Full Account'}
                    </Badge>
                    {twilioStatus?.accountStatus && (
                      <Badge variant="outline" className="text-xs text-gray-600">{twilioStatus.accountStatus}</Badge>
                    )}
                  </div>
                  {twilioStatus?.isTrial && (
                    <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-orange-800 text-sm">Trial Account Restriction</p>
                          <p className="text-xs text-orange-700 mt-0.5">
                            Twilio trial accounts can only call <strong>verified phone numbers</strong>. To call any number, upgrade your Twilio account at{' '}
                            <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="underline">console.twilio.com</a>.
                          </p>
                          {twilioStatus.verifiedNumbers && twilioStatus.verifiedNumbers.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-orange-800">Verified numbers (can receive calls):</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {twilioStatus.verifiedNumbers.map((n: string) => (
                                  <code key={n} className="text-xs bg-orange-100 border border-orange-200 rounded px-1.5 py-0.5 font-mono">{n}</code>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TwiML Health Check */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Voice Endpoint Health</p>
                  <Button variant="outline" size="sm" onClick={() => refetchTwimlHealth()} disabled={twimlHealthLoading} className="gap-1.5 h-7 text-xs">
                    {twimlHealthLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Check
                  </Button>
                </div>
                {twimlHealthLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</div>
                ) : twimlHealth ? (
                  <div className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${twimlHealth.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    {twimlHealth.valid
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                      : <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                    <div>
                      <p className={`font-medium ${twimlHealth.valid ? 'text-green-800' : 'text-red-800'}`}>
                        {twimlHealth.valid ? 'Endpoint is live and returning valid TwiML' : 'Endpoint unreachable or returning invalid TwiML'}
                      </p>
                      <p className="text-muted-foreground mt-0.5 font-mono truncate">{twimlHealth.url}</p>
                      {!twimlHealth.valid && !twimlHealth.reachable && (
                        <p className="text-red-700 mt-1">Publish the app first — Twilio cannot reach a dev server URL.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4 text-green-600" />
                Outbound Phone Number
              </CardTitle>
              <CardDescription>
                Provision a dedicated Twilio phone number for outbound calls. Leads will see this number on their caller ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {phoneData?.phoneNumber ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <p className="font-semibold text-green-800 text-sm">Phone number provisioned</p>
                  </div>
                  <p className="text-xl font-mono font-bold text-green-700">{phoneData.phoneNumber}</p>
                  <p className="text-xs text-green-600 mt-1">This number is used as the caller ID for all outbound calls.</p>
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-yellow-800 text-sm">No phone number provisioned</p>
                    <p className="text-xs text-yellow-700 mt-0.5">
                      Without a provisioned number, calls cannot be dispatched. Provision a Twilio number to enable outbound calling.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="areaCode">Preferred Area Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="areaCode"
                    value={areaCode}
                    onChange={e => setAreaCode(e.target.value)}
                    placeholder="415"
                    className="max-w-32"
                    maxLength={3}
                  />
                  <Button
                    onClick={() => provisionPhone.mutate({ areaCode })}
                    disabled={provisionPhone.isPending || !!phoneData?.phoneNumber}
                    className="gap-2"
                  >
                    {provisionPhone.isPending
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Provisioning…</>
                      : <><Phone className="h-4 w-4" />Provision Number</>}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Enter a 3-digit US area code. Twilio will assign the closest available number.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Facebook Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="facebook" className="mt-5 space-y-5">

          {/* Step-by-step setup guide */}
          <Card className="shadow-none border border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600" />
                Complete Facebook Lead Ads Setup Guide
              </CardTitle>
              <CardDescription className="text-blue-700">Follow all 5 steps in order to receive real-time leads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">

              {/* Step 1 */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">1</span>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-800">Publish this app to a public URL</p>
                  <p className="text-gray-600 text-xs">Click the <strong>Publish</strong> button in the top-right of the Management UI. Facebook cannot reach a local dev server — it must be a public HTTPS URL.</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">2</span>
                <div className="space-y-1.5">
                  <p className="font-semibold text-gray-800">Create a Meta Developer App (if you don't have one)</p>
                  <p className="text-gray-600 text-xs">Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">developers.facebook.com/apps</a> → click <strong>Create App</strong> → choose <strong>Business</strong> type → fill in the name and contact email.</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">3</span>
                <div className="space-y-1.5">
                  <p className="font-semibold text-gray-800">Add the Webhooks product to your app</p>
                  <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                    <li>In your app dashboard, click <strong>Add Product</strong> in the left sidebar</li>
                    <li>Find <strong>Webhooks</strong> and click <strong>Set Up</strong></li>
                    <li>In the Webhooks panel, click <strong>Add Subscription</strong></li>
                    <li>Select <strong>Page</strong> from the dropdown</li>
                    <li>Enter the <strong>Callback URL</strong> and <strong>Verify Token</strong> from the card below</li>
                    <li>Check the <strong>leadgen</strong> field under Subscription Fields</li>
                    <li>Click <strong>Verify and Save</strong></li>
                  </ol>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">4</span>
                <div className="space-y-1.5">
                  <p className="font-semibold text-gray-800">Subscribe your app to your Facebook Page</p>
                  <p className="text-gray-600 text-xs">Webhooks only fire if your Page has installed your app. Use the Graph API Explorer below to send a POST to <code className="bg-gray-100 px-1 rounded font-mono">/&#123;page-id&#125;/subscribed_apps?subscribed_fields=leadgen</code> with a Page access token. Or use the curl command:</p>
                  <code className="block bg-gray-100 border rounded p-2 text-xs font-mono text-gray-700 break-all">
                    curl -X POST "https://graph.facebook.com/&#123;PAGE_ID&#125;/subscribed_apps?subscribed_fields=leadgen&access_token=&#123;PAGE_ACCESS_TOKEN&#125;"
                  </code>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">5</span>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-800">Test with a lead form submission</p>
                  <p className="text-gray-600 text-xs">Go to your Facebook Page → <strong>Publishing Tools</strong> → <strong>Lead Ads Forms</strong> → click <strong>Preview</strong> on your form and submit a test entry. The lead should appear in the Leads dashboard within seconds and a call will be scheduled automatically.</p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Meta Developer Apps
                  </Button>
                </a>
                <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Graph API Explorer
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Webhook credentials */}
          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Webhook className="h-4 w-4 text-blue-600" />
                Webhook Credentials
              </CardTitle>
              <CardDescription>Copy these exact values into your Meta Developer App → Webhooks → Page subscription.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeRow label="Callback URL" value={webhookCallbackUrl} />
              <CodeRow label="Verify Token" value={verifyToken} />

              <div className="p-3 bg-gray-50 border rounded-lg text-xs space-y-1">
                <p className="font-semibold text-gray-700">Subscription Fields to check</p>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  <Badge variant="outline" className="text-xs bg-white font-mono">leadgen</Badge>
                </div>
                <p className="text-gray-500 mt-1">Only the <code className="bg-gray-100 px-1 rounded">leadgen</code> field is required. Leave all others unchecked.</p>
              </div>
            </CardContent>
          </Card>

          {/* Page Access Token */}
          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-600" />
                Facebook Page Access Token
              </CardTitle>
              <CardDescription>
                Required to fetch lead field data (name, phone, email) from submitted forms after receiving a webhook notification.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 space-y-2">
                <p className="font-semibold">How to get your Page Access Token:</p>
                <ol className="space-y-1.5 list-decimal list-inside">
                  <li>Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="underline">Graph API Explorer</a></li>
                  <li>Select your WrenchPilot app from the <strong>Application</strong> dropdown</li>
                  <li>Click <strong>Get Token</strong> → <strong>Get User Access Token</strong> → enable <code className="bg-yellow-100 px-1 rounded">pages_manage_metadata</code></li>
                  <li>Click <strong>Get Token</strong> again → select your Facebook Page — this gives you a Page access token</li>
                  <li>Add permissions: <code className="bg-yellow-100 px-1 rounded">leads_retrieval</code>, <code className="bg-yellow-100 px-1 rounded">pages_read_engagement</code>, <code className="bg-yellow-100 px-1 rounded">ads_management</code></li>
                  <li>Copy the token → go to Management UI → Settings → Secrets → add as <code className="bg-yellow-100 px-1 rounded">FACEBOOK_PAGE_ACCESS_TOKEN</code></li>
                </ol>
                <p className="text-yellow-700 mt-1"><strong>Note:</strong> Page access tokens from the Explorer expire. For production, generate a long-lived token or use a System User token.</p>
              </div>
              <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Graph API Explorer
                </Button>
              </a>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhooks / Integrations Tab ───────────────────────────────────── */}
        <TabsContent value="integrations" className="mt-5 space-y-5">
          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Webhook className="h-4 w-4 text-purple-600" />
                Twilio Status Callback
              </CardTitle>
              <CardDescription>
                Twilio sends call status updates to this URL automatically. No manual setup required — it is configured on every outbound call.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeRow label="Twilio Status Callback URL" value={twilioStatusUrl} />
              <div className="p-3 bg-gray-50 border rounded-lg text-xs space-y-2 text-gray-700">
                <p className="font-semibold">How it works:</p>
                <ol className="space-y-1 list-decimal list-inside">
                  <li>This URL is automatically passed to Twilio on every outbound call dispatch</li>
                  <li>Twilio sends call status events (initiated, ringing, answered, completed) to this URL</li>
                  <li>The system updates the lead status and call log in real time based on these events</li>
                  <li>No manual configuration required — it is fully automatic</li>
                </ol>
              </div>
              <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />Open Twilio Console
                </Button>
              </a>
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                Calendly Integration
              </CardTitle>
              <CardDescription>
                The system checks Calendly before each call to avoid calling leads who already have a demo booked.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-gray-50 border rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Event Type</p>
                  <p className="font-medium">30-Minute Demo</p>
                </div>
                <div className="p-3 bg-gray-50 border rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  <p className="font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    Connected
                  </p>
                </div>
              </div>
              <CodeRow label="Calendly Booking URL" value="https://calendly.com/service-wrenchpilot/30min" />
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <p className="font-semibold mb-1">How it works:</p>
                <p>Before every call, the system queries Calendly using the lead's email. If a booking already exists, the call is skipped and the lead is marked as "booked" automatically.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

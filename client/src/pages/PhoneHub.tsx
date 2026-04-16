import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  digitsOnly,
  displayPhone,
  matchesNameSearch,
  matchesPhoneSearch,
  toE164UsDefault,
} from "@/lib/phone";
import { useContacts, type StoredContact } from "@/hooks/useContacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Phone,
  PhoneCall,
  PhoneMissed,
  Search,
  UserPlus,
  Trash2,
  MessageSquare,
  Users,
  BookUser,
  Delete,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type TwilioCallRow = {
  sid: string;
  to: string;
  from: string;
  status: string;
  duration: string | number | null;
  startTime: string | null;
  endTime: string | null;
  direction?: string;
};

type TwilioMessageRow = {
  sid: string;
  to: string;
  from: string;
  body: string;
  dateSent: string | null;
  direction: string;
  status: string;
};

type LeadRow = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function otherPartyPhone(msg: TwilioMessageRow, ourDigits: string): string {
  const fd = digitsOnly(msg.from);
  const td = digitsOnly(msg.to);
  if (ourDigits && fd === ourDigits) return msg.to;
  if (ourDigits && td === ourDigits) return msg.from;
  if (msg.direction?.startsWith("outbound")) return msg.to;
  return msg.from;
}

function parseDurationSeconds(d: string | number | null | undefined): number | null {
  if (d == null) return null;
  const n = typeof d === "number" ? d : parseInt(String(d), 10);
  return Number.isFinite(n) ? n : null;
}

function formatDur(sec: number | null): string {
  if (sec == null || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PhoneHub() {
  const [tab, setTab] = useState<"calls" | "messages" | "leads" | "contacts">("calls");
  const [search, setSearch] = useState("");
  const [dialedRaw, setDialedRaw] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [messageThreadPhone, setMessageThreadPhone] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savePhone, setSavePhone] = useState("");

  const { contacts, addContact, removeContact, getNameForPhone } = useContacts();

  const { data: phoneSetting } = trpc.settings.getPhoneNumber.useQuery();
  const ourDigits = digitsOnly(phoneSetting?.phoneNumber ?? "");

  const { data: leadsData, isLoading: leadsLoading } = trpc.leads.list.useQuery();
  const leads: LeadRow[] = (leadsData ?? []) as LeadRow[];

  const { data: callsData, isLoading: callsLoading, refetch: refetchCalls } =
    trpc.callerBot.listRecentCalls.useQuery({ limit: 50 }, { refetchInterval: 12_000 });
  const calls: TwilioCallRow[] = (callsData?.calls ?? []) as TwilioCallRow[];

  const { data: msgData, isLoading: msgLoading, refetch: refetchMsgs } =
    trpc.callerBot.listRecentMessages.useQuery({ limit: 120 }, { refetchInterval: 20_000 });
  const messages: TwilioMessageRow[] = (msgData?.messages ?? []) as TwilioMessageRow[];

  const dialMutation = trpc.callerBot.dialNumber.useMutation({
    onSuccess: (r) => {
      toast.success(`Calling… (${r.callId})`);
      refetchCalls();
    },
    onError: (e) => {
      if (e.message?.includes("trial") || e.message?.includes("verified")) {
        toast.error(e.message, { duration: 10_000 });
      } else {
        toast.error(e.message);
      }
    },
  });

  const leadByPhone = useMemo(() => {
    const m = new Map<string, LeadRow>();
    for (const L of leads) {
      if (L.phone) m.set(digitsOnly(L.phone), L);
    }
    return m;
  }, [leads]);

  const resolveLabel = useCallback(
    (phone: string | null | undefined): string => {
      if (!phone) return "Unknown";
      const d = digitsOnly(phone);
      const contactName = getNameForPhone(phone);
      if (contactName) return contactName;
      const lead = leadByPhone.get(d);
      if (lead?.name) return lead.name;
      return displayPhone(phone);
    },
    [getNameForPhone, leadByPhone]
  );

  const e164Draft = useMemo(() => toE164UsDefault(dialedRaw), [dialedRaw]);

  const filteredLeads = useMemo(() => {
    const q = search.trim();
    if (!q) return leads;
    return leads.filter(
      L =>
        matchesNameSearch(q, L.name) ||
        matchesPhoneSearch(q, L.phone ?? "") ||
        matchesNameSearch(q, L.email)
    );
  }, [leads, search]);

  const filteredContacts = useMemo(() => {
    const q = search.trim();
    if (!q) return contacts;
    return contacts.filter(
      c => matchesNameSearch(q, c.name) || matchesPhoneSearch(q, c.phone)
    );
  }, [contacts, search]);

  const filteredCalls = useMemo(() => {
    const q = search.trim();
    if (!q) return calls;
    return calls.filter(c => {
      const other = c.direction?.startsWith("inbound") ? c.from : c.to;
      return (
        matchesPhoneSearch(q, c.to) ||
        matchesPhoneSearch(q, c.from) ||
        matchesPhoneSearch(q, other) ||
        matchesNameSearch(q, resolveLabel(other))
      );
    });
  }, [calls, search, resolveLabel]);

  const messageThreads = useMemo(() => {
    const map = new Map<
      string,
      { phone: string; lastAt: string; lastBody: string; outbound: boolean }
    >();
    for (const m of messages) {
      const other = otherPartyPhone(m, ourDigits);
      const od = digitsOnly(other);
      if (!od) continue;
      const key = od;
      const t = m.dateSent ?? "";
      const prev = map.get(key);
      const outbound = m.direction?.startsWith("outbound") ?? false;
      if (!prev || t > prev.lastAt) {
        map.set(key, { phone: other, lastAt: t, lastBody: m.body, outbound });
      }
    }
    const arr = Array.from(map.values()).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    const q = search.trim();
    if (!q) return arr;
    return arr.filter(
      t =>
        matchesPhoneSearch(q, t.phone) ||
        matchesNameSearch(q, resolveLabel(t.phone)) ||
        matchesNameSearch(q, t.lastBody)
    );
  }, [messages, ourDigits, search, resolveLabel]);

  const threadMessages = useMemo(() => {
    if (!messageThreadPhone) return [];
    const td = digitsOnly(messageThreadPhone);
    return messages
      .filter(m => digitsOnly(otherPartyPhone(m, ourDigits)) === td)
      .sort((a, b) => (a.dateSent && b.dateSent ? a.dateSent.localeCompare(b.dateSent) : 0));
  }, [messages, messageThreadPhone, ourDigits]);

  const appendDigit = (d: string) => setDialedRaw(prev => prev + d);
  const backspace = () => setDialedRaw(prev => prev.slice(0, -1));

  const pickNumber = (
    phone: string,
    nameHint?: string,
    opts?: { openMessageThread?: string | null; leadId?: number | null }
  ) => {
    setDialedRaw(phone);
    if (opts?.openMessageThread) setMessageThreadPhone(opts.openMessageThread);
    else setMessageThreadPhone(null);
    if (nameHint) setDisplayName(nameHint);
    else setDisplayName(resolveLabel(phone));
    const d = digitsOnly(phone);
    const lead = leadByPhone.get(d);
    if (opts?.leadId !== undefined && opts.leadId !== null) setSelectedLeadId(opts.leadId);
    else setSelectedLeadId(lead?.id ?? null);
  };

  const handleDial = () => {
    const e164 = toE164UsDefault(dialedRaw);
    if (digitsOnly(e164).length < 10) {
      toast.error("Enter a valid phone number");
      return;
    }
    const name =
      displayName.trim() ||
      resolveLabel(e164) ||
      "Lead";
    dialMutation.mutate({
      phone: e164,
      name,
      leadId: selectedLeadId ?? undefined,
    });
  };

  const openSaveContact = () => {
    setSavePhone(e164Draft || dialedRaw);
    setSaveName(displayName.trim());
    setSaveOpen(true);
  };

  const confirmSaveContact = () => {
    addContact({ name: saveName, phone: savePhone });
    toast.success("Saved to contacts");
    setSaveOpen(false);
  };

  const dialPadKeys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
  ];

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-5.5rem)] min-h-[520px] max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Phone className="h-7 w-7 text-emerald-600" />
          Phone
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Call history, leads, SMS you have sent or received on your Twilio number, and a dial pad
          — search by name or number like chat apps.
        </p>
      </div>

      <div className="flex flex-1 min-h-0 rounded-xl border bg-card shadow-sm overflow-hidden">
        {/* Left: lists */}
        <div className="w-full max-w-[380px] shrink-0 flex flex-col border-r bg-muted/20">
          <div className="p-3 border-b space-y-2 bg-background/80">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-9"
                placeholder="Search name, email, or number…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)} className="w-full">
              <TabsList className="grid w-full grid-cols-4 h-9">
                <TabsTrigger value="calls" className="text-xs px-1">
                  Calls
                </TabsTrigger>
                <TabsTrigger value="messages" className="text-xs px-1">
                  Msgs
                </TabsTrigger>
                <TabsTrigger value="leads" className="text-xs px-1">
                  Leads
                </TabsTrigger>
                <TabsTrigger value="contacts" className="text-xs px-1">
                  Saved
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-1">
              {tab === "calls" && (
                <div className="space-y-0.5">
                  {callsLoading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading calls…
                    </div>
                  )}
                  {!callsLoading && filteredCalls.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-10 px-4">
                      No calls match your search yet.
                    </p>
                  )}
                  {filteredCalls.map(c => {
                    const other = c.direction === "inbound" ? c.from : c.to;
                    const label = resolveLabel(other);
                    const dur = parseDurationSeconds(c.duration);
                    const st = c.status?.toLowerCase();
                    return (
                      <button
                        key={c.sid}
                        type="button"
                        onClick={() => pickNumber(other, label)}
                        className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/80 transition-colors"
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="text-xs bg-emerald-100 text-emerald-800">
                            {initials(label)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{label}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {c.startTime
                                ? formatDistanceToNow(new Date(c.startTime), { addSuffix: true })
                                : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono truncate">{displayPhone(other)}</span>
                            {dur != null && dur > 0 && (
                              <span className="shrink-0">{formatDur(dur)}</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {st === "completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : st === "failed" || st === "no-answer" ? (
                            <PhoneMissed className="h-4 w-4 text-red-500" />
                          ) : (
                            <PhoneCall className="h-4 w-4 text-blue-500" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {tab === "messages" && (
                <div className="space-y-0.5">
                  {msgLoading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading messages…
                    </div>
                  )}
                  {!msgLoading && messageThreads.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-10 px-4">
                      No SMS threads yet. Outbound booking texts appear here once Twilio is
                      configured.
                    </p>
                  )}
                  {messageThreads.map(t => {
                    const label = resolveLabel(t.phone);
                    return (
                      <button
                        key={digitsOnly(t.phone)}
                        type="button"
                        onClick={() => pickNumber(t.phone, label, { openMessageThread: t.phone })}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/80 transition-colors ${
                          messageThreadPhone &&
                          digitsOnly(messageThreadPhone) === digitsOnly(t.phone)
                            ? "bg-accent"
                            : ""
                        }`}
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="text-xs bg-sky-100 text-sky-800">
                            {initials(label)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate">{label}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {t.lastAt
                                ? formatDistanceToNow(new Date(t.lastAt), { addSuffix: true })
                                : ""}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {t.outbound ? "You: " : ""}
                            {t.lastBody}
                          </p>
                        </div>
                        <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

              {tab === "leads" && (
                <div className="space-y-0.5">
                  {leadsLoading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading leads…
                    </div>
                  )}
                  {!leadsLoading && filteredLeads.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-10 px-4">
                      No leads match your search.
                    </p>
                  )}
                  {filteredLeads.map(L => (
                    <button
                      key={L.id}
                      type="button"
                      onClick={() => {
                        if (L.phone) pickNumber(L.phone, L.name ?? undefined, { leadId: L.id });
                      }}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/80 transition-colors ${
                        selectedLeadId === L.id ? "bg-accent" : ""
                      }`}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="text-xs bg-violet-100 text-violet-800">
                          {initials(L.name || "Lead")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{L.name || "Unnamed"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                            {L.status}
                          </Badge>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">
                          {L.phone ? displayPhone(L.phone) : "—"}
                        </span>
                      </div>
                      <Link
                        href={`/leads/${L.id}`}
                        className="text-xs text-primary hover:underline shrink-0 px-1"
                        onClick={e => e.stopPropagation()}
                      >
                        Open
                      </Link>
                    </button>
                  ))}
                </div>
              )}

              {tab === "contacts" && (
                <div className="space-y-0.5">
                  {filteredContacts.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-10 px-4">
                      No saved contacts. Use “Save contact” on the right after entering a number.
                    </p>
                  )}
                  {filteredContacts.map((c: StoredContact) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/60"
                    >
                      <button
                        type="button"
                        className="flex flex-1 min-w-0 items-center gap-3 text-left"
                        onClick={() => pickNumber(c.phone, c.name)}
                      >
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="text-xs bg-amber-100 text-amber-900">
                            {initials(c.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{c.name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{displayPhone(c.phone)}</p>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8 text-muted-foreground"
                        onClick={() => removeContact(c.id)}
                        aria-label={`Remove ${c.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: dial + thread */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <div className="p-4 border-b space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px] space-y-1">
                <Label className="text-xs text-muted-foreground">Number (paste or dial)</Label>
                <Input
                  className="font-mono text-lg h-11"
                  placeholder="+1…"
                  value={dialedRaw}
                  onChange={e => {
                    setDialedRaw(e.target.value);
                    setSelectedLeadId(null);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Normalized:{" "}
                  <span className="font-mono text-foreground">{e164Draft || "—"}</span>
                </p>
              </div>
              <div className="flex-1 min-w-[180px] space-y-1">
                <Label className="text-xs text-muted-foreground">Display name for the AI</Label>
                <Input
                  placeholder="e.g. Jordan Smith"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={handleDial}
                disabled={dialMutation.isPending || digitsOnly(dialedRaw).length < 10}
              >
                {dialMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneCall className="h-4 w-4" />
                )}
                Call with AI
              </Button>
              <Button variant="outline" className="gap-2" onClick={openSaveContact}>
                <UserPlus className="h-4 w-4" />
                Save contact
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetchMsgs()}>
                Refresh messages
              </Button>
            </div>
          </div>

          <div className="flex flex-1 min-h-0 flex-col md:flex-row">
            <div className="p-4 md:border-r md:w-[280px] shrink-0 flex flex-col items-center gap-3">
              <p className="text-xs font-medium text-muted-foreground self-start">Dial pad</p>
              <div className="grid grid-cols-3 gap-2 w-full max-w-[220px]">
                {dialPadKeys.flat().map(key => (
                  <Button
                    key={key}
                    variant="outline"
                    className="h-12 text-lg font-semibold"
                    type="button"
                    onClick={() => appendDigit(key)}
                  >
                    {key}
                  </Button>
                ))}
              </div>
              <Button variant="secondary" className="w-full max-w-[220px] gap-2" type="button" onClick={backspace}>
                <Delete className="h-4 w-4" />
                Backspace
              </Button>
            </div>

            <ScrollArea className="flex-1 min-h-[200px]">
              <div className="p-4 space-y-3">
                {messageThreadPhone ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <MessageSquare className="h-4 w-4" />
                      Thread with {resolveLabel(messageThreadPhone)}
                    </div>
                    <div className="space-y-2 max-w-lg">
                      {threadMessages.map(m => {
                        const outbound = m.direction?.startsWith("outbound");
                        return (
                          <div
                            key={m.sid}
                            className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                outbound
                                  ? "bg-emerald-600 text-white rounded-br-sm"
                                  : "bg-muted rounded-bl-sm"
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                              <p
                                className={`text-[10px] mt-1 ${outbound ? "text-emerald-100" : "text-muted-foreground"}`}
                              >
                                {m.dateSent ? new Date(m.dateSent).toLocaleString() : ""}
                                {m.status ? ` · ${m.status}` : ""}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground space-y-2 max-w-md">
                    <p className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Pick a call, lead, or message thread on the left — the number fills in here.
                    </p>
                    <p className="flex items-center gap-2">
                      <BookUser className="h-4 w-4" />
                      Saved contacts stay on this device (browser). Leads stay in your database.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Contact name" />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                className="font-mono"
                value={savePhone}
                onChange={e => setSavePhone(e.target.value)}
                placeholder="+1…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmSaveContact}
              disabled={!saveName.trim() || digitsOnly(savePhone).length < 10}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

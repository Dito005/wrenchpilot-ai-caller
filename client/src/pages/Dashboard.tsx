import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Phone, RefreshCw, Plus, PhoneCall, Calendar, UserX, Clock, AlertTriangle, CheckCircle2, Radio } from "lucide-react";

type LeadStatus = "pending" | "called" | "booked" | "no-answer";

const STATUS_CONFIG: Record<LeadStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType; color: string }> = {
  pending: { label: "Pending", variant: "secondary", icon: Clock, color: "text-yellow-600" },
  called: { label: "Called", variant: "default", icon: PhoneCall, color: "text-blue-600" },
  booked: { label: "Booked", variant: "default", icon: Calendar, color: "text-green-600" },
  "no-answer": { label: "No Answer", variant: "destructive", icon: UserX, color: "text-red-600" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as LeadStatus] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const colorMap: Record<string, string> = {
    pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
    called: "bg-blue-50 text-blue-700 border-blue-200",
    booked: "bg-green-50 text-green-700 border-green-200",
    "no-answer": "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorMap[status] || colorMap.pending}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function AddLeadDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const addLead = trpc.leads.addManual.useMutation({
    onSuccess: () => {
      toast.success("Lead added — call scheduled for 5 minutes from now");
      setOpen(false);
      setName(""); setPhone(""); setEmail("");
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Lead Manually</DialogTitle>
          <DialogDescription>
            A call will be scheduled automatically 5 minutes after adding.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Full Name *</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="John Smith" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone">Phone Number *</Label>
            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => addLead.mutate({ name, phone, email: email || undefined })}
            disabled={!name || !phone || addLead.isPending}
          >
            {addLead.isPending ? "Adding..." : "Add & Schedule Call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: leads, isLoading, refetch } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 10000, // auto-refresh every 10s
  });
  const { data: systemData } = trpc.settings.getSystemEnabled.useQuery();
  const isEnabled = systemData?.enabled !== false;

  const triggerCall = trpc.leads.triggerCall.useMutation({
    onSuccess: () => {
      toast.success("Call triggered successfully");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = {
    total: leads?.length || 0,
    pending: leads?.filter(l => l.status === "pending").length || 0,
    called: leads?.filter(l => l.status === "called").length || 0,
    booked: leads?.filter(l => l.status === "booked").length || 0,
    noAnswer: leads?.filter(l => l.status === "no-answer").length || 0,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Facebook leads are called automatically after the configured delay.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
            ${isEnabled ? "bg-green-50 text-green-700 border-green-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
            {isEnabled
              ? <><Radio className="h-3 w-3 animate-pulse" />System Active</>
              : <><AlertTriangle className="h-3 w-3" />System Paused</>}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <AddLeadDialog onSuccess={() => refetch()} />
        </div>
      </div>

      {/* Paused Banner */}
      {!isEnabled && (
        <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>The calling system is <strong>paused</strong> — new leads will not be called automatically. Go to <strong>Caller Bot → System Toggle</strong> or <strong>Settings → Agent</strong> to re-enable.</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: stats.total, color: "text-foreground" },
          { label: "Pending", value: stats.pending, color: "text-yellow-600" },
          { label: "Booked", value: stats.booked, color: "text-green-600" },
          { label: "No Answer", value: stats.noAnswer, color: "text-red-600" },
        ].map(stat => (
          <Card key={stat.label} className="shadow-none border">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{stat.label}</p>
              <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leads Table */}
      <Card className="shadow-none border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Leads</CardTitle>
          <CardDescription>Click a row to view call transcript and details.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Loading leads...
            </div>
          ) : !leads?.length ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
              <Phone className="h-10 w-10 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">No leads yet</p>
                <p className="text-xs mt-1">Connect your Facebook Lead Ads webhook to start receiving leads automatically.</p>
                <p className="text-xs mt-0.5">Go to <strong>Settings → Facebook</strong> for setup instructions.</p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map(lead => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/leads/${lead.id}`)}
                  >
                    <TableCell className="font-medium">{lead.name || <span className="text-muted-foreground italic">Unknown</span>}</TableCell>
                    <TableCell className="font-mono text-sm">{lead.phone || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.email || "—"}</TableCell>
                    <TableCell><StatusBadge status={lead.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      {(lead.status === "pending" || lead.status === "no-answer") && lead.phone && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 h-7 text-xs"
                          disabled={triggerCall.isPending}
                          onClick={() => triggerCall.mutate({
                            leadId: lead.id,
                            baseUrl: window.location.origin,
                          })}
                        >
                          <Phone className="h-3 w-3" />
                          Call Now
                        </Button>
                      )}
                      {lead.status === "booked" && (
                        <a
                          href={lead.calendlyBookingUrl || "https://calendly.com/service-wrenchpilot/30min"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <Calendar className="h-3 w-3" />
                          View Booking
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

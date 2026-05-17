import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Link2, Trash2, Download, Copy, QrCode, BarChart3, Pencil, GripVertical, Loader2, ExternalLink } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiPost, apiPut, apiPatch, apiDelete, getApiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";

const SURVEY_TYPE_LABELS: Record<string, string> = {
  food_quality: "Food Quality",
  service_quality: "Service Quality",
  cleanliness: "Cleanliness",
  ambience: "Ambience",
  staff_rating: "Staff Rating",
  nps: "Net Promoter Score (NPS)",
  suggestion_box: "Suggestion Box",
};

const QUESTION_TYPE_LABELS: Record<string, string> = {
  rating_5: "Rating 1–5",
  rating_10: "Rating 1–10",
  nps: "NPS 0–10",
  text_short: "Short text",
  text_long: "Long text",
  single_choice: "Single choice",
};

interface Survey {
  id: number;
  type: string;
  slug: string;
  title: string;
  description: string | null;
  thankYouMessage: string;
  collectName: boolean;
  collectPhone: boolean;
  collectTableNumber: boolean;
  isActive: boolean;
  responseCount: number;
  createdAt: string;
}

interface SurveyQuestion {
  id?: number;
  sortOrder: number;
  type: string;
  label: string;
  required: boolean;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
}

interface SurveyDetail extends Survey { questions: SurveyQuestion[] }

interface AnalyticsData {
  totalResponses: number;
  trend: { date: string; count: number }[];
  perQuestion: Array<{
    questionId: number;
    label: string;
    type: string;
    responseCount: number;
    average?: number;
    npsScore?: number;
    promoters?: number;
    passives?: number;
    detractors?: number;
    distribution?: { value: string; count: number }[];
    recent?: { text: string; submittedAt: string; respondentName: string | null }[];
  }>;
}

export default function SurveysPage() {
  const { user } = useAuth();
  const restaurantId = user?.restaurantId;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<string>("food_quality");

  const { data: surveys = [], isLoading } = useQuery<Survey[]>({
    queryKey: ["surveys", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/surveys`),
    enabled: !!restaurantId,
  });

  const createMut = useMutation({
    mutationFn: (type: string) => apiPost(`/restaurants/${restaurantId}/surveys`, { type }),
    onSuccess: (s: SurveyDetail) => {
      toast({ title: "Survey created" });
      setCreateOpen(false);
      setSelectedId(s.id);
      qc.invalidateQueries({ queryKey: ["surveys", restaurantId] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/surveys/${id}`),
    onSuccess: () => {
      toast({ title: "Survey deleted" });
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["surveys", restaurantId] });
    },
  });

  if (!restaurantId) {
    return (
      <Layout>
        <div className="p-6"><p className="text-muted-foreground">Select a restaurant first.</p></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="Smart Forms & Surveys"
        subtitle="Build short customer surveys, share them via QR, and analyze results."
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-survey">
            <Plus className="h-4 w-4 mr-2" /> New Survey
          </Button>
        }
      />

      <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && surveys.length === 0 && (
            <Card><CardContent className="p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No surveys yet.</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first survey</Button>
            </CardContent></Card>
          )}
          {surveys.map(s => (
            <Card
              key={s.id}
              className={`cursor-pointer hover-elevate ${selectedId === s.id ? "border-primary" : ""}`}
              onClick={() => setSelectedId(s.id)}
              data-testid={`card-survey-${s.id}`}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{SURVEY_TYPE_LABELS[s.type] ?? s.type}</p>
                  </div>
                  <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Off"}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{s.responseCount} responses</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); if (confirm("Delete this survey?")) deleteMut.mutate(s.id); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-8">
          {selectedId ? (
            <SurveyDetailPanel restaurantId={restaurantId} surveyId={selectedId} />
          ) : (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              Select a survey to edit, view its QR code, or see analytics.
            </CardContent></Card>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create a new survey</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type</Label>
              <Select value={createType} onValueChange={setCreateType}>
                <SelectTrigger data-testid="select-survey-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SURVEY_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              We'll prefill questions for this template — you can edit them after creating.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate(createType)} disabled={createMut.isPending} data-testid="button-confirm-create-survey">
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function SurveyDetailPanel({ restaurantId, surveyId }: { restaurantId: number; surveyId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: survey, isLoading } = useQuery<SurveyDetail>({
    queryKey: ["survey", restaurantId, surveyId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/surveys/${surveyId}`),
  });

  const publicUrl = survey ? `${window.location.origin}/survey/${survey.slug}` : "";

  const updateMut = useMutation({
    mutationFn: (body: Partial<SurveyDetail>) => apiPatch(`/restaurants/${restaurantId}/surveys/${surveyId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["survey", restaurantId, surveyId] });
      qc.invalidateQueries({ queryKey: ["surveys", restaurantId] });
      toast({ title: "Saved" });
    },
  });

  const saveQuestionsMut = useMutation({
    mutationFn: (questions: SurveyQuestion[]) => apiPut(`/restaurants/${restaurantId}/surveys/${surveyId}/questions`, { questions }),
    onSuccess: (data: { structuralEditsLocked: boolean }) => {
      qc.invalidateQueries({ queryKey: ["survey", restaurantId, surveyId] });
      toast({
        title: "Questions saved",
        description: data.structuralEditsLocked ? "Only labels were updated (responses already exist)." : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !survey) {
    return <Card><CardContent className="p-6"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Tabs defaultValue="builder">
          <div className="border-b px-4">
            <TabsList className="bg-transparent p-0 h-auto">
              <TabsTrigger value="builder" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><Pencil className="h-4 w-4 mr-2" />Builder</TabsTrigger>
              <TabsTrigger value="share" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><QrCode className="h-4 w-4 mr-2" />QR & Share</TabsTrigger>
              <TabsTrigger value="analytics" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"><BarChart3 className="h-4 w-4 mr-2" />Analytics</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="builder" className="p-6 space-y-6">
            <BuilderForm
              survey={survey}
              onSaveSettings={(b) => updateMut.mutate(b)}
              onSaveQuestions={(qs) => saveQuestionsMut.mutate(qs)}
              savingSettings={updateMut.isPending}
              savingQuestions={saveQuestionsMut.isPending}
            />
          </TabsContent>

          <TabsContent value="share" className="p-6 space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <Label>Public link</Label>
                  <div className="flex gap-2 mt-1">
                    <Input readOnly value={publicUrl} data-testid="input-public-url" />
                    <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Copied" }); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" asChild>
                      <a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={survey.isActive} onCheckedChange={(v) => updateMut.mutate({ isActive: v })} />
                  <span className="text-sm">{survey.isActive ? "Accepting responses" : "Paused"}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Print or display the QR on tables, receipts, or in-store signage. Customers can scan to fill out the survey.
                </p>
                <Button variant="outline" asChild>
                  <a href={getApiUrl(`/restaurants/${restaurantId}/surveys/${surveyId}/qr.svg`)} download={`survey-${survey.slug}-qr.svg`}>
                    <Download className="h-4 w-4 mr-2" /> Download QR (SVG)
                  </a>
                </Button>
              </div>
              <div className="border rounded-lg p-4 flex items-center justify-center bg-white">
                <img
                  src={getApiUrl(`/restaurants/${restaurantId}/surveys/${surveyId}/qr.svg`)}
                  alt="Survey QR code"
                  className="max-w-full h-auto"
                  style={{ width: 300, height: 300 }}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="p-6">
            <AnalyticsPanel restaurantId={restaurantId} surveyId={surveyId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function BuilderForm({ survey, onSaveSettings, onSaveQuestions, savingSettings, savingQuestions }: {
  survey: SurveyDetail;
  onSaveSettings: (b: Partial<SurveyDetail>) => void;
  onSaveQuestions: (qs: SurveyQuestion[]) => void;
  savingSettings: boolean;
  savingQuestions: boolean;
}) {
  const [title, setTitle] = useState(survey.title);
  const [description, setDescription] = useState(survey.description ?? "");
  const [thankYouMessage, setThankYouMessage] = useState(survey.thankYouMessage);
  const [collectName, setCollectName] = useState(survey.collectName);
  const [collectPhone, setCollectPhone] = useState(survey.collectPhone);
  const [collectTableNumber, setCollectTableNumber] = useState(survey.collectTableNumber);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(survey.questions);

  const updateQ = (i: number, patch: Partial<SurveyQuestion>) => {
    setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  };
  const moveQ = (i: number, dir: -1 | 1) => {
    setQuestions(qs => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy.map((q, idx) => ({ ...q, sortOrder: idx }));
    });
  };
  const removeQ = (i: number) => setQuestions(qs => qs.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, sortOrder: idx })));
  const addQ = () => setQuestions(qs => [...qs, {
    sortOrder: qs.length, type: "rating_5", label: "New question", required: false, options: [], scaleMin: 1, scaleMax: 5,
  }]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-semibold">Survey settings</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-survey-title" />
          </div>
          <div>
            <Label>Thank-you message</Label>
            <Input value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><Switch checked={collectName} onCheckedChange={setCollectName} /> Collect name</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={collectPhone} onCheckedChange={setCollectPhone} /> Collect phone</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={collectTableNumber} onCheckedChange={setCollectTableNumber} /> Collect table number</label>
        </div>
        <Button
          size="sm"
          onClick={() => onSaveSettings({ title, description, thankYouMessage, collectName, collectPhone, collectTableNumber })}
          disabled={savingSettings}
          data-testid="button-save-settings"
        >
          {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save settings"}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Questions</h3>
          <Button size="sm" variant="outline" onClick={addQ}><Plus className="h-3 w-3 mr-1" /> Add question</Button>
        </div>
        {questions.map((q, i) => (
          <Card key={i}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex flex-col mt-1">
                  <button onClick={() => moveQ(i, -1)} className="text-muted-foreground hover:text-foreground" disabled={i === 0}>↑</button>
                  <GripVertical className="h-3 w-3 text-muted-foreground my-0.5" />
                  <button onClick={() => moveQ(i, 1)} className="text-muted-foreground hover:text-foreground" disabled={i === questions.length - 1}>↓</button>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="grid md:grid-cols-3 gap-2">
                    <div className="md:col-span-2">
                      <Label className="text-xs">Question</Label>
                      <Input value={q.label} onChange={(e) => updateQ(i, { label: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select value={q.type} onValueChange={(v) => {
                        const patch: Partial<SurveyQuestion> = { type: v };
                        if (v === "rating_5") { patch.scaleMin = 1; patch.scaleMax = 5; patch.options = []; }
                        else if (v === "rating_10") { patch.scaleMin = 1; patch.scaleMax = 10; patch.options = []; }
                        else if (v === "nps") { patch.scaleMin = 0; patch.scaleMax = 10; patch.options = []; }
                        else if (v === "single_choice") { patch.scaleMin = null; patch.scaleMax = null; if (!q.options.length) patch.options = ["Yes", "No"]; }
                        else { patch.scaleMin = null; patch.scaleMax = null; patch.options = []; }
                        updateQ(i, patch);
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {q.type === "single_choice" && (
                    <div>
                      <Label className="text-xs">Options (comma separated)</Label>
                      <Input
                        value={q.options.join(", ")}
                        onChange={(e) => updateQ(i, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs"><Switch checked={q.required} onCheckedChange={(v) => updateQ(i, { required: v })} /> Required</label>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeQ(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Button onClick={() => onSaveQuestions(questions)} disabled={savingQuestions} data-testid="button-save-questions">
          {savingQuestions ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save questions"}
        </Button>
      </div>
    </div>
  );
}

function AnalyticsPanel({ restaurantId, surveyId }: { restaurantId: number; surveyId: number }) {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["survey-analytics", restaurantId, surveyId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/surveys/${surveyId}/analytics`),
  });

  const csvUrl = useMemo(() => getApiUrl(`/restaurants/${restaurantId}/surveys/${surveyId}/responses.csv`), [restaurantId, surveyId]);

  async function downloadCsv() {
    const token = localStorage.getItem("tt_access_token");
    const res = await fetch(csvUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-${surveyId}-responses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading || !data) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Total responses</p>
          <p className="text-3xl font-semibold">{data.totalResponses}</p>
        </div>
        <Button variant="outline" onClick={downloadCsv} data-testid="button-export-csv">
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      {data.trend.length > 0 && (
        <Card><CardContent className="p-4">
          <p className="text-sm font-medium mb-2">Responses over time</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#c2410c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent></Card>
      )}

      <div className="space-y-4">
        {data.perQuestion.map(q => (
          <Card key={q.questionId}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{q.label}</p>
                  <p className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[q.type] ?? q.type} · {q.responseCount} answers</p>
                </div>
                {q.average != null && q.type !== "nps" && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Average</p>
                    <p className="text-2xl font-semibold">{q.average.toFixed(1)}</p>
                  </div>
                )}
                {q.type === "nps" && q.npsScore != null && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">NPS</p>
                    <p className="text-2xl font-semibold">{q.npsScore}</p>
                    <p className="text-[10px] text-muted-foreground">P{q.promoters} · Pa{q.passives} · D{q.detractors}</p>
                  </div>
                )}
              </div>
              {q.distribution && q.distribution.length > 0 && (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={q.distribution}>
                      <XAxis dataKey="value" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#c2410c" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {q.recent && q.recent.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-auto">
                  {q.recent.map((r, i) => (
                    <div key={i} className="text-xs border-l-2 border-muted pl-2 py-1">
                      <p className="text-foreground">{r.text}</p>
                      <p className="text-muted-foreground">{r.respondentName ?? "Guest"} · {new Date(r.submittedAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

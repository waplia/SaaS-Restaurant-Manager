/**
 * Persistent dashboard AI chat assistant.
 *
 * Renders a floating launcher button in the bottom-right of the dashboard.
 * Clicking it opens a side Sheet with a conversation list + active chat.
 * Each assistant turn debits 2 credits via the `dashboard_chat_assistant`
 * feature. Other parts of the app can prefill the input by dispatching a
 * `window` event:
 *
 *     window.dispatchEvent(new CustomEvent("ai-chat:open", {
 *       detail: { prompt: "Draft a friendly reply to review #123" },
 *     }));
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Plus, Trash2, Loader2, MessageSquare, Wrench } from "lucide-react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown; error?: string }>;
  creditsCharged?: number;
  createdAt: string;
}

interface ChatConversation {
  id: number;
  title: string;
  updatedAt: string;
  createdAt: string;
}

const TURN_COST = 2;

export const AI_CHAT_OPEN_EVENT = "ai-chat:open";

export function AiChatAssistant() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const enabled = !!wallet.data?.planDashboardChatEnabled && !!restaurantId;

  const conversations = useQuery<{ data: ChatConversation[] }>({
    queryKey: ["dashboard-chat-conversations", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/dashboard-chat/conversations`),
    enabled: enabled && open,
  });

  const messages = useQuery<{ conversation: ChatConversation; messages: ChatMessage[] }>({
    queryKey: ["dashboard-chat-messages", restaurantId, activeId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/dashboard-chat/conversations/${activeId}`),
    enabled: enabled && open && !!activeId,
  });

  const send = useMutation({
    mutationFn: (vars: { conversationId: number | null; message: string }) =>
      apiPost<{ conversationId: number; message: ChatMessage; creditsCharged: number }>(
        `/restaurants/${restaurantId}/dashboard-chat/messages`,
        vars,
      ),
    onSuccess: (res) => {
      setActiveId(res.conversationId);
      qc.invalidateQueries({ queryKey: ["dashboard-chat-conversations", restaurantId] });
      qc.invalidateQueries({ queryKey: ["dashboard-chat-messages", restaurantId, res.conversationId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
    },
    onError: (err: Error) => {
      toast({ title: "Chat failed", description: err.message, variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/dashboard-chat/conversations/${id}`),
    onSuccess: (_, id) => {
      if (activeId === id) setActiveId(null);
      qc.invalidateQueries({ queryKey: ["dashboard-chat-conversations", restaurantId] });
    },
  });

  // Auto-scroll on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.data?.messages?.length, send.isPending]);

  // Allow other pages to open the chat with a prefilled prompt.
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      setOpen(true);
      setActiveId(null);
      if (detail?.prompt) setDraft(detail.prompt);
    }
    window.addEventListener(AI_CHAT_OPEN_EVENT, handler);
    return () => window.removeEventListener(AI_CHAT_OPEN_EVENT, handler);
  }, []);

  if (!enabled) return null;

  function submit() {
    const msg = draft.trim();
    if (!msg || send.isPending) return;
    if ((wallet.data?.balance ?? 0) < TURN_COST) {
      toast({ title: "Out of AI credits", description: `Each chat reply costs ${TURN_COST} credits. Top up in Settings → AI Wallet.`, variant: "destructive" });
      return;
    }
    setDraft("");
    send.mutate({ conversationId: activeId, message: msg });
  }

  const items = messages.data?.messages ?? [];

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        className="fixed bottom-2 right-5 h-12 w-12 rounded-full shadow-lg z-[60]"
        data-testid="button-open-ai-chat"
        aria-label="Open AI assistant"
      >
        <Sparkles className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Dashboard Assistant
              <Badge variant="outline" className="ml-auto text-xs">{TURN_COST} credits / reply</Badge>
            </SheetTitle>
          </SheetHeader>

          <div className="flex items-center gap-2 px-3 py-2 border-b text-xs">
            <Button size="sm" variant="ghost" onClick={() => { setActiveId(null); setDraft(""); }} data-testid="button-new-chat">
              <Plus className="h-3.5 w-3.5 mr-1" /> New chat
            </Button>
            <select
              className="flex-1 text-xs bg-transparent border rounded px-2 py-1"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value ? Number(e.target.value) : null)}
              data-testid="select-chat-conversation"
            >
              <option value="">— New conversation —</option>
              {(conversations.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.title || "Untitled"}</option>
              ))}
            </select>
            {activeId && (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(activeId)} aria-label="Delete conversation">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1 px-4 py-3">
            <div ref={scrollRef} className="space-y-3">
              {!activeId && items.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground space-y-2">
                  <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p>Ask anything about your restaurant — top sellers, low margin items, inactive customers, stock to reorder, recent reviews.</p>
                  <div className="grid gap-1.5 pt-2 text-left max-w-xs mx-auto">
                    {[
                      "What were our top 5 selling items last week?",
                      "Which customers haven't ordered in 60 days?",
                      "Draft a Diwali promo SMS for repeat customers.",
                    ].map((s) => (
                      <button
                        key={s}
                        className="text-xs text-left rounded border px-2 py-1.5 hover:bg-accent"
                        onClick={() => setDraft(s)}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {items.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              {send.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3 space-y-2">
            <Textarea
              rows={3}
              placeholder="Ask about your data, draft copy, anything…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              }}
              data-testid="input-chat-message"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Balance: {wallet.data?.balance ?? 0} credits</span>
              <Button size="sm" onClick={submit} disabled={send.isPending || !draft.trim()} data-testid="button-send-chat">
                <Send className="h-3.5 w-3.5 mr-1.5" /> Send
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
        data-testid={`chat-bubble-${message.role}`}
      >
        <div>{message.content}</div>
        {!isUser && Array.isArray(message.toolCalls) && message.toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
            {message.toolCalls.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Wrench className="h-3 w-3" />
                <span>{t.name}</span>
                {t.error && <span className="text-destructive">— {t.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

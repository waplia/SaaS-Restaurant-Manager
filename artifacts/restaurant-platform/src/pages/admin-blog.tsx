import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiFetch, apiAction, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Pencil, Trash2, Eye, EyeOff } from "lucide-react";

interface BlogPost {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImage: string | null;
  category: string;
  tags: string | null;
  author: string;
  readMinutes: number;
  published: boolean;
  publishedAt: string;
  createdAt: string;
}

const EMPTY: Partial<BlogPost> = {
  slug: "",
  title: "",
  excerpt: "",
  content: "",
  coverImage: "",
  category: "guides",
  tags: "",
  author: "TableTrack Team",
  readMinutes: 5,
  published: true,
};

export default function AdminBlogPage() {
  const [editing, setEditing] = useState<Partial<BlogPost> | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ["admin-blog-posts"],
    queryFn: () => apiFetch<BlogPost[]>("/admin/blog/posts"),
  });

  const save = useMutation({
    mutationFn: async (p: Partial<BlogPost>) => {
      if (p.id) {
        return apiAction<BlogPost>(`/admin/blog/posts/${p.id}`, "PATCH", p);
      }
      return apiAction<BlogPost>(`/admin/blog/posts`, "POST", p);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      toast({ title: "Saved" });
      setEditing(null);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/blog/posts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      toast({ title: "Post deleted" });
      setDeleteId(null);
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Blog posts</h1>
              <p className="text-sm text-muted-foreground">Publish and manage articles shown on the marketing blog.</p>
            </div>
          </div>
          <Button onClick={() => setEditing({ ...EMPTY })} data-testid="button-new-post">
            <Plus className="w-4 h-4 mr-2" /> New post
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center text-muted-foreground">Loading posts…</div>
            ) : posts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No posts yet. Click <strong>New post</strong> to start.</div>
            ) : (
              <div className="divide-y">
                {posts.map((p) => (
                  <div key={p.id} className="p-4 flex items-center gap-3" data-testid={`row-post-${p.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold truncate">{p.title}</div>
                        <Badge variant={p.published ? "default" : "outline"} className="text-xs">
                          {p.published ? <><Eye className="w-3 h-3 mr-1" />Published</> : <><EyeOff className="w-3 h-3 mr-1" />Draft</>}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">{p.category}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        /{p.slug} · {p.author} · {p.readMinutes} min read · {new Date(p.publishedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(p)} data-testid={`button-edit-${p.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)} data-testid={`button-delete-${p.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <PostEditor
          post={editing}
          onClose={() => setEditing(null)}
          onSave={(p) => save.mutate(p)}
          saving={save.isPending}
        />

        <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this post?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && del.mutate(deleteId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-delete-confirm"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}

function PostEditor({
  post,
  onClose,
  onSave,
  saving,
}: {
  post: Partial<BlogPost> | null;
  onClose: () => void;
  onSave: (p: Partial<BlogPost>) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Partial<BlogPost>>(post ?? EMPTY);

  useEffect(() => {
    if (post) setDraft(post);
  }, [post?.id]);

  return (
    <Dialog
      open={!!post}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit post" : "New post"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Title" value={draft.title ?? ""} onChange={(v) => setDraft({ ...draft, title: v })} testId="input-post-title" required />
            <LabeledInput label="Slug" value={draft.slug ?? ""} onChange={(v) => setDraft({ ...draft, slug: v })} testId="input-post-slug" required />
            <LabeledInput label="Author" value={draft.author ?? ""} onChange={(v) => setDraft({ ...draft, author: v })} testId="input-post-author" />
            <LabeledInput label="Category" value={draft.category ?? ""} onChange={(v) => setDraft({ ...draft, category: v })} testId="input-post-category" />
            <LabeledInput label="Tags (comma separated)" value={draft.tags ?? ""} onChange={(v) => setDraft({ ...draft, tags: v })} testId="input-post-tags" />
            <LabeledInput
              label="Read minutes"
              type="number"
              value={String(draft.readMinutes ?? 5)}
              onChange={(v) => setDraft({ ...draft, readMinutes: Number(v) || 5 })}
              testId="input-post-read-minutes"
            />
            <div className="col-span-2">
              <LabeledInput label="Cover image URL" value={draft.coverImage ?? ""} onChange={(v) => setDraft({ ...draft, coverImage: v })} testId="input-post-cover" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Excerpt</label>
            <Textarea
              value={draft.excerpt ?? ""}
              onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
              rows={2}
              data-testid="textarea-post-excerpt"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Content (markdown)</label>
            <Textarea
              value={draft.content ?? ""}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={16}
              className="font-mono text-sm"
              data-testid="textarea-post-content"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.published ?? true}
              onCheckedChange={(c) => setDraft({ ...draft, published: c })}
              data-testid="switch-post-published"
            />
            <span className="text-sm">Published (visible on marketing site)</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-editor-cancel">Cancel</Button>
          <Button
            onClick={() => onSave(draft)}
            disabled={saving || !draft.title || !draft.slug || !draft.content}
            data-testid="button-editor-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  testId,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  testId?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} data-testid={testId} />
    </div>
  );
}

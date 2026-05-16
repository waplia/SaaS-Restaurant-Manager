import { useParams } from "wouter";
import NotFound from "@/pages/not-found";
import { AIPage } from "@/components/templates/AIPage";
import { AI_CONTENT } from "@/content/ai";

export default function AIBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const content = slug ? AI_CONTENT[slug] : undefined;
  if (!content) return <NotFound />;
  return <AIPage content={content} />;
}

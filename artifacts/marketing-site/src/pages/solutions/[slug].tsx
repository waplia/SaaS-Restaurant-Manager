import { useParams } from "wouter";
import NotFound from "@/pages/not-found";
import { SolutionPage } from "@/components/templates/SolutionPage";
import { SOLUTION_CONTENT } from "@/content/solutions";

export default function SolutionBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const content = slug ? SOLUTION_CONTENT[slug] : undefined;
  if (!content) return <NotFound />;
  return <SolutionPage content={content} />;
}

import { useParams } from "wouter";
import NotFound from "@/pages/not-found";
import { FeaturePage } from "@/components/templates/FeaturePage";
import { FEATURE_CONTENT } from "@/content/features";

export default function FeatureBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const content = slug ? FEATURE_CONTENT[slug] : undefined;
  if (!content) return <NotFound />;
  return <FeaturePage content={content} />;
}

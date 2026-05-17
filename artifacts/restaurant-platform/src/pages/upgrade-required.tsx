import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Lock, ArrowRight, Mail } from "lucide-react";
import {
  PLAN_BOOLEAN_FEATURES,
  PLAN_FEATURE_CATEGORIES,
  findFeatureByHref,
  type PlanBooleanFeature,
} from "@workspace/db/planFeatures";

interface UpgradeRequiredPageProps {
  /** Catalogue feature key being gated. */
  featureKey?: string;
}

/**
 * Placeholder screen rendered for the 50 advanced-pack routes registered in
 * Task #365 before the real domain pages exist. Renders the catalogue label,
 * description, related features in the same category, and a CTA to the
 * subscription page so tenant owners can request the upgrade.
 *
 * Resolves the feature in this order:
 *   1. Explicit `featureKey` prop (when used as a wrapper)
 *   2. The current location matched against `PlanBooleanFeature.sidebarHref`
 */
export default function UpgradeRequiredPage({ featureKey }: UpgradeRequiredPageProps = {}) {
  const [location] = useLocation();

  const feature: PlanBooleanFeature | undefined = useMemo(() => {
    if (featureKey) return PLAN_BOOLEAN_FEATURES.find((f) => f.key === featureKey);
    return findFeatureByHref(location);
  }, [featureKey, location]);

  const title = feature?.label ?? "Upgrade required";
  const description = feature?.description ?? "This module is part of an advanced plan and isn't included in your current subscription.";

  const categoryLabel = feature
    ? PLAN_FEATURE_CATEGORIES.find((c) => c.key === feature.category)?.label
    : undefined;

  const siblingFeatures = useMemo(() => {
    if (!feature) return [];
    return PLAN_BOOLEAN_FEATURES
      .filter((f) => f.category === feature.category && f.key !== feature.key)
      .slice(0, 6);
  }, [feature]);

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={title} description={categoryLabel ? `${categoryLabel} · Upgrade required` : "Upgrade required"} icon={Sparkles} />

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Card className="border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20">
          <CardContent className="p-6 md:p-8 flex items-start gap-4">
            <span className="flex-shrink-0 w-12 h-12 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">Plan upgrade needed</p>
              <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2">{title}</h2>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{description}</p>
              {feature?.key && (
                <p className="text-xs text-muted-foreground mt-3">
                  Feature key: <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{feature.key}</code>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-foreground">How to unlock this</h3>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
              <li>The tenant owner opens <Link href="/pricing" className="text-primary font-medium hover:underline">Plans &amp; Pricing</Link>.</li>
              <li>Upgrade to a plan that includes this module, or add it from the marketplace.</li>
              <li>Refresh this page — the module will appear in the sidebar automatically.</li>
            </ol>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/pricing">
                <Button className="gap-2">View plans &amp; upgrade <ArrowRight className="w-4 h-4" /></Button>
              </Link>
              <Link href="/support">
                <Button variant="outline" className="gap-2"><Mail className="w-4 h-4" /> Contact support</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {siblingFeatures.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold text-foreground mb-3">Also in {categoryLabel}</h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {siblingFeatures.map((f) => (
                  <li key={f.key} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <p className="text-sm font-medium text-foreground">{f.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-tight">{f.description}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

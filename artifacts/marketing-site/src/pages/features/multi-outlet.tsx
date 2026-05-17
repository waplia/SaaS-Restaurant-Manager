import { FeaturePage } from "@/components/templates/FeaturePage";
import { FEATURE_CONTENT } from "@/content/features";

export default function MultiOutlet() {
  return <FeaturePage content={FEATURE_CONTENT["multi-outlet"]} />;
}

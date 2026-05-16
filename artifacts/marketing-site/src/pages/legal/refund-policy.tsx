import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "overview", title: "1. Overview", body: (
    <p>This Refund Policy describes when and how {COMPANY.legalName} processes refunds for the <strong>{COMPANY.product}</strong> platform, AI credits, hardware and professional services.</p>
  )},
  { id: "subscription", title: "2. Subscription fees", body: (
    <p>Subscription fees are billed in advance for monthly or annual terms. We do not provide pro-rated refunds for partial periods after the cancellation date, except where required by law. You may cancel at any time and continue using the service until the end of the paid period.</p>
  )},
  { id: "trial", title: "3. Free trial & first invoice", body: (
    <p>If a paid subscription begins immediately after a free trial and you are dissatisfied within 7 days of the first invoice, contact <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> — we will review and process a goodwill refund where appropriate.</p>
  )},
  { id: "ai-credits", title: "4. AI credits", body: (
    <p>Unused AI credits are non-refundable but do not expire so long as the account remains active. Credits are non-transferable across accounts.</p>
  )},
  { id: "hardware", title: "5. Hardware", body: (
    <p>Hardware (printers, scanners, terminals, KDS screens) carries the manufacturer's warranty. Defective hardware reported within 7 days of delivery will be replaced or refunded. Used hardware in good condition can be returned within 14 days for a refund minus return shipping and a restocking fee where applicable.</p>
  )},
  { id: "services", title: "6. Professional services", body: (
    <p>Onboarding, custom integrations and training are billed per scope. Once delivery has commenced, professional services fees are non-refundable. Unused pre-paid days may be re-scheduled.</p>
  )},
  { id: "duplicate", title: "7. Duplicate or erroneous charges", body: (
    <p>If you are charged twice or charged in error, write to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> within 30 days with proof. We will refund the duplicate or erroneous amount to the original payment method within 7–14 business days.</p>
  )},
  { id: "downgrades", title: "8. Plan downgrades", body: (
    <p>You may downgrade your plan at any time. The new pricing takes effect from the next billing cycle. We do not refund the difference for the current billing cycle.</p>
  )},
  { id: "method", title: "9. Method & timing", body: (
    <p>Approved refunds are issued to the original payment method. Bank settlement times vary (typically 5–10 business days after the refund is initiated).</p>
  )},
  { id: "disputes", title: "10. Disputes", body: (
    <p>If you disagree with a refund decision, contact us within 30 days to escalate. We aim to resolve disputes fairly and promptly.</p>
  )},
  { id: "contact", title: "11. Contact", body: (
    <p>Refund queries: <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> · {COMPANY.phoneDisplay} · {COMPANY.legalName}, {COMPANY.fullAddress}.</p>
  )},
];

export default function RefundPolicy() {
  return (
    <LegalPageLayout
      title="Refund Policy"
      lastUpdated="January 2026"
      intro={<>When and how {COMPANY.legalName} processes refunds for {COMPANY.product} subscriptions, AI credits, hardware and services.</>}
      seoDescription={`Refund Policy for ${COMPANY.product} subscriptions, AI credits, hardware and services.`}
      sections={sections}
    />
  );
}

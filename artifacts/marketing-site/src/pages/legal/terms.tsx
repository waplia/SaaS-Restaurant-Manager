import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "agreement", title: "1. Your agreement", body: (
    <p>These Terms & Conditions ("Terms") form a binding agreement between you (the "Customer") and {COMPANY.legalName} ("{COMPANY.legalShortName}"), governing your access to and use of the <strong>{COMPANY.product}</strong> platform, website and related services.</p>
  )},
  { id: "account", title: "2. Account & eligibility", body: (
    <p>To use {COMPANY.product} you must be at least 18 years old and authorized to bind the business you represent. You are responsible for maintaining the security of your account, devices and login credentials and for all activity under your account.</p>
  )},
  { id: "license", title: "3. License & permitted use", body: (
    <p>Subject to these Terms, {COMPANY.legalShortName} grants you a limited, non-exclusive, non-transferable, revocable license to use {COMPANY.product} for the lawful operation of your food and hospitality business during your active subscription.</p>
  )},
  { id: "fees", title: "4. Fees & payment", body: (
    <p>Subscription fees, AI credits, hardware and add-ons are billed according to your plan. Fees are exclusive of applicable taxes. Late payments may result in suspension of service after reasonable notice.</p>
  )},
  { id: "your-data", title: "5. Your data", body: (
    <p>You retain ownership of all data you upload to {COMPANY.product}. You grant {COMPANY.legalShortName} the limited rights needed to operate the service for you (host, back-up, transmit, secure, support).</p>
  )},
  { id: "acceptable-use", title: "6. Acceptable use", body: (
    <p>You agree not to misuse the platform — see our Acceptable Use Policy. This includes, without limitation, no spamming, no scraping, no reverse-engineering, no unlawful content and no use that harms restaurants, their staff or customers.</p>
  )},
  { id: "uptime", title: "7. Service availability", body: (
    <p>We work hard to keep {COMPANY.product} fast and reliable, but we do not guarantee uninterrupted service. We may perform scheduled maintenance and will provide reasonable notice where possible.</p>
  )},
  { id: "third-party", title: "8. Third-party services", body: (
    <p>The platform integrates with third-party services (e.g. aggregators, payment gateways, communication providers). {COMPANY.legalShortName} is not responsible for outages, errors or policy changes in third-party services.</p>
  )},
  { id: "ip", title: "9. Intellectual property", body: (
    <p>All software, designs, logos and content of {COMPANY.product} are the intellectual property of {COMPANY.legalName} or its licensors. You receive a license — not ownership — to use them.</p>
  )},
  { id: "confidentiality", title: "10. Confidentiality", body: (
    <p>Each party will protect the other's confidential information using reasonable care and use it only to perform under these Terms.</p>
  )},
  { id: "warranties", title: "11. Warranty disclaimer", body: (
    <p>To the maximum extent permitted by law, {COMPANY.product} is provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement.</p>
  )},
  { id: "liability", title: "12. Limitation of liability", body: (
    <p>To the maximum extent permitted by law, {COMPANY.legalShortName} is not liable for indirect, incidental, special, consequential or punitive damages. Our total liability for any claim is limited to the fees you paid to {COMPANY.legalShortName} for the three months preceding the event giving rise to the claim.</p>
  )},
  { id: "termination", title: "13. Termination", body: (
    <p>You may cancel your subscription at any time. We may suspend or terminate access for material breach, fraud or risk to the platform. Sections that by their nature should survive termination will survive.</p>
  )},
  { id: "law", title: "14. Governing law", body: (
    <p>These Terms are governed by the laws of India. Courts located in {COMPANY.city}, {COMPANY.region} will have exclusive jurisdiction over any dispute, subject to applicable consumer protection laws.</p>
  )},
  { id: "changes", title: "15. Changes", body: (
    <p>We may update these Terms from time to time. Material changes will be notified by email or in-app. Continued use after the effective date of changes constitutes acceptance.</p>
  )},
  { id: "contact", title: "16. Contact", body: (
    <p>Questions? Write to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> or {COMPANY.legalName}, {COMPANY.fullAddress}.</p>
  )},
];

export default function Terms() {
  return (
    <LegalPageLayout
      title="Terms & Conditions"
      lastUpdated="January 2026"
      intro={<>The rules governing your use of {COMPANY.product} by {COMPANY.legalName}.</>}
      seoDescription={`Terms & Conditions governing your use of the ${COMPANY.product} platform and services.`}
      sections={sections}
    />
  );
}

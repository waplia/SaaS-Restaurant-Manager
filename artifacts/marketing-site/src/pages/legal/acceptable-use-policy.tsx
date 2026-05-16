import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "purpose", title: "1. Purpose", body: (
    <p>This Acceptable Use Policy ("AUP") describes activities prohibited on <strong>{COMPANY.product}</strong>. It supplements the Terms & Conditions and applies to all users, accounts and integrations.</p>
  )},
  { id: "no-illegal", title: "2. No illegal activity", body: (
    <p>Do not use {COMPANY.product} to violate any applicable law, regulation or third-party right — including tax, labour, food-safety, consumer-protection and data-protection laws.</p>
  )},
  { id: "no-abuse", title: "3. No abuse or harm", body: (
    <ul>
      <li>No harassing, threatening, defamatory or hateful behaviour toward staff, customers or third parties.</li>
      <li>No content that exploits minors or facilitates human trafficking.</li>
      <li>No use that endangers the health or safety of customers or workers.</li>
    </ul>
  )},
  { id: "no-spam", title: "4. No spam", body: (
    <p>Communications sent through {COMPANY.product} (SMS, WhatsApp, email, push) must comply with applicable anti-spam laws and platform policies. Build your contact lists with consent. Honour opt-outs immediately.</p>
  )},
  { id: "no-attacks", title: "5. No security attacks", body: (
    <ul>
      <li>No probing, scanning or testing the platform without prior written permission.</li>
      <li>No attempts to bypass authentication, rate limits or quotas.</li>
      <li>No reverse-engineering, decompilation or extraction of source code.</li>
      <li>No introduction of malware, ransomware or destructive code.</li>
    </ul>
  )},
  { id: "no-scraping", title: "6. No scraping or excessive load", body: (
    <p>Do not scrape, mirror or harvest data from the platform. Do not generate load that disrupts service for other customers. Use our official APIs and respect documented rate limits.</p>
  )},
  { id: "no-fraud", title: "7. No fraud", body: (
    <p>No fake orders, fake reviews, manipulation of loyalty/reward systems, or any other fraudulent activity. We may suspend accounts engaged in suspected fraud pending investigation.</p>
  )},
  { id: "ai-use", title: "8. AI features", body: (
    <p>Khana AI tools must not be used to generate misleading reviews, impersonate real people, defame competitors, or produce content that violates this AUP, Terms or applicable law.</p>
  )},
  { id: "reporting", title: "9. Reporting abuse", body: (
    <p>Report suspected violations to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>. Include URLs, screenshots and any other evidence to help us investigate.</p>
  )},
  { id: "enforcement", title: "10. Enforcement", body: (
    <p>We may warn, throttle, suspend or terminate accounts that violate this AUP. We may also notify and cooperate with law-enforcement authorities where required by law.</p>
  )},
  { id: "contact", title: "11. Contact", body: (
    <p>Questions: <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> · {COMPANY.legalName}, {COMPANY.fullAddress}.</p>
  )},
];

export default function AUP() {
  return (
    <LegalPageLayout
      title="Acceptable Use Policy"
      lastUpdated="January 2026"
      intro={<>What's allowed — and what isn't — on {COMPANY.product}.</>}
      seoDescription={`Acceptable Use Policy (AUP) for ${COMPANY.product} by ${COMPANY.legalName}.`}
      sections={sections}
    />
  );
}

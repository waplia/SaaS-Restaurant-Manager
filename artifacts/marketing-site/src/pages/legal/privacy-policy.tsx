import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "intro", title: "1. Introduction", body: (
    <p>{COMPANY.legalName} ("{COMPANY.legalShortName}", "we", "us"), the company behind <strong>{COMPANY.product}</strong>, is committed to protecting the privacy of restaurants, their staff and their customers. This Privacy Policy explains what data we collect, why we collect it, how we use it, and the choices you have. By using {COMPANY.product} you agree to this Policy.</p>
  )},
  { id: "data-we-collect", title: "2. Data we collect", body: (
    <>
      <p>We collect only the data we need to run the platform.</p>
      <ul>
        <li><strong>Account data</strong> — business name, owner/admin name, email, phone, GSTIN.</li>
        <li><strong>Operational data</strong> — outlets, menus, orders, inventory, staff, payments, expenses, reports.</li>
        <li><strong>Customer data</strong> — when you record customer name, phone, email, address or preferences in your CRM.</li>
        <li><strong>Usage data</strong> — device, browser, IP, pages visited, features used and timestamps.</li>
        <li><strong>Support data</strong> — messages, calls and screenshots you share with our support team.</li>
      </ul>
    </>
  )},
  { id: "how-we-use", title: "3. How we use data", body: (
    <ul>
      <li>To operate, secure, and improve the {COMPANY.product} platform.</li>
      <li>To provide onboarding, training, customer support and incident response.</li>
      <li>To send service updates, security notices and (optionally) marketing communications.</li>
      <li>To comply with tax, accounting and legal obligations.</li>
      <li>To detect, prevent and investigate fraud, abuse and security issues.</li>
    </ul>
  )},
  { id: "legal-basis", title: "4. Legal basis", body: (
    <p>We process personal data on the basis of (a) the contract with your business, (b) our legitimate interest in running and improving the platform, (c) compliance with legal obligations and (d) your consent — where required by applicable law.</p>
  )},
  { id: "sharing", title: "5. Sharing & sub-processors", body: (
    <>
      <p>We do not sell your data. We share data only with carefully vetted sub-processors that help us operate the platform:</p>
      <ul>
        <li>Cloud hosting and database providers.</li>
        <li>Payment gateways and aggregator integrations you choose to enable.</li>
        <li>Communication providers (SMS, WhatsApp, email, push) used to deliver messages on your behalf.</li>
        <li>Analytics and error-monitoring tools that help us improve reliability.</li>
      </ul>
      <p>An up-to-date list of sub-processors is available on request to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
    </>
  )},
  { id: "retention", title: "6. Retention", body: (
    <p>We retain operational data for as long as your account is active and for a reasonable period thereafter to meet legal, accounting and audit requirements. You can request earlier deletion subject to applicable law and our retention schedule.</p>
  )},
  { id: "security", title: "7. Security", body: (
    <p>We use industry-standard safeguards: TLS in transit, encryption at rest, role-based access, least-privilege controls, audit logs, regular backups and incident response procedures. No system is perfectly secure, but we work hard to protect your data.</p>
  )},
  { id: "your-rights", title: "8. Your rights", body: (
    <p>Subject to applicable law, you may request access, correction, deletion, export or restriction of your personal data. To exercise any right, email <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> with sufficient information to verify your identity.</p>
  )},
  { id: "international", title: "9. International transfers", body: (
    <p>Your data is primarily stored in India. Where data is processed outside India by a sub-processor, we use appropriate safeguards such as standard contractual clauses.</p>
  )},
  { id: "children", title: "10. Children", body: (
    <p>{COMPANY.product} is built for businesses and is not directed at children under 18. We do not knowingly collect data from minors.</p>
  )},
  { id: "changes", title: "11. Changes to this policy", body: (
    <p>We will post any material changes to this Policy on this page and update the "last updated" date. Continued use after changes constitutes acceptance.</p>
  )},
  { id: "contact", title: "12. Contact", body: (
    <p>Questions about this Policy? Write to <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a> or contact {COMPANY.legalName}, {COMPANY.fullAddress}, phone {COMPANY.phoneDisplay}.</p>
  )},
];

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated="January 2026"
      intro={<>How {COMPANY.legalName} collects, uses and protects data on the {COMPANY.product} platform.</>}
      seoDescription={`Privacy Policy for ${COMPANY.product}. Learn what data we collect, how we use it, and your rights.`}
      sections={sections}
    />
  );
}

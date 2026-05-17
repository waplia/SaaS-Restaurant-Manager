import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "parties", title: "1. Parties & purpose", body: (
    <p>This Data Processing Agreement ("DPA") forms part of the Terms between the Customer ("Controller") and {COMPANY.legalName} ("Processor"). It governs Processor's processing of personal data on behalf of Controller in connection with <strong>{COMPANY.product}</strong>.</p>
  )},
  { id: "subject", title: "2. Subject matter & duration", body: (
    <p>Processor processes personal data solely to provide the {COMPANY.product} service. Processing continues for the term of the Terms and any wind-down period required by law.</p>
  )},
  { id: "nature", title: "3. Nature of processing", body: (
    <ul>
      <li>Storage, hosting, backup, transmission and display.</li>
      <li>Operation of POS, ordering, kitchen, inventory, staff, finance, growth and AI features.</li>
      <li>Customer support and incident response when initiated by Controller.</li>
    </ul>
  )},
  { id: "categories", title: "4. Categories of data & data subjects", body: (
    <ul>
      <li>Controller's staff: name, contact, role, attendance, payroll and access logs.</li>
      <li>Controller's end customers: name, contact, addresses, order history, preferences (only as captured by Controller).</li>
      <li>Operational data: orders, menus, inventory, expenses, payments and reports.</li>
    </ul>
  )},
  { id: "obligations", title: "5. Processor obligations", body: (
    <ul>
      <li>Process personal data only on Controller's documented instructions.</li>
      <li>Ensure personnel are bound by confidentiality.</li>
      <li>Implement appropriate technical and organizational measures.</li>
      <li>Assist Controller with data-subject requests and security obligations.</li>
      <li>Notify Controller without undue delay of any personal data breach.</li>
    </ul>
  )},
  { id: "subprocessors", title: "6. Sub-processors", body: (
    <p>Processor uses vetted sub-processors (hosting, communications, analytics, payments). A current list is available on request. Processor will provide reasonable prior notice of any new sub-processor and the opportunity to object on reasonable grounds.</p>
  )},
  { id: "transfers", title: "7. International transfers", body: (
    <p>Where personal data is transferred outside India, Processor uses appropriate safeguards (e.g., standard contractual clauses) and equivalent contractual protections with sub-processors.</p>
  )},
  { id: "security", title: "8. Security measures", body: (
    <ul>
      <li>TLS encryption in transit; AES-256 encryption at rest.</li>
      <li>Role-based access control and least-privilege defaults.</li>
      <li>Network segmentation, audit logs and continuous monitoring.</li>
      <li>Regular backups and tested disaster-recovery procedures.</li>
      <li>Security training for all personnel.</li>
    </ul>
  )},
  { id: "audit", title: "9. Audit", body: (
    <p>Processor will make available, on request, information necessary to demonstrate compliance with this DPA, including SOC-style summaries, sub-processor list and security documentation. On-site audits may be arranged on reasonable notice and at Controller's cost.</p>
  )},
  { id: "deletion", title: "10. Return & deletion", body: (
    <p>On termination, Processor will, at Controller's choice, delete or return personal data (and copies) unless retention is required by law.</p>
  )},
  { id: "liability", title: "11. Liability", body: (
    <p>Each party's liability under this DPA is subject to the limits of liability in the Terms.</p>
  )},
  { id: "contact", title: "12. Contact", body: (
    <p>To execute a counter-signed DPA or for any questions, contact <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
  )},
];

export default function DPA() {
  return (
    <LegalPageLayout
      title="Data Processing Agreement"
      lastUpdated="January 2026"
      intro={<>Our standard DPA for enterprise and chain customers using {COMPANY.product}.</>}
      seoDescription={`Data Processing Agreement (DPA) for ${COMPANY.product} — how we process customer personal data on your behalf.`}
      sections={sections}
    />
  );
}

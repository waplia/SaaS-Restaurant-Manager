import { LegalPageLayout, type LegalSection } from "@/components/shared/LegalPageLayout";
import { COMPANY } from "@/lib/company";

const sections: LegalSection[] = [
  { id: "what", title: "1. What are cookies?", body: (
    <p>Cookies are small text files placed on your device by a website. They help us remember your preferences, keep you signed in, secure the platform and measure how it is used.</p>
  )},
  { id: "we-use", title: "2. Cookies we use", body: (
    <ul>
      <li><strong>Strictly necessary</strong> — for authentication, session management, fraud prevention and load balancing. Cannot be disabled.</li>
      <li><strong>Functional</strong> — remember preferences such as language and theme.</li>
      <li><strong>Analytics</strong> — measure aggregated, anonymized usage so we can improve the product.</li>
      <li><strong>Marketing</strong> — only on the public marketing site, and only with your consent where required by law.</li>
    </ul>
  )},
  { id: "third-party", title: "3. Third-party cookies", body: (
    <p>Some embedded services (video players, support chat, social embeds) may set their own cookies. Their use is governed by the respective third-party privacy policies.</p>
  )},
  { id: "control", title: "4. Your choices", body: (
    <p>Most browsers let you block or delete cookies. Blocking strictly-necessary cookies will break essential features such as login. We honour Global Privacy Control signals where applicable.</p>
  )},
  { id: "do-not-track", title: "5. Do Not Track", body: (
    <p>We do not currently respond to browser "Do Not Track" signals, but we honour cookie consent choices you make on our consent banner.</p>
  )},
  { id: "changes", title: "6. Changes", body: (
    <p>We may update this Cookie Policy from time to time. Material changes will be notified in-app or by email.</p>
  )},
  { id: "contact", title: "7. Contact", body: (
    <p>Cookie or tracking questions: <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.</p>
  )},
];

export default function CookiePolicy() {
  return (
    <LegalPageLayout
      title="Cookie Policy"
      lastUpdated="January 2026"
      intro={<>How {COMPANY.product} by {COMPANY.legalName} uses cookies and similar technologies.</>}
      seoDescription={`Cookie Policy for ${COMPANY.product}. Learn what cookies we use and how to control them.`}
      sections={sections}
    />
  );
}

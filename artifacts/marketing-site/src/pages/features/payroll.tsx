import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function Payroll() {
  useSeo({
    title: "Staff & Payroll",
    description: "Manage shifts, calculate wages, and track staff performance.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "KhanaLagao Payroll",
      "description": "Manage shifts, calculate wages, and track staff performance."
    }
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-8 md:space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">Staff & Payroll</h1>
              <p className="text-base md:text-xl text-muted-foreground">Keep your team happy and your labor costs in check.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>Simplify scheduling and ensure accurate paychecks. KhanaLagao makes team management effortless.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Time & Attendance:</strong> Clock in/out directly from the POS.</li>
                <li><strong>Shift Scheduling:</strong> Build and share schedules in minutes.</li>
                <li><strong>Labor Cost Tracking:</strong> Monitor your labor percentage in real-time.</li>
                <li><strong>Tip Pooling:</strong> Distribute tips fairly and automatically.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Simplify your team management</h3>
              <LeadForm source="feature_payroll" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

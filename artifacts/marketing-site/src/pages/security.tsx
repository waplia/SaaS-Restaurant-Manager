import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Shield, Lock, Server, CheckCircle2 } from "lucide-react";

export default function Security() {
  useSeo({
    title: "Security & Compliance",
    description: "Enterprise-grade security to protect your business and your customers' data.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-16">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
                <Shield className="w-8 h-8" />
              </div>
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Built on trust.</h1>
              <p className="text-xl text-muted-foreground">We protect your data with the same rigor you protect your recipes.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-6 bg-card border border-border rounded-2xl">
                <Lock className="w-8 h-8 text-primary mb-4" />
                <h3 className="text-xl font-bold mb-2">End-to-End Encryption</h3>
                <p className="text-muted-foreground">All data is encrypted in transit and at rest using industry-standard protocols.</p>
              </div>
              <div className="p-6 bg-card border border-border rounded-2xl">
                <CheckCircle2 className="w-8 h-8 text-primary mb-4" />
                <h3 className="text-xl font-bold mb-2">PCI Compliant</h3>
                <p className="text-muted-foreground">We partner with top-tier gateways to ensure all payments are fully secure.</p>
              </div>
              <div className="p-6 bg-card border border-border rounded-2xl">
                <Server className="w-8 h-8 text-primary mb-4" />
                <h3 className="text-xl font-bold mb-2">Automated Backups</h3>
                <p className="text-muted-foreground">Your data is continuously backed up across multiple geographical regions.</p>
              </div>
            </div>

            <div className="prose prose-lg dark:prose-invert max-w-none">
              <h3>GDPR & Data Privacy</h3>
              <p>We respect your privacy and that of your customers. Khana Lagao is fully compliant with GDPR and CCPA regulations, providing you with the tools to handle data requests effortlessly.</p>
              
              <h3>Uptime Guarantee</h3>
              <p>We boast a 99.99% uptime SLA. Our offline mode ensures your POS continues to function even if your local internet connection fails.</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

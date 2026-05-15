import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LeadForm } from "@/components/LeadForm";
import { Mail, Phone, MapPin } from "lucide-react";

export default function Contact() {
  useSeo({
    title: "Contact Us",
    description: "Get in touch with the Khana Lagao team.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div>
              <h1 className="font-serif text-4xl md:text-5xl font-bold tracking-tight mb-6">Get in touch</h1>
              <p className="text-xl text-muted-foreground mb-12">
                Whether you have a question about features, pricing, or anything else, our team is ready to answer all your questions.
              </p>
              
              <div className="space-y-8">
                <div className="flex items-start">
                  <Mail className="w-6 h-6 text-primary mt-1 mr-4" />
                  <div>
                    <h3 className="font-bold text-lg">Email us</h3>
                    <p className="text-muted-foreground">hello@tabletrack.com</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <Phone className="w-6 h-6 text-primary mt-1 mr-4" />
                  <div>
                    <h3 className="font-bold text-lg">Call us</h3>
                    <p className="text-muted-foreground">+1 (800) 123-4567</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <MapPin className="w-6 h-6 text-primary mt-1 mr-4" />
                  <div>
                    <h3 className="font-bold text-lg">Visit us</h3>
                    <p className="text-muted-foreground">123 Tech Kitchen Blvd<br/>San Francisco, CA 94105</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-xl">
              <h2 className="text-2xl font-bold font-serif mb-6">Send a message</h2>
              <LeadForm source="contact" buttonText="Send Message" showMessage />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

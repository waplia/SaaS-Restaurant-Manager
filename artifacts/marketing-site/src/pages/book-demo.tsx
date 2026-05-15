import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LeadForm } from "@/components/LeadForm";

export default function BookDemo() {
  useSeo({
    title: "Book a Demo",
    description: "Schedule a personalized demo of TableTrack with our restaurant experts.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div className="space-y-8">
              <div>
                <h1 className="font-serif text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
                  See TableTrack in action
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  Join a 30-minute walkthrough tailored to your restaurant's specific needs. Learn how you can streamline operations, reduce costs, and delight your guests.
                </p>
              </div>

              <div className="space-y-6">
                <h3 className="font-bold text-xl font-serif">What to expect:</h3>
                <ul className="space-y-4">
                  {[
                    "A brief discussion about your current operations and challenges",
                    "Live product demonstration of relevant features",
                    "Deep dive into POS, inventory, or analytics based on your needs",
                    "Q&A session with a hospitality tech expert",
                    "Pricing overview tailored to your venue size"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center mr-3 mt-0.5">
                        <span className="text-sm font-bold">{i + 1}</span>
                      </div>
                      <span className="text-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <div className="bg-card border border-border p-8 rounded-2xl shadow-xl">
                <h2 className="text-2xl font-bold font-serif mb-6">Schedule your session</h2>
                <LeadForm source="book_demo" buttonText="Request Demo" showDetails showMessage />
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
}

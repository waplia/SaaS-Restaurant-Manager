import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  company: z.string().optional(),
  restaurantType: z.string().optional(),
  outletCount: z.coerce.number().optional(),
  message: z.string().optional(),
  source: z.string(),
  website: z.string().max(0, "Bots only"), // honeypot
});

type LeadFormValues = z.infer<typeof formSchema>;

export function LeadForm({ source, buttonText = "Submit", showMessage = false, showDetails = false, redirectTo = "/thank-you" }: { source: string, buttonText?: string, showMessage?: boolean, showDetails?: boolean, redirectTo?: string | null }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      restaurantType: "",
      outletCount: undefined,
      message: "",
      source,
      website: "", // honeypot
    },
  });

  async function onSubmit(data: LeadFormValues) {
    if (data.website) return; // Silent reject for bots

    setIsPending(true);
    try {
      const payload = {
        name: data.name,
        email: data.email,
        phone: data.phone || undefined,
        restaurantName: data.company || undefined,
        businessType: data.restaurantType || undefined,
        outletCount: data.outletCount,
        message: data.message || undefined,
        sourcePage: data.source,
        website: data.website,
      };
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Failed to submit");

      setIsSuccess(true);
      toast({
        title: "Thanks — we got it!",
        description: "We've received your details and will be in touch shortly.",
      });
      if (redirectTo) {
        setTimeout(() => setLocation(redirectTo), 350);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="p-6 text-center border rounded-xl bg-primary/5 border-primary/20 space-y-4">
        <div className="mx-auto w-12 h-12 bg-primary/20 text-primary rounded-full flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h3 className="text-xl font-bold font-serif">Thank you!</h3>
        <p className="text-muted-foreground">We'll be in touch with you shortly.</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="hidden">
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} tabIndex={-1} autoComplete="off" />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Jane Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work Email *</FormLabel>
                <FormControl>
                  <Input placeholder="jane@restaurant.com" type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {showDetails && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Restaurant Name</FormLabel>
                    <FormControl>
                      <Input placeholder="The Golden Spoon" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="restaurantType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Restaurant Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="fine-dining">Fine Dining</SelectItem>
                        <SelectItem value="cafe">Cafe / Bakery</SelectItem>
                        <SelectItem value="qsr">Quick Service</SelectItem>
                        <SelectItem value="bar">Bar / Pub</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="outletCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Number of Locations</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" placeholder="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        )}

        {showMessage && (
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>How can we help?</FormLabel>
                <FormControl>
                  <Textarea placeholder="Tell us about your needs..." className="min-h-[100px]" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Button type="submit" className="w-full" disabled={isPending} data-testid="btn-submit-lead">
          {isPending ? "Submitting..." : buttonText}
        </Button>
      </form>
    </Form>
  );
}

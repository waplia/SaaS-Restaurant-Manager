import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";

export default function EventsPage() {
  return (
    <Layout>
      <PageHeader
        title="Events & Catering"
        subtitle="This module is being rebuilt — a richer Events & Catering workspace is coming soon."
      />
      <div className="rounded-lg border bg-card p-8 m-6 text-center text-sm text-muted-foreground">
        Events bookings, quotations, payments, staff and checklist management
        are temporarily unavailable. Existing booking data is preserved and
        will reappear once the rebuilt page ships.
      </div>
    </Layout>
  );
}

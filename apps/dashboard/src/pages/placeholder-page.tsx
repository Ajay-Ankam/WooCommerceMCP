import { Construction } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";

// Temporary route target while the remaining dashboard pages are built.
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={Construction} title="Not built yet" description="This page is part of the next dashboard milestone." />
      </Card>
    </>
  );
}

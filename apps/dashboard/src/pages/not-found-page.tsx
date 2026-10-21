import { Compass } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or was moved."
        action={
          <Link to="/" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Back to overview
          </Link>
        }
      />
    </div>
  );
}

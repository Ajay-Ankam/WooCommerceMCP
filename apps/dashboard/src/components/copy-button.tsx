import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";

// Copies to the clipboard only; the value is never logged or stored.
export function CopyButton({
  value,
  label = "Copy",
  showLabel = false,
  ...props
}: { value: string; label?: string; showLabel?: boolean } & Omit<ButtonProps, "onClick" | "value">) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }

  return (
    <Button variant="secondary" size={showLabel ? "sm" : "icon-sm"} aria-label={label} onClick={copy} {...props}>
      {copied ? <Check className="text-emerald-600" aria-hidden /> : <Copy aria-hidden />}
      {showLabel && (copied ? "Copied" : label)}
    </Button>
  );
}

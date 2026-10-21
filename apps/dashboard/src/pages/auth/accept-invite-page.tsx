import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { errorMessage, isApiError } from "@/lib/api";
import { useAcceptInvite } from "@/lib/queries";
import { AuthLayout, FormAlert } from "./auth-layout";

// Matches the gateway's MIN_PASSWORD_LENGTH (apps/gateway/src/auth/passwords.ts).
const MIN_PASSWORD_LENGTH = 10;

const inviteSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { path: ["confirm"], message: "Passwords do not match" });

type Errors = Partial<Record<"password" | "confirm", string>>;

export default function AcceptInvitePage() {
  const { token = "" } = useParams();
  const accept = useAcceptInvite();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = inviteSchema.safeParse({ password, confirm });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }

    setErrors({});
    // replace: the one-time token should not stay in browser history.
    accept.mutate({ token, password }, { onSuccess: () => navigate("/", { replace: true }) });
  }

  const failure = accept.error
    ? isApiError(accept.error, 400)
      ? "This invite link is invalid, already used, or expired. Ask your admin for a new one."
      : errorMessage(accept.error)
    : null;

  return (
    <AuthLayout title="Join your team" description="Choose a password to activate your account.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{failure}</FormAlert>

        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            aria-describedby="password-hint"
          />
          {errors.password ? (
            <FieldError id="password-hint">{errors.password}</FieldError>
          ) : (
            <p id="password-hint" className="text-xs text-zinc-500">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!errors.confirm || undefined}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
          />
          <FieldError id="confirm-error">{errors.confirm}</FieldError>
        </div>

        <Button type="submit" className="w-full" loading={accept.isPending}>
          Activate account
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-zinc-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

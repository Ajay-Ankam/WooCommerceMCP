import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { safeNext } from "@/auth/guards";
import { FullScreenLoader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { isApiError, loginErrorMessage } from "@/lib/api";
import { useLogin, useMe } from "@/lib/queries";
import { AuthLayout, FormAlert } from "./auth-layout";

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type Errors = Partial<Record<"email" | "password", string>>;

export default function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  if (me.isPending) {
    return <FullScreenLoader />;
  }

  if (me.data) {
    return <Navigate to={next} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email: email.trim(), password });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }

    setErrors({});
    login.mutate(parsed.data, {
      onSuccess: () => navigate(next, { replace: true }),
      // Developer diagnostics only: status, code and request id, never credentials.
      onError: (error) => {
        if (isApiError(error)) {
          const requestId = (error.body as { error?: { requestId?: string } } | null)?.error?.requestId;
          console.warn("Sign-in failed", { status: error.status, code: error.code, requestId });
        }
      },
    });
  }

  const failure = login.error ? loginErrorMessage(login.error) : null;

  return (
    <AuthLayout title="Sign in" description="Use the account your team admin created for you.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{failure}</FormAlert>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email || undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error">{errors.email}</FieldError>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
          />
          <FieldError id="password-error">{errors.password}</FieldError>
        </div>

        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-zinc-500">New team member? Open the invite link your admin sent you.</p>
    </AuthLayout>
  );
}

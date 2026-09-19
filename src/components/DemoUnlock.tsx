"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FaroIcon, FaroWordmark } from "@/components/landing/logo";

export default function DemoUnlock({ enabled }: { enabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const code = new FormData(event.currentTarget).get("code");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Incorrect code. Try again."
            : "Demo unavailable. Try again shortly.",
        );
        setPending(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not connect. Try again.");
      setPending(false);
    }
  }

  return (
    <main className="demo-access-shell">
      <dialog
        ref={dialog}
        className="demo-access-dialog"
        aria-labelledby="demo-access-title"
        aria-describedby="demo-access-description"
        onCancel={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-3" aria-label="Far0">
          <FaroIcon className="h-9 w-9" gradientId="demo-access-brand" />
          <FaroWordmark className="h-6 w-auto" />
        </div>
        <p className="demo-access-eyebrow">HACKATHON DEMO</p>
        <h1 id="demo-access-title">Enter the command center</h1>
        <p id="demo-access-description">
          {enabled
            ? "Enter your demo code to explore Far0. No account needed."
            : "The demo is currently unavailable. Please check back shortly."}
        </p>
        {enabled ? (
          <form onSubmit={unlock} className="mt-6 flex flex-col gap-3">
            <label htmlFor="demo-code">Demo code</label>
            <input
              id="demo-code"
              name="code"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              autoFocus
              aria-describedby={error ? "demo-access-error" : undefined}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p id="demo-access-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={pending}>
              {pending ? "Opening…" : "Open demo"}
            </button>
          </form>
        ) : null}
        <Link
          href="/"
          prefetch={false}
          className="mt-6 inline-block text-sm underline underline-offset-4"
        >
          Back to home
        </Link>
      </dialog>
    </main>
  );
}

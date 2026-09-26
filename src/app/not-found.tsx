import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <p className="text-ink-2">That address isn&apos;t a valid website domain, or the page doesn&apos;t exist.</p>
      <Link href="/" className="inline-block rounded-lg bg-accent px-5 py-2 font-semibold text-on-accent">
        Check a website
      </Link>
    </div>
  );
}

import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

export default function Nav({ right }: { right?: React.ReactNode }) {
  return (
    <div className="wrap top">
      <Link className="home" href="/" aria-label={`${SITE_NAME} home`}>
        <b>/</b> {SITE_NAME}
      </Link>
      <nav>{right ?? <Link href="/create">Create yours</Link>}</nav>
    </div>
  );
}

export function Footer({ mode }: { mode: "demo" | "live" }) {
  return (
    <footer className="wrap" style={{ marginTop: 72 }}>
      <span className="label">{SITE_NAME}</span>
      <span className={`mode ${mode}`}>{mode} mode</span>
      <span className="right">
        <Link href="/create">Create a campaign</Link>
        <Link href="/#fee">The fee</Link>
      </span>
    </footer>
  );
}

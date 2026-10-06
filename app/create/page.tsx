import Link from "next/link";
import Builder from "@/components/Builder";
import Nav, { Footer } from "@/components/Nav";
import { mode } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create a campaign" };

export default function CreatePage() {
  return (
    <>
      <Nav right={<Link href="/#how">How it works</Link>} />
      <div className="narrow head">
        <h1>Create your campaign</h1>
        <p>
          Pick what you race in, put a price on each position, and get a link to share. No account, no login. Takes
          about two minutes.
        </p>
      </div>
      <Builder />
      <Footer mode={mode()} />
    </>
  );
}

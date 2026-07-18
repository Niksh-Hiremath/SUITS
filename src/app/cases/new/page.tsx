import Link from "next/link";

import { CaseWorkbench } from "@/components/case-editor/case-workbench";

export const metadata = {
  title: "Compile a fictional case — SUITS",
  description: "Upload, compile, review, and publish a fictional educational case packet.",
};

export default function NewCasePage() {
  return (
    <main>
      <nav className="topbar case-topbar" aria-label="Case preparation navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <Link className="text-link" href="/cases/">Case library →</Link>
      </nav>
      <CaseWorkbench />
    </main>
  );
}

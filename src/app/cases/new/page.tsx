import Link from "next/link";

import { CaseWorkbench } from "@/components/case-editor/case-workbench";

export const metadata = {
  title: "Compile a fictional case — SUITS",
  description: "Upload, compile, review, and publish a fictional educational case packet.",
};

const UPLOAD_ID_PATTERN = /^upload:[a-f0-9]{48}$/u;

type Props = Readonly<{
  searchParams: Promise<{ draft?: string | string[] }>;
}>;

export default async function NewCasePage({ searchParams }: Props) {
  const draftValue = (await searchParams).draft;
  const draftUploadId = typeof draftValue === "string" && UPLOAD_ID_PATTERN.test(draftValue)
    ? draftValue
    : null;
  return (
    <main>
      <nav className="topbar case-topbar" aria-label="Case preparation navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <Link className="text-link" href="/cases/">Case library →</Link>
      </nav>
      <CaseWorkbench initialDraftUploadId={draftUploadId} />
    </main>
  );
}

import Link from "next/link";

import { CourtRecordsWorkspace } from "@/components/records/court-records-workspace";
import { parseCourtRecordsInitialSelection } from "@/domain/court-records/navigation";

export const metadata = {
  title: "Court Records - SUITS",
  description:
    "Inspect the private, event-sourced record and transcript-grounded coaching for your fictional SUITS hearings.",
};

type RecordsPageProps = Readonly<{
  searchParams: Promise<{ trial?: string | string[] }>;
}>;

export default async function RecordsPage({ searchParams }: RecordsPageProps) {
  const initialSelection = parseCourtRecordsInitialSelection(
    (await searchParams).trial,
  );

  return (
    <main className="records-shell">
      <header className="hearing-header">
        <Link className="brand" href="/">
          <span className="brand-mark">S</span>
          <span>SUITS</span>
        </Link>
        <div>
          <span className="eyebrow">Owner-bound audit</span>
          <strong className="records-title">Court Records</strong>
        </div>
        <Link className="text-link" href="/cases/">
          Case library
        </Link>
      </header>

      <CourtRecordsWorkspace initialSelection={initialSelection} />
    </main>
  );
}

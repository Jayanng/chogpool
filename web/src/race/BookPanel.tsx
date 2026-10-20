// The book: the live field of Chogs entered in the pool. Shown on the Race
// section so a deposit visibly puts a Chog on the card.
import { useEffect, useState } from "react";
import { type Address, parseAbi } from "viem";
import { Card, Stat } from "@chogpool/ui";
import { readBook, type BookEntry } from "../lib/book";
import { formatUsdc } from "../lib/money";
import { testnetReadClient } from "../lib/wallet";
import { DEPLOYED } from "../generated/addresses.gen";

const totalSharesAbi = parseAbi(["function totalShares() view returns (uint256)"]);

const SHOWN = 12;

export function BookPanel() {
  const [entries, setEntries] = useState<BookEntry[] | null>(null);
  const [total, setTotal] = useState<bigint | null>(null);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [book, totalShares] = await Promise.all([
          readBook(),
          testnetReadClient.readContract({
            address: DEPLOYED.pool as Address,
            abi: totalSharesAbi,
            functionName: "totalShares",
          }),
        ]);
        setEntries(book);
        setTotal(totalShares as bigint);
      } catch {
        // A failed read is NOT an empty book. Saying otherwise would put a
        // false statement on screen.
        setUnread(true);
      }
    })();
  }, []);

  return (
    <Card title="The book" footer="READ LIVE FROM THE POOL CONTRACT · ONE BOOK PER CHOG, IDS 1 TO 1,969">
      {entries === null ? (
        unread ? (
          <p className="muted small">
            Could not read the book from the chain. Refresh the page to try again.
          </p>
        ) : (
          <p className="muted small">Reading the book…</p>
        )
      ) : entries.length === 0 ? (
        <p className="muted small">
          No Chogs in the book yet. Enter at Play and your Chog is on the card. The gate drops
          when the race is called.
        </p>
      ) : (
        <>
          <div className="stat-row">
            <Stat label="CHOGS ENTERED" value={entries.length.toString()} />
            <Stat
              label="THE BOOK SO FAR"
              value={total && total > 0n ? `${formatUsdc(total)} USDC` : "…"}
            />
          </div>
          <ul className="book-list">
            {entries.slice(0, SHOWN).map((e) => (
              <li key={e.tokenId.toString()} className="book-row">
                <span className="book-id">CHOG #{e.tokenId.toString()}</span>
                <span className="book-stake">{formatUsdc(e.shares)} USDC</span>
                <span className="book-share">
                  {total && total > 0n ? `${(Number((e.shares * 10000n) / total) / 100).toFixed(2)}%` : "…"}
                </span>
              </li>
            ))}
          </ul>
          {entries.length > SHOWN && (
            <p className="muted small">…and {entries.length - SHOWN} more Chogs in the book.</p>
          )}
          <p className="muted small">
            The gate drops when the race is called. Every stake here is already entered.
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * The unit switch. HBAR is the amount; dollars are Hedera's own fee rate
 * applied to it, so an unavailable rate shows HBAR rather than a guess.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Amount, Escrow, MoneyUnitProvider, priceWords } from "./Money";

const HUNDRED = "10000000000";

describe("Amount", () => {
  it("shows HBAR, and no switch, when the network's rate is not known", () => {
    const html = renderToStaticMarkup(<Amount tinybars={HUNDRED} />);
    expect(html).toContain("100 HBAR");
    expect(html).not.toContain("<button");
  });

  it("comes out of the money module, never its own arithmetic", () => {
    expect(priceWords(HUNDRED)).toBe("100 HBAR");
    expect(priceWords("50000000")).toBe("0.5 HBAR");
  });

  it("keeps the escrow words with the amount", () => {
    const html = renderToStaticMarkup(<Escrow priceTinybars={HUNDRED} />);
    expect(html).toContain("100 HBAR");
    expect(html).toContain("locked in escrow");
  });

  it("keeps its own unit, so one figure switching leaves the others alone", () => {
    // Two amounts, one rate, two independent units: nothing shared but the rate.
    const html = renderToStaticMarkup(
      <MoneyUnitProvider mirrorNodeUrl="https://testnet.mirrornode.hedera.com/api/v1">
        <Amount tinybars={HUNDRED} />
        <Amount tinybars="50000000" />
      </MoneyUnitProvider>,
    );
    expect(html).toContain("100 HBAR");
    expect(html).toContain("0.5 HBAR");
  });

  it("renders inside the provider without a rate yet, still in HBAR", () => {
    // The provider fetches on mount, which a server render never runs, so
    // the first paint is the honest one: the real amount.
    const html = renderToStaticMarkup(
      <MoneyUnitProvider mirrorNodeUrl="https://testnet.mirrornode.hedera.com/api/v1">
        <Amount tinybars={HUNDRED} />
      </MoneyUnitProvider>,
    );
    expect(html).toContain("100 HBAR");
    expect(html).not.toContain("$");
  });
});

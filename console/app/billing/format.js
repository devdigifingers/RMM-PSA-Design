const NBSP = "\u00a0";

export function rand(cents) {
  if (cents == null) return "—";
  const size = Math.abs(cents);
  const whole = String(Math.floor(size / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${cents < 0 ? "-" : ""}R${NBSP}${whole},${String(size % 100).padStart(2, "0")}`;
}

export function randInput(cents) {
  if (cents == null) return "";
  return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export function quantityInput(milli) {
  if (milli == null) return "1";
  const whole = Math.floor(milli / 1000);
  const rest = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return rest ? `${whole},${rest}` : String(whole);
}

export function shortDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
}

export const KINDS = {
  invoice: { path: "invoices", word: "Invoice", plural: "Invoices", new: "New invoice" },
  quote: { path: "quotes", word: "Quote", plural: "Quotes", new: "New quote" },
  credit_note: { path: "credit-notes", word: "Credit note", plural: "Credit notes", new: "New credit note" },
};

export const TAX_LABELS = { standard: "Standard 15%", zero_rated: "Zero-rated", exempt: "Exempt", no_vat: "No VAT" };
export const METHOD_LABELS = { eft: "EFT", cash: "Cash", card: "Card", other: "Other" };

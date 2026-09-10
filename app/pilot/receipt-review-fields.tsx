import type { ReactNode } from "react";
import { fieldNames, receiptRows, type ReceiptField } from "@/lib/receipt-workflow";

// Keep document fields once, followed by every line in source order. The shell
// used to render only the current row, hiding the rest of the receipt.
export default function ReceiptReviewFields({ fields, renderField }: {
  fields: ReceiptField[];
  renderField: (field: ReceiptField) => ReactNode;
}) {
  const ordered = (row: string) => fields.filter(f => f.row_key === row).sort(
    (a, b) => Object.keys(fieldNames).indexOf(a.field_name) - Object.keys(fieldNames).indexOf(b.field_name),
  );
  const rows = receiptRows(fields);
  return <>
    <div className="shell-card review-fields">{ordered("document").map(renderField)}</div>
    {rows.map((row, index) => <section className="shell-section" aria-label={`第 ${index + 1} 項`} key={row}>
      <div className="shell-section-head"><h2>品項 {index + 1} / {rows.length}</h2></div>
      <div className="shell-card review-fields">{ordered(row).map(renderField)}</div>
    </section>)}
  </>;
}

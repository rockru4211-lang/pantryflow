export type CountCardDraft = { quantity: string; note: string };

export function sameCountCardDraft(left: CountCardDraft | undefined, right: CountCardDraft | undefined): boolean {
  return Boolean(left && right && left.quantity === right.quantity && left.note === right.note);
}

export function unclassifiedCountZone(name: string): boolean {
  return name.replace(/\s/g, "") === "未分類";
}

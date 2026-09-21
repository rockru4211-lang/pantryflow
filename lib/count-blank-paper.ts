export type BlankCountPaperItem = {
  id: string;
  name: string;
  specification: string;
  supplier: string;
  unit: string;
};
export type BlankCountPaperZone = { id: string; name: string; items: BlankCountPaperItem[] };
type PaperProduct = {
  name: string; specification?: string | null; is_active?: boolean;
  suppliers?: { name: string } | { name: string }[] | null;
};
export type PaperConfiguredZone = {
  id: string; name: string;
  zone_products: { product_id: string; count_unit: string; products: PaperProduct | PaperProduct[] }[];
};
export type PaperSnapshotItem = {
  zone_id: string; zone_name: string; product_id: string; product_name: string;
  unit: string; specification?: string; supplier?: string;
};

// No snapshot means the next count's current configuration. An empty snapshot
// remains an empty scope; it must never expand to the full catalog.
export function blankCountPaperZones(configured: readonly PaperConfiguredZone[], snapshot?: readonly PaperSnapshotItem[]): BlankCountPaperZone[] {
  const remaining = snapshot === undefined ? null : new Map(snapshot.map(item => [`${item.zone_id}:${item.product_id}`, item]));
  const output: BlankCountPaperZone[] = [];
  for (const zone of configured) {
    const items: BlankCountPaperItem[] = [];
    for (const row of zone.zone_products) {
      const key = `${zone.id}:${row.product_id}`;
      const frozen = remaining?.get(key);
      if (remaining && !frozen) continue;
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      if (!remaining && product?.is_active === false) continue;
      const supplier = Array.isArray(product?.suppliers) ? product.suppliers[0] : product?.suppliers;
      items.push({ id: row.product_id, name: product?.name || frozen?.product_name || "盤點品項", specification: product?.specification ?? frozen?.specification ?? "", supplier: supplier?.name || frozen?.supplier || "", unit: frozen?.unit ?? row.count_unit });
      remaining?.delete(key);
    }
    // A frozen item can be absent from the current catalog. Keep it on paper.
    if (remaining) for (const [key, item] of remaining) if (item.zone_id === zone.id) {
      items.push(snapshotPaperItem(item)); remaining.delete(key);
    }
    if (items.length) output.push({ id: zone.id, name: zone.name, items });
  }
  if (remaining) for (const item of remaining.values()) {
    let zone = output.find(row => row.id === item.zone_id);
    if (!zone) { zone = { id: item.zone_id, name: item.zone_name, items: [] }; output.push(zone); }
    zone.items.push(snapshotPaperItem(item));
  }
  return output;
}

function snapshotPaperItem(item: PaperSnapshotItem): BlankCountPaperItem {
  return { id: item.product_id, name: item.product_name, specification: item.specification || "", supplier: item.supplier || "", unit: item.unit };
}

export function escapeCountPaperText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function blankCountPaperHtml(storeName: string, zones: readonly BlankCountPaperZone[]): string {
  const esc = escapeCountPaperText;
  const tables = zones.filter(zone => zone.items.length).map(zone => `<section class="paper-zone"><table>
<colgroup><col class="item-col"><col class="supplier-col"><col class="unit-col"><col class="quantity-col"><col class="note-col"></colgroup>
<thead><tr class="sheet-heading"><th colspan="5"><h1>盤點表</h1><div class="sheet-meta"><span>門市：${esc(storeName)}</span><span>日期：<i class="date-line"></i></span></div><div class="sheet-meta"><span>儲物區：${esc(zone.name)}</span><span>盤點人：<i class="counter-line"></i></span></div></th></tr>
<tr class="column-heading"><th scope="col">品名／規格</th><th scope="col">廠商</th><th scope="col">單位</th><th scope="col">實盤數量</th><th scope="col">備註</th></tr></thead>
<tbody>${zone.items.map(item => `<tr><td><strong>${esc(item.name)}</strong>${item.specification ? `<small>${esc(item.specification)}</small>` : ""}</td><td>${esc(item.supplier)}</td><td class="unit">${esc(item.unit)}</td><td class="handwriting quantity"></td><td class="handwriting note"></td></tr>`).join("\n")}</tbody><tfoot><tr><td colspan="5">未填不代表 0</td></tr></tfoot></table></section>`).join("\n");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(storeName)}－空白盤點表</title><style>
@page{size:A4 portrait;margin:12mm 10mm;@bottom-right{content:counter(page) "／" counter(pages);font-size:9pt;font-family:sans-serif}}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;font-size:11pt;line-height:1.4}
.paper-zone{break-after:page;page-break-after:always}.paper-zone:last-child{break-after:auto;page-break-after:auto}
table{width:calc(100% - .6mm);table-layout:fixed;border-collapse:collapse}thead{display:table-header-group}tbody{display:table-row-group}tfoot{display:table-footer-group}tfoot td{border:0;padding:2mm 0 0;font-size:9pt}
tr{break-inside:avoid;page-break-inside:avoid}th,td{border:.3mm solid #000;padding:2mm 2.2mm;overflow-wrap:anywhere;vertical-align:middle;text-align:left}
.item-col{width:34%}.supplier-col{width:20%}.unit-col{width:8%}.quantity-col{width:18%}.note-col{width:20%}
.sheet-heading th{border:0;padding:0 0 4mm;font-weight:400}.sheet-heading h1{margin:0 0 4mm;text-align:center;font-size:19pt;font-weight:700;letter-spacing:2mm}
.sheet-meta{display:flex;justify-content:space-between;gap:8mm;margin-top:2.5mm}.sheet-meta>span:first-child{flex:1;min-width:0}.sheet-meta>span:last-child{flex:0 0 auto;white-space:nowrap}
.date-line,.counter-line{display:inline-block;width:38mm;height:5mm;border-bottom:.25mm solid #000;vertical-align:bottom}.counter-line{width:32mm}
.column-heading th{padding:2.3mm 2mm;text-align:center;font-size:10.5pt;font-weight:700;background:#fff}
tbody td{height:10mm}td strong{display:block;font-size:11pt;font-weight:500}td small{display:block;font-size:9pt;margin-top:.5mm}td.unit{text-align:center}
@media screen{body{padding:12mm 10mm;max-width:210mm;margin:auto}.paper-zone{margin-bottom:12mm}}
</style></head><body>${tables}</body></html>`;
}

// Called directly by the Print click: opening before any await keeps Safari's
// user activation. This isolated document contains only the escaped paper data.
export function openBlankCountPaper(html: string, onFailure: (message: string) => void): boolean {
  let opened:Window|null;
  try { opened=window.open("", "_blank", "popup,width=900,height=900"); }
  catch { onFailure("瀏覽器阻擋了列印視窗，請允許彈出式視窗後再按列印。");return false; }
  const popup=opened;
  if (!popup || popup.closed) { onFailure("瀏覽器阻擋了列印視窗，請允許彈出式視窗後再按列印。"); return false; }
  let requested = false;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(loadTimer); popup.removeEventListener("load", print); popup.removeEventListener("afterprint", finish); popup.removeEventListener("pagehide", cleanup); };
  // Safari can fire afterprint when its dialog opens. Leave the read-only
  // sheet available until the user closes it instead of closing underneath it.
  const finish = () => { cleanup(); };
  const print = () => {
    if (requested || popup.closed) return;
    requested = true; clearTimeout(loadTimer);
    try { popup.focus(); popup.print(); }
    catch { cleanup(); popup.close(); onFailure("目前無法開啟列印，請重試。"); }
  };
  try {
    popup.opener = null;
    // document.open() removes window listeners, so register after opening it.
    popup.document.open();
    popup.addEventListener("load", print, { once: true });
    popup.addEventListener("afterprint", finish, { once: true });
    popup.addEventListener("pagehide", cleanup, { once: true });
    loadTimer = setTimeout(() => { if (!requested) { cleanup(); popup.close(); onFailure("列印表尚未載入完成，請重試。"); } }, 10000);
    popup.document.write(html); popup.document.close();
    if (popup.document.readyState === "complete") print();
    return true;
  } catch { cleanup(); popup.close(); onFailure("列印表無法建立，請重試。"); return false; }
}

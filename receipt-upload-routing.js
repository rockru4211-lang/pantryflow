(function exposeReceiptUploadRouting(root) {
  function groupReceiptFiles(files, sameReceiptMultiPage = false) {
    const list = Array.from(files || []);
    if (!list.length) return [];
    return sameReceiptMultiPage ? [list] : list.map(file => [file]);
  }

  async function settleReceiptGroups(groups, worker) {
    const results = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const files = groups[groupIndex];
      try {
        results.push({ ok: true, groupIndex, files, value: await worker(files, groupIndex) });
      } catch (error) {
        results.push({ ok: false, groupIndex, files, error });
      }
    }
    return results;
  }

  root.PantryReceiptUploadRouting = { groupReceiptFiles, settleReceiptGroups };
})(globalThis);

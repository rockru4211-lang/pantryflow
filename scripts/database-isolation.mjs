// Publishing must never send the chain-only app back to BeApe's database.
export function assertDatabaseIsolation(contract) {
  const isolation = contract.databaseIsolation;
  if (isolation?.status !== 'ready') throw new Error('序專屬資料庫尚未完成設定與驗證，停止發布。');
  if (!/^[a-z]{20}$/.test(contract.supabaseProject || '') ||
      !/^[a-z]{20}$/.test(isolation.protectedProject || '') ||
      contract.supabaseProject === isolation.protectedProject) {
    throw new Error('序與百花猿必須使用不同的 Supabase 專案，停止發布。');
  }
  if (contract.canonicalBranch !== 'main' || contract.workerName !== 'pantryflow' ||
      contract.appUrl !== 'https://pantryflow.rockru4211.workers.dev/' || isolation.targetProduct !== 'xu-chain') {
    throw new Error('序的分支、部署或產品設定不一致，停止發布。');
  }
}

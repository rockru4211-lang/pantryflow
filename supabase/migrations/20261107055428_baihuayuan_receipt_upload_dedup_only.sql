-- Keep duplicate rejection in receipt intake and preserve existing evidence.
-- Retire the manual review actions for active sessions and older clients.
revoke execute on function
  public.get_baihuayuan_receipt_duplicates(uuid),
  private.get_baihuayuan_receipt_duplicates(uuid),
  public.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text),
  private.set_baihuayuan_receipt_duplicate(uuid,uuid,uuid,text)
from public, anon, authenticated;

notify pgrst, 'reload schema';

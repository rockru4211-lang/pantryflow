-- Accept zero-padded ROC years printed by suppliers; preserve source records.
create or replace function private.receipt_account_date(p_value text)
returns date language plpgsql immutable set search_path='' as $$
declare parts text[];yr integer;
begin
 parts:=regexp_match(regexp_replace(btrim(p_value),'^民國',''),'^(\d{3,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$');
 if parts is null then return null;end if;
 yr:=parts[1]::integer+case when length(parts[1])=3 or left(parts[1],1)='0' then 1911 else 0 end;
 if yr<1900 then return null;end if;
 return make_date(yr,parts[2]::integer,parts[3]::integer);
 exception when datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;
revoke all on function private.receipt_account_date(text) from public,anon,authenticated;

alter table private.waste_records drop constraint waste_records_source_check;
alter table private.waste_records add constraint waste_records_source_check check(source in ('FIELD','EXPIRY','ADMIN_BACKFILL'));

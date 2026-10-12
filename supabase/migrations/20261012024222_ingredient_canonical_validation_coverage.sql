-- BEFORE assignment may change the pointer during a package edit; validate it
-- even when the caller did not explicitly include the canonical column.
drop trigger ingredient_canonical_validation on private.ingredient_masters;
create trigger ingredient_canonical_validation before insert or update on private.ingredient_masters
for each row execute function private.check_ingredient_canonical();

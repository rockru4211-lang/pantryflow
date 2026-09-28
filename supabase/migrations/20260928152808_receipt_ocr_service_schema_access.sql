-- The OCR worker can execute get_receipt_ocr_sources, but its invoker wrapper
-- also needs to resolve the private implementation. Keep the existing function
-- grants, client restrictions and invoker security unchanged.
grant usage on schema private to service_role;

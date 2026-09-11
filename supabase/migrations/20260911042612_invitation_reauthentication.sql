-- Keep revoked/expired sessions on the existing reauthentication path.
do $migration$
declare source text;updated text;
begin
 select pg_get_functiondef('private.management_invitation(text,uuid)'::regprocedure) into source;
 updated:=replace(source,
 'if email_address is null or not private.app_session_valid(null) then raise exception ''VERIFIED_EMAIL_REQUIRED'' using errcode=''42501'';end if;',
 'if email_address is null then raise exception ''VERIFIED_EMAIL_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||
 ' if not private.app_session_valid(null) then raise exception ''AUTH_REAUTH_REQUIRED'' using errcode=''42501'';end if;');
 if source=updated then raise exception 'Invitation session guard source mismatch';end if;
 execute updated;
end $migration$;
notify pgrst,'reload schema';

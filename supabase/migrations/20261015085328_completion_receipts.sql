-- Actual arrival is distinct from the requested and expected dates. Preserve old rows as unknown.
alter table private.purchase_notes add column completed_on date, add column completed_by text;
alter table private.purchase_note_events add column completed_on date;
do $$
declare src text; anchor text;
begin
 select pg_get_functiondef('private.purchase_notes_workflow(uuid,text,jsonb,uuid)'::regprocedure) into src;
 anchor:='arrival_date=nullif(data->>''arrival_date'','''')::date,';
 if position(anchor in src)=0 then raise exception 'purchase anchor missing';end if;
 src:=replace(src,anchor,anchor||'completed_on=case when state=''ARRIVED'' then coalesce(nullif(data->>''completed_on'','''')::date,r.completed_on,(clock_timestamp() at time zone ''Asia/Taipei'')::date) else null end,completed_by=case when state=''ARRIVED'' then case when r.status=''ARRIVED'' then coalesce(r.completed_by,who) else who end else null end,');
 src:=replace(src,'insert into private.purchase_note_events(note_id,status,body,actor_name) values(rid,r.status,case when action=''create'' then ''建立待購事項'' else r.note end,who);','insert into private.purchase_note_events(note_id,status,body,actor_name,completed_on) values(rid,r.status,case when action=''create'' then ''建立待購事項'' else r.note end,who,r.completed_on);');
 execute src;
 select pg_get_functiondef('private.equipment_workflow(uuid,text,jsonb,uuid)'::regprocedure) into src;
 anchor:='if j.status=''DONE'' then raise exception ''REPAIR_ALREADY_COMPLETED'' using errcode=''40001'';end if;';
 if position(anchor in src)=0 then raise exception 'repair anchor missing';end if;
 src:=replace(src,anchor,'if j.status=''DONE'' and (coalesce(p_data->>''correction'',''false'')<>''true'' or (j.created_at at time zone ''Asia/Taipei'')::date<date ''2026-10-14'') then raise exception ''REPAIR_ALREADY_COMPLETED'' using errcode=''40001'';end if;');
 src:=replace(src,'event_body:=body;','event_body:=case when old_value->>''status''=''DONE'' then ''更正完成紀錄・'' else '''' end||body;');
 execute src;
end $$;

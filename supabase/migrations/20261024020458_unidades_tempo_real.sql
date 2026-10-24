-- Only status is published. Prices and customer data never enter this table.
create table public.dmd_disponibilidade (
 id text primary key, status text not null
);
alter table public.dmd_disponibilidade enable row level security;
revoke all on public.dmd_disponibilidade from public, anon, authenticated;
grant all on public.dmd_disponibilidade to service_role;
create function public.dmd_notificar_disponibilidade() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
 if new.store = 'unidades' then
  insert into public.dmd_disponibilidade(id,status)
  values(new.key,coalesce(new.valor->>'status','Indisponível'))
  on conflict(id) do update set status=excluded.status;
 end if;
 return new;
end $$;
revoke all on function public.dmd_notificar_disponibilidade() from public,anon,authenticated;
grant execute on function public.dmd_notificar_disponibilidade() to service_role;
create trigger dmd_disponibilidade_commit after insert or update of valor
on public.dmd_kv for each row execute function public.dmd_notificar_disponibilidade();
alter publication supabase_realtime add table public.dmd_disponibilidade;

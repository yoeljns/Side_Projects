-- Morning Board sync: one JSON document per sync code.
--
-- The table has row level security on and no policies, so the public API key
-- cannot read or list it. The only way in is through the two functions below,
-- which need the sync code; the table stores only the code's SHA-256 hash.

create table if not exists public.boards (
  code_hash text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

create or replace function public.board_get(p_code text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select b.data
  from public.boards b
  where b.code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
$$;

create or replace function public.board_put(p_code text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(p_code) < 20 or length(p_code) > 64 then
    raise exception 'invalid sync code';
  end if;
  if pg_column_size(p_data) > 1000000 then
    raise exception 'board too large';
  end if;
  insert into public.boards (code_hash, data)
  values (encode(sha256(convert_to(p_code, 'UTF8')), 'hex'), p_data)
  on conflict (code_hash) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.board_get(text) from public;
revoke all on function public.board_put(text, jsonb) from public;
grant execute on function public.board_get(text) to anon, authenticated;
grant execute on function public.board_put(text, jsonb) to anon, authenticated;

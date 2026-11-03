-- Pega esto en Supabase → SQL Editor → New query → Run
create table if not exists public.pacto (
  id text primary key,
  state jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Bloquea el acceso público directo; solo la API de Vercel (con la clave secreta) puede leer y escribir.
alter table public.pacto enable row level security;

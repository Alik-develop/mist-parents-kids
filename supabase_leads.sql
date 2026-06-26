-- =====================================================================
--  «Міст» — міграція: заявки до фахівця (lead-форма з ekspert.html).
--  Запусти у Supabase → SQL Editor → New query → Run.
--  Безпечно повторно (idempotent).
--
--  Приватність/безпека: будь-хто (навіть анонім) може ЛИШЕ ДОДАТИ заявку.
--  Читати заявки публічним ключем НЕ можна — немає SELECT-політики.
--  Ти бачиш заявки у Supabase → Table editor → leads (service role обходить RLS).
-- =====================================================================

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),   -- хто був у системі (null, якщо анонім)
  expert_name  text,                       -- до кого заявка (картка фахівця)
  expert_kind  text,                       -- 'tutor' | 'psy' | 'mentor'
  name         text not null,              -- як звати того, хто лишив заявку
  contact      text not null,              -- пошта або телефон
  note         text,                       -- коротко про ситуацію (необовʼязково)
  zone         text,                       -- головна зона з результату тесту, якщо є
  source_page  text,                       -- звідки прийшла заявка (url)
  user_agent   text                        -- браузер/пристрій (діагностика спаму)
);

alter table public.leads enable row level security;

-- INSERT дозволено всім (anon + authenticated); жодних SELECT/UPDATE/DELETE політик
drop policy if exists p_leads_insert on public.leads;
create policy p_leads_insert on public.leads
  for insert
  to anon, authenticated
  with check (true);

-- явні привілеї: лише вставка (без читання публічним ключем)
grant insert on public.leads to anon, authenticated;

-- =====================================================================
--  Готово. Тепер ekspert.html пише заявки сюди (mailto лишається лише
--  запасним шляхом, якщо база недоступна). Перевір заявки в Table editor.
-- =====================================================================

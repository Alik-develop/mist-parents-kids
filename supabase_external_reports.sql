-- =====================================================================
--  «Міст» — міграція: зовнішні звіти навчання (ВШО) → аналітика в кабінеті.
--  Запусти у Supabase → SQL Editor → New query → Run.
--  Безпечно повторно (idempotent). Приватність: звіт = особисті дані дитини
--  (бали/прогалини), привʼязані до child_id, доступні лише сімʼї (RLS).
-- =====================================================================

create table if not exists public.external_reports (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.children(id) on delete cascade,
  created_by    uuid references public.profiles(id),
  source        text not null default 'vsho',   -- джерело: 'vsho' тощо
  subject       text,                            -- 'math','history',… (визначається з курсу)
  course        text,                            -- повна назва курсу зі звіту
  report_date   text,                            -- дата зі звіту (рядок, формат ВШО)
  student_name  text,                            -- імʼя у звіті (для звірки)
  overall_score numeric,
  overall_total numeric,
  overall_pct   numeric,
  sections      jsonb,                           -- [{name,status,score,total,pct}]
  gaps          jsonb,                           -- [{n,theme,material}]
  created_at    timestamptz not null default now()
);

alter table public.external_reports enable row level security;

-- доступ до звітів лише для дітей із моїх сімей (як lesson_progress/attempts)
drop policy if exists p_reports_all on public.external_reports;
create policy p_reports_all on public.external_reports
  for all
  using (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())))
  with check (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())));

-- =====================================================================
--  Готово. Тепер сторінка zvit.html може зберігати розібрані звіти,
--  а кабінет — показувати аналітику сильних/слабких сторін.
-- =====================================================================

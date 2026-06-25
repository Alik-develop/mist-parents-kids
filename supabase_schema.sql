-- =====================================================================
--  «Міст для Батьків та Дітей» — схема бази даних (Supabase / Postgres)
--  V1: акаунти, сімʼя (1–2 батьків ↔ N дітей), тести на дитину, уроки.
--  Запусти цей файл повністю у Supabase → SQL Editor → New query → Run.
--  Безпечно запускати повторно (idempotent): усе через if not exists / or replace.
--  Приватність: дослівні відповіді підлітка тут НЕ зберігаються.
-- =====================================================================

-- ── 1. ТАБЛИЦІ ───────────────────────────────────────────────────────

-- Профіль батька (1:1 з auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- Сімʼя (одиниця, до якої привʼязані батьки й діти)
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Моя сімʼя',
  created_at  timestamptz not null default now()
);

-- Учасники сімʼї: батько ↔ сімʼя (дозволяє 2 батьків в одній сімʼї)
create table if not exists public.family_members (
  family_id   uuid not null references public.families(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'parent',
  created_at  timestamptz not null default now(),
  primary key (family_id, profile_id)
);

-- Діти: належать сімʼї
create table if not exists public.children (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null,
  birth_year  int,
  grade       int,
  created_at  timestamptz not null default now()
);

-- Спроби тесту: на кожну дитину (дзеркало = бали зон/розходження, без дослівних слів)
create table if not exists public.attempts (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.children(id) on delete cascade,
  created_by     uuid references public.profiles(id),
  date           timestamptz not null default now(),
  zone           text,
  scenario_key   text,
  hyp_label      text,
  hyp_scale      text,
  parent_scores  jsonb,
  teen_scores    jsonb,
  gaps           jsonb,
  top_gap_scale  text,
  top_gap_value  numeric,
  risk           boolean not null default false
);

-- Уроки (контент-бібліотека; модель «як ВШО, але свої»)
create table if not exists public.lessons (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,                 -- 'math','history',...
  grade        int,
  title        text not null,
  summary      text,
  video_url    text,                          -- посилання на відео-пояснення/запис
  material     text,                          -- HTML/markdown матеріал
  zone         text,                          -- опц.: яку зону теста підсилює
  topics       jsonb,                          -- теги тем (для авто-підбору під прогалини ВШО)
  external_url text,                            -- якщо урок зовнішній (картка-посилання на ВШО)
  duration_min int not null default 25,
  position     int not null default 0,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);
-- безпечні add column для наявних інсталяцій
alter table public.lessons add column if not exists topics jsonb;
alter table public.lessons add column if not exists external_url text;

-- Питання короткого тесту на закріплення (до уроку)
create table if not exists public.lesson_questions (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  position    int not null default 0,
  question    text not null,
  options     jsonb not null,                 -- ["20","40","60"]
  correct     int not null                    -- індекс правильної відповіді
);

-- Прогрес по уроку: дитина ↔ урок
create table if not exists public.lesson_progress (
  child_id    uuid not null references public.children(id) on delete cascade,
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  status      text not null default 'started',-- 'started' | 'done'
  score       int,
  updated_at  timestamptz not null default now(),
  primary key (child_id, lesson_id)
);

-- Зовнішні звіти навчання (ВШО) → аналітика в кабінеті (особисті дані дитини)
create table if not exists public.external_reports (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.children(id) on delete cascade,
  created_by    uuid references public.profiles(id),
  source        text not null default 'vsho',
  subject       text,
  course        text,
  report_date   text,
  student_name  text,
  overall_score numeric,
  overall_total numeric,
  overall_pct   numeric,
  sections      jsonb,
  gaps          jsonb,
  created_at    timestamptz not null default now()
);

-- ── 2. ХЕЛПЕР проти рекурсії RLS ─────────────────────────────────────
-- Повертає id сімей поточного користувача. security definer = обходить RLS
-- усередині функції, тому політики на family_members не зациклюються.
create or replace function public.my_family_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select family_id from public.family_members where profile_id = auth.uid()
$$;

-- ── 3. АВТО-СТВОРЕННЯ сімʼї при реєстрації ───────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare fam uuid;
begin
  insert into public.profiles(id, full_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into public.families(name) values ('Моя сімʼя') returning id into fam;
  insert into public.family_members(family_id, profile_id, role)
    values (fam, new.id, 'parent');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. RLS (Row-Level Security) ──────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.families         enable row level security;
alter table public.family_members   enable row level security;
alter table public.children         enable row level security;
alter table public.attempts         enable row level security;
alter table public.lessons          enable row level security;
alter table public.lesson_questions enable row level security;
alter table public.lesson_progress  enable row level security;
alter table public.external_reports enable row level security;

-- profiles: бачу/редагую лише свій профіль
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- families: бачу сімʼї, де я учасник; створювати може будь-який автентифікований
drop policy if exists p_families_member_select on public.families;
create policy p_families_member_select on public.families
  for select using (id in (select public.my_family_ids()));
drop policy if exists p_families_insert on public.families;
create policy p_families_insert on public.families
  for insert with check (auth.uid() is not null);

-- family_members: бачу учасників своїх сімей; додати можу себе (приєднання)
drop policy if exists p_fm_select on public.family_members;
create policy p_fm_select on public.family_members
  for select using (family_id in (select public.my_family_ids()));
drop policy if exists p_fm_insert_self on public.family_members;
create policy p_fm_insert_self on public.family_members
  for insert with check (profile_id = auth.uid());
drop policy if exists p_fm_delete_self on public.family_members;
create policy p_fm_delete_self on public.family_members
  for delete using (profile_id = auth.uid());

-- children: CRUD дітей у моїх сімʼях
drop policy if exists p_children_all on public.children;
create policy p_children_all on public.children
  for all
  using (family_id in (select public.my_family_ids()))
  with check (family_id in (select public.my_family_ids()));

-- attempts: CRUD спроб для дітей із моїх сімей
drop policy if exists p_attempts_all on public.attempts;
create policy p_attempts_all on public.attempts
  for all
  using (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())))
  with check (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())));

-- lessons / lesson_questions: контент читають усі автентифіковані; запис — лише через дашборд (адмін)
drop policy if exists p_lessons_read on public.lessons;
create policy p_lessons_read on public.lessons
  for select using (auth.uid() is not null and published = true);
drop policy if exists p_lq_read on public.lesson_questions;
create policy p_lq_read on public.lesson_questions
  for select using (auth.uid() is not null);

-- lesson_progress: CRUD прогресу лише для своїх дітей
drop policy if exists p_progress_all on public.lesson_progress;
create policy p_progress_all on public.lesson_progress
  for all
  using (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())))
  with check (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())));

-- external_reports: CRUD звітів для дітей із моїх сімей
drop policy if exists p_reports_all on public.external_reports;
create policy p_reports_all on public.external_reports
  for all
  using (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())))
  with check (child_id in (select id from public.children
                      where family_id in (select public.my_family_ids())));

-- =====================================================================
--  Готово. Далі: у застосунку — config.js з URL + anon key (див. SUPABASE_SETUP.md).
--  Привʼязка ДРУГОГО батька до сімʼї (інвайт-код) — наступний крок, схема вже готова.
-- =====================================================================

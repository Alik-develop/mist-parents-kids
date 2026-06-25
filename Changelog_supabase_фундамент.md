# Changelog — фундамент настоящего кабинета: Supabase (аккаунты + база)

_25 червня 2026 · гілка `main` · початок «Нового курсу» (див. Roadmap)_

Перший зріз справжнього кабінету: акаунти + база. **Файли тільки додавальні — живий сайт не змінено** (працює як раніше, на localStorage). Перехід сторінок на базу — наступний крок, після налаштування Supabase.

## Що зроблено

- **`supabase_schema.sql`** — повна схема БД: `profiles`, `families`, `family_members` (дозволяє 2 батьків), `children`, `attempts` (тест на дитину, без дослівних слів), `lessons`, `lesson_questions`, `lesson_progress`. Захист даних (RLS) — через `security definer` функцію `my_family_ids()` (без рекурсії). Тригер `handle_new_user()` авто-створює сімʼю при реєстрації.
- **`docs/assets/db.js`** — модуль `MistDB`: вхід (email/Google), `family`, `children`, `attempts`, `lessons`, `progress`. Навмисно дзеркалить старий `Site`-API, але асинхронно — щоб сторінки переходили на базу з мінімумом змін.
- **`docs/assets/config.example.js`** — шаблон під ключі (anon key — публічний, безпечний).
- **`docs/vhid.html`** — сторінка входу/реєстрації (email + Google). Без налаштування показує підказку й не ламається.
- **`SUPABASE_SETUP.md`** — покроковий гайд (10–15 хв, без програмування).

## Чого НЕ чіпав

- Живі сторінки (`index`/`opytuvannya`/`kabinet`/…) — без змін, працюють як раніше.
- Хедер «Увійти» поки лишив `toast` — підключу до `vhid.html`, коли база буде жива (щоб не показувати «налаштуйте Supabase» на публічному сайті).

## QA

- `node --check db.js` / `config.example.js` — OK; inline-JS `vhid.html` компілюється; файли цілі (tails: `})();`, `</html>`).
- Реальний прогін авторизації/БД неможливий без проєкту Supabase — перевіряється після Кроку 6 гайда (поява рядків у `profiles`/`families`).

## Дія від Алика (один раз)

Пройти **`SUPABASE_SETUP.md`** Кроки 1–6: створити безкоштовний проєкт, виконати `supabase_schema.sql`, вставити 2 ключі в `docs/assets/config.js`. Потім скажи — і я переведу кабінет + тест на базу (зі збереженням приватності й перенесенням локальних даних).

## Git (GitHub Desktop)

Нові файли: `supabase_schema.sql`, `SUPABASE_SETUP.md`, `docs/vhid.html`, `docs/assets/db.js`, `docs/assets/config.example.js`, `Changelog_supabase_фундамент.md` (+ `docs/assets/config.js` з ключами — publishable key публічний, безпечно комітити для GitHub Pages).

## ✅ Налаштовано (зроблено за Алика через браузер, 25.06)

- Проєкт Supabase **`szlxleldjbusvzoumgmq`** (eu-west-1, Free). Схему виконано — підтверджено: 8 таблиць, функції `my_family_ids`/`handle_new_user`, тригер `on_auth_user_created`, 11 RLS-політик.
- `docs/assets/config.js` записано (URL + publishable key).
- Authentication → URL Configuration: Site URL і redirect = `https://alik-develop.github.io/mist-parents-kids(/**)`.
- Email-вхід працює (підтвердження пошти ON — секюрно). **Google-провайдер не налаштовано** (потребує Google OAuth ключів) — кнопку Google на vhid.html сховано до налаштування.

**Лишилось Алику:** закомітити/запушити нові файли (вкл. `config.js`) через GitHub Desktop і впевнитись, що GitHub Pages увімкнено — тоді реєстрація на `vhid.html` працюватиме на живому сайті.

# Личное облако

Бесплатная веб-версия личного облака:

- GitHub Pages — статический интерфейс;
- Supabase Auth и PostgreSQL — вход и метаданные;
- Supabase Edge Function `cloud-api` — защищённые операции;
- приватный Backblaze B2 — файлы;
- загрузка и скачивание идут напрямую между браузером и B2 по временным подписанным URL.

Секретные ключи Backblaze и `SUPABASE_SERVICE_ROLE_KEY` не передаются браузеру и не хранятся в GitHub.

## Локальный запуск

1. Скопируйте `.env.example` в `.env.local`.
2. Заполните только две публичные переменные `VITE_*`.
3. Выполните `npm install` и `npm run dev`.

Подробная настройка: [docs/SETUP.md](docs/SETUP.md). Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

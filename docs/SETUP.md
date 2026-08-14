# Настройка

## 1. Переменные GitHub Pages

В репозитории откройте **Settings → Secrets and variables → Actions → Variables** и добавьте:

- `VITE_SUPABASE_URL` — Project URL из Supabase;
- `VITE_SUPABASE_PUBLISHABLE_KEY` — publishable key из Supabase.

Это публичные параметры. Секретные ключи сюда добавлять нельзя.

## 2. Supabase Edge Function

Разверните функцию из `supabase/functions/cloud-api` с отключённой встроенной JWT-проверкой. Функция сама валидирует JWT и также обслуживает публичные ссылки.

Добавьте в Supabase Function Secrets:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `SHARE_TOKEN_SECRET`
- `PUBLIC_APP_URL=https://anngeog337-code.github.io/lichnoe-oblako`

`SUPABASE_URL`, `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` Supabase предоставляет функции автоматически.

## 3. Supabase Auth

Добавьте в разрешённые Redirect URLs:

`https://anngeog337-code.github.io/lichnoe-oblako/`

## 4. Backblaze CORS

Разрешите origin:

`https://anngeog337-code.github.io`

Нужные методы для прямой загрузки: `GET`, `HEAD`, `PUT`, `POST`, `DELETE`; expose header: `ETag`.

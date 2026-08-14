# Публикация

Workflow `.github/workflows/pages.yml` собирает приложение после каждого push в `main` и публикует папку `dist` в GitHub Pages.

Перед первой рабочей публикацией должны быть настроены:

1. GitHub Actions Variables `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Supabase Function `cloud-api` и её секреты.
3. Redirect URL Supabase Auth.
4. CORS Backblaze для GitHub Pages origin.

Если публичные переменные ещё не добавлены, сборка всё равно завершается, но сайт показывает экран незавершённой настройки.

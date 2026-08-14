import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Cloud, Eye, EyeOff, Loader2 } from "lucide-react";
import { DriveApp } from "@/components/drive/drive-app";
import { SharedView } from "@/components/share/shared-view";
import { apiFetch } from "@/lib/api";
import { isConfigured, requireSupabase, supabase } from "@/lib/supabase";

function ConfigurationRequired() {
  return <main className="setup-page"><div className="setup-card"><Cloud size={34} /><h1>Нужно завершить настройку</h1><p>Сайт опубликован, но публичные параметры Supabase ещё не добавлены в GitHub.</p></div></main>;
}

function AuthForm() {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage(null);
    try {
      const client = requireSupabase();
      if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${import.meta.env.BASE_URL}?mode=update` });
        if (error) throw error;
        setMessage("Письмо для восстановления отправлено.");
        return;
      }
      const result = mode === "login"
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` } });
      if (result.error) throw result.error;
      if (mode === "register" && !result.data.session) setMessage("Проверьте почту и подтвердите регистрацию.");
      if (result.data.session) await apiFetch("/api/auth/event", { method: "POST" }).catch(() => undefined);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось связаться с сервисом входа.";
      setMessage(text === "Invalid login credentials" ? "Неверная почта или пароль." : text);
    } finally { setLoading(false); }
  }

  return <div className="auth-shell"><section className="auth-card" aria-labelledby="auth-title">
    <div className="brand-mark large"><Cloud size={26} strokeWidth={2.2} /></div><p className="eyebrow">ЛИЧНОЕ ОБЛАКО</p>
    <h1 id="auth-title">{mode === "login" ? "С возвращением" : mode === "register" ? "Создайте аккаунт" : "Восстановление пароля"}</h1>
    <p className="auth-subtitle">{mode === "reset" ? "Мы отправим ссылку на вашу электронную почту." : "Ваши файлы доступны только после входа."}</p>
    <form onSubmit={submit} className="auth-form"><label>Электронная почта<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      {mode !== "reset" && <label>Пароль<span className="password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>}
      {message && <p className="form-message" role="status">{message}</p>}<button className="primary-button auth-submit" disabled={loading}>{loading && <Loader2 size={17} className="spin" />}{mode === "login" ? "Войти" : mode === "register" ? "Зарегистрироваться" : "Отправить письмо"}</button>
    </form><div className="auth-links"><button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Нет аккаунта? Создать" : "Вернуться ко входу"}</button>{mode === "login" && <button className="text-button" onClick={() => setMode("reset")}>Забыли пароль?</button>}</div>
  </section><aside className="auth-visual" aria-hidden="true"><div className="auth-orb orb-one" /><div className="auth-orb orb-two" /><div className="auth-feature-card"><span>НАДЁЖНОЕ ХРАНЕНИЕ</span><strong>До 500 ГБ для двух пользователей</strong><p>Прямые загрузки в приватное объектное хранилище. Доступ только по временным ссылкам.</p></div></aside></div>;
}

function UpdatePassword() {
  const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); const { error } = await requireSupabase().auth.updateUser({ password }); setBusy(false); if (error) setMessage(error.message); else { history.replaceState({}, "", import.meta.env.BASE_URL); location.reload(); } }
  return <main className="setup-page"><form className="setup-card auth-form" onSubmit={submit}><Cloud size={30} /><h1>Новый пароль</h1><label>Пароль<input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message && <p className="form-message">{message}</p>}<button className="primary-button" disabled={busy}>{busy && <Loader2 size={16} className="spin" />}Сохранить</button></form></main>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!isConfigured) return <ConfigurationRequired />;
  if (new URLSearchParams(location.search).get("mode") === "update") return <UpdatePassword />;
  const share = new URLSearchParams(location.search).get("share");
  if (share) return <SharedView token={share} />;
  if (!ready) return <main className="setup-page"><Loader2 className="spin" /></main>;
  return session ? <DriveApp initialEmail={session.user.email ?? "Пользователь"} /> : <AuthForm />;
}

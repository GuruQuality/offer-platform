import { useState, type FormEvent } from "react";
import type {
  CreateOfferRequest,
  CreateOfferResponse,
  OfferRequest,
  OfferResponse,
  User,
  UserRole,
} from "./types";
import "./App.css";

const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const SESSION_STORAGE_KEY = "offer-portal.session.v1";
const CATALOG_STORAGE_KEY = "offer-portal.catalog.v1";
const CLIENT_VERSION = "1.0";
const CLIENT_LOGIN = "user-123";
const MARKETOLOGIST_LOGIN = "admin";

const FALLBACK_OFFERS = ["summer_sale", "welcome_bonus", "vip_club"];

const OFFER_LABELS: Record<string, string> = {
  summer_sale: "Летняя распродажа",
  welcome_bonus: "Приветственный бонус",
  vip_club: "VIP-клуб",
};

type Notice = {
  tone: "info" | "error";
  text: string;
};

type CouponResult =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; notice: string; offerId: string }
  | { status: "empty" }
  | { status: "error"; message: string };

type Feedback = {
  tone: "success" | "error";
  text: string;
};

// Отдельный тип ошибки позволяет интерфейсу отличать 404 от сетевого сбоя.
class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<User>;
  if (candidate.role !== "client" && candidate.role !== "marketer") {
    return false;
  }

  if (typeof candidate.login !== "string" || !candidate.login) {
    return false;
  }

  if (candidate.role === "client") {
    return typeof candidate.userId === "string" && candidate.userId.length > 0;
  }

  return true;
}

// Сессия хранится только в localStorage и восстанавливается при загрузке SPA.
function readSession(): User | null {
  try {
    const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) {
      return null;
    }

    const parsedSession: unknown = JSON.parse(rawSession);
    return isUser(parsedSession) ? parsedSession : null;
  } catch {
    return null;
  }
}

function persistSession(user: User | null): void {
  try {
    if (user) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // localStorage может быть недоступен в приватном режиме — приложение
    // продолжит работать без сохранения сессии.
  }
}

function readCachedOffers(): string[] {
  try {
    const rawOffers = window.localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!rawOffers) {
      return [...FALLBACK_OFFERS];
    }

    const parsedOffers: unknown = JSON.parse(rawOffers);
    if (!Array.isArray(parsedOffers)) {
      return [...FALLBACK_OFFERS];
    }

    return parsedOffers.filter(
      (code): code is string => typeof code === "string" && code.length > 0,
    );
  } catch {
    return [...FALLBACK_OFFERS];
  }
}

function cacheOffers(offers: string[]): void {
  try {
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(offers));
  } catch {
    // Кэш не критичен для работы интерфейса.
  }
}

function humanizeOfferCode(code: string): string {
  const normalized = code.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "Без названия";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function offerLabel(code: string): string {
  return OFFER_LABELS[code] ?? humanizeOfferCode(code);
}

function uniqueOffers(offers: string[]): string[] {
  return [...new Set(offers.map((code) => code.trim()).filter(Boolean))];
}

// Небольшой клиент API: наружу отдаём только понятные состояния интерфейса,
// без сырых JSON-ответов и технических сообщений.
async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status);
  }
}

async function fetchOfferCodes(): Promise<string[]> {
  const data = await requestJson<unknown>("/admin/offers");
  if (!Array.isArray(data) || !data.every((item) => typeof item === "string")) {
    throw new Error("Unexpected catalog response");
  }

  return uniqueOffers(data);
}

async function createOffer(payload: CreateOfferRequest): Promise<void> {
  await requestJson<CreateOfferResponse>("/admin/offers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function requestPersonalOffer(
  userId: string,
  ruleName: string,
): Promise<{ notice: string; offerId: string } | null> {
  const payload: OfferRequest = {
    userId,
    ruleName,
    eventTs: new Date().toISOString(),
    triggerTs: new Date().toISOString(),
    metadata: {
      source: "web",
      userId,
      clientVersion: CLIENT_VERSION,
    },
  };

  const response = await requestJson<OfferResponse>("/alpha/request", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const offer = response.offers?.[0];
  if (!offer) {
    return null;
  }

  return {
    notice: offer.notice,
    offerId: offer.details?.offerId ?? "—",
  };
}

function resultFromError(error: unknown): CouponResult {
  if (error instanceof ApiError && error.status === 404) {
    return { status: "empty" };
  }

  return {
    status: "error",
    message: "Сервис предложений временно недоступен. Попробуйте ещё раз.",
  };
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(readSession);
  const [offers, setOffers] = useState<string[]>(readCachedOffers);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersNotice, setOffersNotice] = useState<Notice | null>(null);

  // Каталог обновляется после входа и после создания новой акции.
  async function refreshOffers(): Promise<string[] | null> {
    setOffersLoading(true);
    setOffersNotice(null);

    try {
      const catalog = await fetchOfferCodes();
      setOffers(catalog);
      cacheOffers(catalog);
      if (catalog.length === 0) {
        setOffersNotice({
          tone: "info",
          text: "В каталоге пока нет акций. Добавьте первую акцию слева.",
        });
      }
      return catalog;
    } catch {
      setOffersNotice({
        tone: "error",
        text: "Не удалось загрузить каталог акций. Проверьте, что сервер запущен.",
      });
      return null;
    } finally {
      setOffersLoading(false);
    }
  }

  function handleLogin(user: User): void {
    persistSession(user);
    setCurrentUser(user);
    void refreshOffers();
  }

  function handleLogout(): void {
    persistSession(null);
    setCurrentUser(null);
    setOffersNotice(null);
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-frame">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />

      <AppHeader user={currentUser} onLogout={handleLogout} />

      {currentUser.role === "client" ? (
        <ClientView
          user={currentUser}
          offers={offers}
          loading={offersLoading}
          notice={offersNotice}
          onRefresh={refreshOffers}
        />
      ) : (
        <AdminView
          offers={offers}
          loading={offersLoading}
          notice={offersNotice}
          onRefresh={refreshOffers}
        />
      )}

      <footer className="app-footer">
        <span>Offer Portal</span>
        <span>Персональные предложения для ваших клиентов</span>
      </footer>
    </div>
  );
}

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

function LoginScreen({ onLogin }: LoginScreenProps) {
  const [role, setRole] = useState<UserRole>("client");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const normalizedLogin = login.trim();
    const expectedLogin =
      role === "marketer" ? MARKETOLOGIST_LOGIN : CLIENT_LOGIN;

    if (normalizedLogin !== expectedLogin || password !== expectedLogin) {
      setError("Неверный логин или пароль");
      return;
    }

    setError("");

    if (role === "client") {
      onLogin({
        role: "client",
        login: CLIENT_LOGIN,
        displayName: "Клиент",
        userId: CLIENT_LOGIN,
      });
      return;
    }

    onLogin({
      role: "marketer",
      login: MARKETOLOGIST_LOGIN,
      displayName: "Маркетолог",
    });
  }

  return (
    <main className="auth-screen">
      <div className="auth-grid" aria-hidden="true" />
      <div className="auth-glow" aria-hidden="true" />

      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <span>Offer Portal</span>
        </div>

        <div className="auth-heading">
          <p className="eyebrow">Корпоративная платформа</p>
          <h1>Вход в систему</h1>
          <p>Управляйте предложениями или смотрите, что подготовлено для вас.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <fieldset className="role-switch">
            <legend>Я хочу войти как</legend>
            <div className="role-switch__options">
              <label
                className={`role-option ${role === "client" ? "is-active" : ""}`}
              >
                <input
                  type="radio"
                  name="role"
                  value="client"
                  checked={role === "client"}
                  onChange={() => {
                    setRole("client");
                    setError("");
                  }}
                />
                <span className="role-option__mark" aria-hidden="true">
                  ◌
                </span>
                <span>
                  <strong>Я клиент</strong>
                  <small>Мои предложения</small>
                </span>
              </label>

              <label
                className={`role-option ${
                  role === "marketer" ? "is-active" : ""
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="marketer"
                  checked={role === "marketer"}
                  onChange={() => {
                    setRole("marketer");
                    setError("");
                  }}
                />
                <span className="role-option__mark" aria-hidden="true">
                  ✦
                </span>
                <span>
                  <strong>Я маркетолог</strong>
                  <small>Управление акциями</small>
                </span>
              </label>
            </div>
          </fieldset>

          <label className="field">
            <span>Логин</span>
            <input
              type="text"
              value={login}
              onChange={(event) => {
                setLogin(event.target.value);
                setError("");
              }}
              placeholder={
                role === "marketer" ? MARKETOLOGIST_LOGIN : CLIENT_LOGIN
              }
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder="Введите пароль"
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="button button--primary button--wide" type="submit">
            Войти
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <p className="auth-hint">
          Доступы: <strong>admin/admin</strong> (Админ) или{" "}
          <strong>user-123/user-123</strong> (Клиент)
        </p>
      </section>

      <p className="auth-footer">© Offer Portal · Внутренняя демонстрационная среда</p>
    </main>
  );
}

interface AppHeaderProps {
  user: User;
  onLogout: () => void;
}

function AppHeader({ user, onLogout }: AppHeaderProps) {
  const isClient = user.role === "client";

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <div>
          <span className="brand__name">Offer Portal</span>
          <span className="brand__caption">Персональные офферы</span>
        </div>
      </div>

      <div className="topbar__account">
        <span className={`presence-dot ${isClient ? "is-client" : "is-admin"}`} />
        <div className="topbar__identity">
          <p>
            {isClient ? "Вы вошли как клиент" : "Вы вошли как Маркетолог"}
            {isClient ? <span> ({user.userId})</span> : null}
          </p>
          <span>{isClient ? "Ваша витрина" : "Центр управления"}</span>
        </div>
        <button className="button button--ghost" type="button" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </header>
  );
}

interface ClientViewProps {
  user: User;
  offers: string[];
  loading: boolean;
  notice: Notice | null;
  onRefresh: () => Promise<string[] | null>;
}

function ClientView({
  user,
  offers,
  loading,
  notice,
  onRefresh,
}: ClientViewProps) {
  const [selectedOffer, setSelectedOffer] = useState(offers[0] ?? "");
  const [result, setResult] = useState<CouponResult>({ status: "idle" });
  const activeOffer = offers.includes(selectedOffer)
    ? selectedOffer
    : offers[0] ?? "";

  async function handleCheck(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activeOffer) {
      return;
    }

    setResult({ status: "loading" });

    try {
      const offer = await requestPersonalOffer(
        user.userId ?? CLIENT_LOGIN,
        activeOffer,
      );
      setResult(offer ? { status: "success", ...offer } : { status: "empty" });
    } catch (error) {
      setResult(resultFromError(error));
    }
  }

  return (
    <main className="page">
      <section className="client-hero">
        <div className="client-hero__copy">
          <p className="eyebrow eyebrow--light">Витрина предложений</p>
          <h1>
            Предложения,
            <br />
            которые ждут именно вас.
          </h1>
          <p className="client-hero__lead">
            Выберите интересующую акцию и посмотрите, что мы подготовили для
            вашего профиля.
          </p>
        </div>

        <div className="client-hero__note">
          <span className="client-hero__spark" aria-hidden="true">
            ✦
          </span>
          <p>Одно нажатие — и персональное предложение появится здесь.</p>
        </div>
      </section>

      <div className="client-grid">
        <section className="panel panel--picker">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Шаг 01</p>
              <h2>Выберите акцию</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
            >
              {loading ? "Обновляем…" : "Обновить"}
            </button>
          </div>

          <form className="picker-form" onSubmit={handleCheck}>
            <label className="field field--select">
              <span>Доступные акции</span>
              <select
                value={activeOffer}
                onChange={(event) => {
                  setSelectedOffer(event.target.value);
                  setResult({ status: "idle" });
                }}
                disabled={offers.length === 0 || loading}
              >
                {offers.length === 0 ? (
                  <option value="">Нет доступных акций</option>
                ) : (
                  offers.map((code) => (
                    <option key={code} value={code}>
                      {offerLabel(code)}
                    </option>
                  ))
                )}
              </select>
            </label>

            {notice ? (
              <p
                className={`inline-notice inline-notice--${notice.tone}`}
                role={notice.tone === "error" ? "alert" : "status"}
              >
                {notice.text}
              </p>
            ) : null}

            <button
              className="button button--primary button--wide"
              type="submit"
              disabled={!activeOffer || result.status === "loading"}
            >
              {result.status === "loading" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Проверяем…
                </>
              ) : (
                <>
                  Проверить предложения
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>

            <p className="secure-note">
              <span aria-hidden="true">◎</span>
              Безопасная проверка для профиля {user.userId}
            </p>
          </form>
        </section>

        <section className="panel panel--result">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Шаг 02</p>
              <h2>Ваше предложение</h2>
            </div>
            <span className="live-badge">
              <span aria-hidden="true" />
              Персонально
            </span>
          </div>

          <OfferResult result={result} />
        </section>
      </div>
    </main>
  );
}

interface AdminViewProps {
  offers: string[];
  loading: boolean;
  notice: Notice | null;
  onRefresh: () => Promise<string[] | null>;
}

function AdminView({ offers, loading, notice, onRefresh }: AdminViewProps) {
  const [newCode, setNewCode] = useState("");
  const [newNotice, setNewNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [testUserId, setTestUserId] = useState(CLIENT_LOGIN);
  const [testOffer, setTestOffer] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CouponResult>({ status: "idle" });
  const activeTestOffer = offers.includes(testOffer)
    ? testOffer
    : offers[0] ?? "";

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const code = newCode.trim();
    const noticeText = newNotice.trim();

    if (!code || !noticeText) {
      setFeedback({
        tone: "error",
        text: "Заполните код акции и текст оффера.",
      });
      return;
    }

    setCreating(true);
    setFeedback(null);

    try {
      await createOffer({ ruleName: code, notice: noticeText });
      const refreshed = await onRefresh();
      setNewCode("");
      setNewNotice("");
      setFeedback({
        tone: "success",
        text: refreshed
          ? `Акция «${offerLabel(code)}» опубликована.`
          : "Акция создана, но каталог не удалось обновить. Нажмите «Обновить».",
      });
    } catch {
      setFeedback({
        tone: "error",
        text: "Не удалось создать акцию. Проверьте соединение и попробуйте ещё раз.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleTest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activeTestOffer) {
      return;
    }

    setTesting(true);
    setTestResult({ status: "loading" });

    try {
      const offer = await requestPersonalOffer(
        testUserId.trim() || CLIENT_LOGIN,
        activeTestOffer,
      );
      setTestResult(
        offer ? { status: "success", ...offer } : { status: "empty" },
      );
    } catch (error) {
      setTestResult(resultFromError(error));
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="page">
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Кабинет маркетолога</p>
          <h1>Управление офферами</h1>
          <p>
            Создавайте акции для клиентов и проверяйте, как они выглядят на
            витрине.
          </p>
        </div>

        <div className="admin-stats" aria-label="Сводка каталога">
          <div className="stat-card">
            <strong>{offers.length}</strong>
            <span>акций в каталоге</span>
          </div>
          <div className="stat-card stat-card--accent">
            <span className="stat-card__dot" aria-hidden="true" />
            <strong>Live</strong>
            <span>витрина активна</span>
          </div>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel panel--create">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Новая акция</p>
              <h2>Создать предложение</h2>
            </div>
          </div>

          <form className="admin-form" onSubmit={handleCreate}>
            <label className="field">
              <span>Код акции</span>
              <input
                type="text"
                value={newCode}
                onChange={(event) => setNewCode(event.target.value)}
                placeholder="Например, spring_gift"
                autoCapitalize="none"
                spellCheck={false}
              />
              <small>Короткий идентификатор для внутреннего каталога.</small>
            </label>

            <label className="field">
              <span>Текст оффера</span>
              <textarea
                value={newNotice}
                onChange={(event) => setNewNotice(event.target.value)}
                placeholder="Что увидит клиент в персональном предложении"
                rows={5}
              />
            </label>

            {feedback ? (
              <p
                className={`inline-notice inline-notice--${feedback.tone}`}
                role={feedback.tone === "error" ? "alert" : "status"}
              >
                {feedback.text}
              </p>
            ) : null}

            <button
              className="button button--primary button--wide"
              type="submit"
              disabled={creating}
            >
              {creating ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Создаём…
                </>
              ) : (
                <>
                  Создать акцию
                  <span aria-hidden="true">＋</span>
                </>
              )}
            </button>
          </form>

          <div className="form-aside">
            <span aria-hidden="true">✦</span>
            <p>Опубликованная акция сразу появится в списке справа.</p>
          </div>
        </section>

        <section className="panel panel--catalog">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Каталог</p>
              <h2>Активные акции</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
            >
              {loading ? "Обновляем…" : "Обновить"}
            </button>
          </div>

          {notice ? (
            <p
              className={`inline-notice inline-notice--${notice.tone}`}
              role={notice.tone === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          ) : null}

          {offers.length === 0 ? (
            <div className="catalog-empty">
              <span aria-hidden="true">✦</span>
              <p>В каталоге пока нет акций.</p>
            </div>
          ) : (
            <ul className="offer-list">
              {offers.map((code, index) => (
                <li className="offer-card" key={code}>
                  <span className="offer-card__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="offer-card__body">
                    <strong>{offerLabel(code)}</strong>
                    <span>{code}</span>
                  </div>
                  <span className="offer-card__status">
                    <span aria-hidden="true" />
                    Активна
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="test-studio">
            <div className="test-studio__heading">
              <div>
                <p className="eyebrow">Проверка</p>
                <h3>Посмотреть глазами клиента</h3>
              </div>
              <span className="test-studio__icon" aria-hidden="true">
                ◌
              </span>
            </div>

            <form className="test-form" onSubmit={handleTest}>
              <label className="field">
                <span>ID клиента</span>
                <input
                  type="text"
                  value={testUserId}
                  onChange={(event) => setTestUserId(event.target.value)}
                  placeholder="user-123"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>

              <label className="field field--select">
                <span>Акция</span>
                <select
                  value={activeTestOffer}
                  onChange={(event) => setTestOffer(event.target.value)}
                  disabled={offers.length === 0}
                >
                  {offers.length === 0 ? (
                    <option value="">Нет доступных акций</option>
                  ) : (
                    offers.map((code) => (
                      <option key={code} value={code}>
                        {offerLabel(code)}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                className="button button--secondary"
                type="submit"
                disabled={!activeTestOffer || testing}
              >
                {testing ? "Проверяем…" : "Проверить"}
              </button>
            </form>

            <OfferResult result={testResult} compact />
          </div>
        </section>
      </div>
    </main>
  );
}

interface OfferResultProps {
  result: CouponResult;
  compact?: boolean;
}

function OfferResult({ result, compact = false }: OfferResultProps) {
  const wrapperClass = `offer-result ${compact ? "offer-result--compact" : ""}`;

  if (result.status === "loading") {
    return (
      <div className={`${wrapperClass} offer-result--loading`} aria-live="polite">
        <span className="spinner spinner--dark" aria-hidden="true" />
        <p>Собираем лучшее предложение…</p>
      </div>
    );
  }

  if (result.status === "success") {
    return (
      <div className={wrapperClass} aria-live="polite">
        <article className="coupon">
          <div className="coupon__icon" aria-hidden="true">
            🎁
          </div>
          <div className="coupon__content">
            <p className="coupon__eyebrow">Персональное предложение</p>
            <h3>{result.notice}</h3>
            <p className="coupon__meta">Купон · {result.offerId}</p>
          </div>
          <div className="coupon__stub" aria-hidden="true">
            <span>Ваш</span>
            <strong>offer</strong>
          </div>
        </article>
      </div>
    );
  }

  if (result.status === "empty") {
    return (
      <div className={`${wrapperClass} offer-result--empty`} aria-live="polite">
        <span className="result-emoji" aria-hidden="true">
          📭
        </span>
        <div>
          <h3>Для вас пока нет активных предложений</h3>
          <p>Загляните чуть позже — мы уже готовим что-то интересное.</p>
        </div>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className={`${wrapperClass} offer-result--error`} role="alert">
        <span className="result-emoji" aria-hidden="true">
          ⚠
        </span>
        <div>
          <h3>Не удалось получить предложение</h3>
          <p>{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${wrapperClass} offer-result--idle`}>
      <div className="result-idle__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <h3>Здесь появится ваш оффер</h3>
        <p>
          {compact
            ? "Выберите акцию и нажмите «Проверить»."
            : "Выберите акцию и нажмите «Проверить предложения»."}
        </p>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
    </span>
  );
}

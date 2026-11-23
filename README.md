# Offer Platform

Локальный демонстрационный проект:

- **Mock Offer API** — FastAPI-сервер с mock-эндпоинтами и Swagger;
- **Offer Portal** — SPA на React + TypeScript + Vite для клиентов и
  маркетологов.

Все команды ниже выполняются **из корня проекта** — папки, в которой лежат
этот README, `mock-api/` и `offer-portal/`.

> Скачали проект впервые? Начните с раздела «Первая установка», затем перейдите
> к разделу «Запуск».

## Требования

- Python 3.10 или новее;
- Node.js `^20.19.0` или `>=22.12.0`;
- npm (устанавливается вместе с Node.js).

Проверить версии:

```bash
python3 --version
node --version
npm --version
```

Папки `.venv/` и `node_modules/` не входят в архив проекта. Их нужно создать
один раз командами ниже.

## Первая установка

### 1. Зависимости API

```bash
cd mock-api
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
```

Для запуска тестов дополнительно:

```bash
./.venv/bin/python -m pip install -r requirements-dev.txt
```

Активировать виртуальное окружение не обязательно: все команды используют
Python напрямую из `.venv`.

### 2. Зависимости SPA

В другом терминале из корня проекта:

```bash
cd offer-portal
npm install
```

`npm install` нужен только при первом запуске или после изменения
`package.json`.

## Запуск

Нужны два терминала. Оба открываются из корня проекта.

### Терминал 1 — API

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --reload --port 8000
```

Оставьте терминал открытым. В логе появятся строки:

```text
Uvicorn running on http://127.0.0.1:8000
Swagger UI: http://127.0.0.1:8000/docs
```

### Терминал 2 — SPA

```bash
cd offer-portal
npm run dev
```

Дождитесь строки:

```text
Local: http://127.0.0.1:5173/
```

Откройте в браузере:

- SPA: <http://127.0.0.1:5173>
- Swagger API: <http://127.0.0.1:8000/docs>

Корень API `http://127.0.0.1:8000/` специально возвращает `404 EMPTY_PATH` —
документация находится по адресу `/docs`.

Остановить любой процесс: `Ctrl+C` в его терминале.

## Тестовые доступы

| Роль | Логин | Пароль | Что доступно |
|---|---|---|---|
| Клиент | `user-123` | `user-123` | Выбор акции и персональный оффер |
| Маркетолог | `admin` | `admin` | Создание акций и проверка офферов |

Сессия сохраняется в `localStorage`: после обновления страницы пользователь
остаётся в системе. Для выхода используйте кнопку «Выйти».

## Перезапуск

Обычно перезапускать вручную ничего не нужно:

- Uvicorn с флагом `--reload` сам перезапускается при изменении Python-кода;
- Vite сам обновляет страницу при изменении React-кода.

Перезапуск нужен после изменения `.env`, установки новых npm-пакетов или если
процесс был остановлен.

### Перезапустить API

В терминале с Uvicorn нажмите `Ctrl+C`, затем:

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --reload --port 8000
```

### Перезапустить SPA

В терминале с Vite нажмите `Ctrl+C`, затем:

```bash
cd offer-portal
npm run dev
```

После строки `Local: http://127.0.0.1:5173/` обновите страницу в браузере.

## Настройка адреса API

По умолчанию SPA обращается к `http://127.0.0.1:8000`. Если API работает на
этом адресе, создавать `.env` **не нужно**.

Файл нужен только при другом адресе или порту:

```bash
cd offer-portal
cp .env.example .env
```

```env
VITE_API_URL=http://127.0.0.1:8000
```

После изменения `.env` перезапустите Vite по инструкции выше.

## API-эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/alpha/request` | Получить персональный оффер |
| `POST` | `/beta/request` | Альтернативная среда |
| `GET` | `/admin/offers` | Каталог акций |
| `POST` | `/admin/offers` | Создать акцию |

Каталог акций хранится в памяти mock-сервера. После перезапуска API остаются
только три стартовые акции: `summer_sale`, `welcome_bonus`, `vip_club`.

## Тесты

### API — быстрые тесты без запуска сервера

Сначала установите dev-зависимости:

```bash
cd mock-api
./.venv/bin/python -m pip install -r requirements-dev.txt
./.venv/bin/python -m pytest -q
```

Ожидаемо: `23 passed, 2 skipped`.

### API — интеграционные тесты

Нужны два терминала. В первом запущен API на порту `8000`, во втором из корня
проекта:

```bash
cd mock-api
MOCK_API_BASE_URL=http://127.0.0.1:8000 \
  ./.venv/bin/python -m pytest -m integration -q --tb=short
```

Ожидаемо: `2 passed`. Если API остановлен, эти тесты упадут с сообщением
`Mock API недоступен`.

### Frontend — production-сборка

```bash
cd offer-portal
npm run build
```

Команда проверяет TypeScript и собирает проект в `offer-portal/dist/`.

## Что внутри

```text
.
├── mock-api/       # FastAPI, Swagger, тесты, Postman-коллекция
└── offer-portal/   # React + TypeScript + Vite SPA
```

- [Подробно об API](mock-api/README.md)
- [Подробно о SPA](offer-portal/README.md)

## Если что-то не запускается

### `command not found: uvicorn`

Используйте Python из `.venv`:

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --reload --port 8000
```

Если ошибка `No module named uvicorn`, повторите установку:

```bash
cd mock-api
./.venv/bin/python -m pip install -r requirements.txt
```

### `address already in use`

Порт `8000` или `5173` уже занят. Остановите старый процесс через `Ctrl+C`.
Если API запущен на другом порту, укажите новый адрес в `offer-portal/.env`
и перезапустите Vite.

Посмотреть, какой процесс занимает порт:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

### SPA открылась, но данные не загружаются

Проверьте:

1. API запущен на `http://127.0.0.1:8000`.
2. Терминал SPA находится в папке `offer-portal`.
3. В `offer-portal/.env` указан правильный `VITE_API_URL`.
4. После изменения `.env` Vite был перезапущен.

Если Swagger открывается, но SPA получает ошибку соединения, проверьте адрес
API в `.env`.

### Windows

Вместо `./.venv/bin/python` используйте:

```text
.venv\Scripts\python.exe
```

Остальные команды (`npm install`, `npm run dev`) выполняются так же.

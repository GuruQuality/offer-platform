# Mock Offer API

Локальный mock-сервер на FastAPI с автоматической Swagger/OpenAPI-документацией.

> Запуск всего проекта — API и SPA — описан в [корневом README](../README.md).

Команды ниже выполняются из корня проекта, где лежит папка `mock-api`.
Если вы уже находитесь внутри `mock-api`, первый `cd` не нужен.

## Быстрый запуск

Если окружение `.venv` уже создано и зависимости установлены:

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --reload --port 8000
```

Активировать виртуальное окружение не обязательно: команда использует Python напрямую из `.venv`.

При старте в логах появится ссылка на документацию:

```text
INFO:     Swagger UI: http://127.0.0.1:8000/docs
```

Адрес автоматически учитывает параметры `--host` и `--port`, с которыми
запущен Uvicorn.

После запуска:

- Swagger UI: <http://127.0.0.1:8000/docs>
- OpenAPI JSON: <http://127.0.0.1:8000/openapi.json>
- ReDoc: <http://127.0.0.1:8000/redoc>

Сервер работает, пока открыт терминал. Остановить его: `Ctrl+C`.

## Запуск с нуля

Требуется Python 3.10+.

```bash
cd mock-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000
```

## Кому доступен Swagger

По умолчанию сервер слушает только `127.0.0.1` (`localhost`), поэтому
Swagger доступен **только на текущем компьютере**. У каждого разработчика,
который запускает проект, будет собственный локальный экземпляр и собственный
адрес `/docs`.

Ссылка `http://127.0.0.1:8000/docs` не является общим адресом: на другом
компьютере она указывает на его собственный `localhost`. Если у человека
сервер не запущен, страница не откроется.

### Показать коллегам в локальной сети

Можно разрешить подключения с других устройств в той же сети:

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Узнать IP-адрес Mac:

```bash
ipconfig getifaddr en0
```

Коллеги откроют Swagger по адресу `http://<IP-адрес>:8000/docs`, например
`http://192.168.1.15:8000/docs`. Устройства должны быть в одной сети, а
macOS может запросить разрешение на входящие подключения.

Этот способ подходит только для доверенной локальной сети: в mock-сервере
нет авторизации. Не стоит публиковать его в интернете без защиты.

### Показать через интернет

Для удалённого доступа можно временно открыть туннель, например через
`ngrok http 8000`, либо развернуть приложение на облачном хостинге. Перед
публикацией нужно учитывать, что API не защищён авторизацией.

## Эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/alpha/request` | Тестовая среда |
| `POST` | `/beta/request` | Среда исполнения |
| `GET` | `/admin/offers` | Список кодов акций для SPA |
| `POST` | `/admin/offers` | Создание или обновление акции |

### Управление акциями

```http
GET /admin/offers
```

Возвращает список кодов:

```json
["summer_sale", "welcome_bonus", "vip_club"]
```

```http
POST /admin/offers
Content-Type: application/json

{
  "ruleName": "spring_gift",
  "notice": "Весенний подарок: скидка 15% на первый заказ."
}
```

Ответ:

```json
{ "status": "created" }
```

Каталог акций хранится в памяти и сбрасывается при перезапуске Uvicorn.
Для локального SPA настроен CORS с адресов `localhost` и `127.0.0.1`.

Эндпоинты `alpha` и `beta` принимают одинаковый JSON:

```json
{
  "userId": "user-123",
  "ruleName": "rule-1",
  "eventTs": "2025-01-01T10:00:00Z",
  "triggerTs": "2025-01-01T10:05:00Z",
  "metadata": {
    "userId": "user-123",
    "source": "web"
  }
}
```

Все пять полей (`userId`, `ruleName`, `eventTs`, `triggerTs`, `metadata`)
обязательны для успешного ответа `200`.

> Порядок ключей внутри JSON-объекта не имеет значения. Swagger UI может
> отображать те же поля в алфавитном порядке — это не другой контракт и не
> ошибка. Это относится к запросам, успешным ответам и ответам с ошибками.

### Успешный ответ (200)

```bash
curl -i -X POST http://127.0.0.1:8000/alpha/request \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","ruleName":"rule-1","eventTs":"2025-01-01T10:00:00Z","triggerTs":"2025-01-01T10:05:00Z","metadata":{"userId":"user-123","source":"web"}}'
```

```json
{
  "traceId": "trace-1a2b3c4d",
  "userId": "user-123",
  "timestamp": "2025-01-01T10:05:01Z",
  "offers": [
    {
      "details": {
        "offerId": "offer-1",
        "noticeId": "notice-1"
      },
      "notice": "Оффер успешен"
    }
  ]
}
```

`traceId` и `timestamp` генерируются при каждом запросе.

### Не хватает обязательного поля (400)

```bash
curl -i -X POST http://127.0.0.1:8000/alpha/request \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","ruleName":"rule-1","triggerTs":"2025-01-01T10:05:00Z","metadata":{"userId":"user-123"}}'
```

В запросе выше отсутствует `eventTs`:

```json
{
  "state": "400",
  "code": "BAD_REQUEST",
  "details": "eventTs is required",
  "traceId": "trace-bad-400",
  "timestamp": "2025-01-01T10:05:02Z",
  "userId": "user-123"
}
```

Аналогично возвращается `400 BAD_REQUEST`, если отсутствуют `userId`,
`triggerTs` или `metadata`, а также при некорректном JSON.

### Пустой или отсутствующий ruleName (404)

```bash
curl -i -X POST http://127.0.0.1:8000/beta/request \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","ruleName":"","eventTs":"2025-01-01T10:00:00Z","triggerTs":"2025-01-01T10:05:00Z","metadata":{"userId":"user-123"}}'
```

```json
{
  "state": "404",
  "code": "VALIDATION_ERROR",
  "details": "ruleName is empty",
  "traceId": "trace-def-456",
  "timestamp": "2025-01-01T10:05:03Z",
  "userId": "user-123"
}
```

### Несуществующий путь (404)

```bash
curl -i -X POST http://127.0.0.1:8000/alpha/wrong-endpoint \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-123","ruleName":"rule-1"}'
```

```json
{
  "state": "404",
  "code": "NOT_FOUND",
  "details": "Endpoint not found",
  "path": "/alpha/wrong-endpoint",
  "traceId": "trace-999-xyz",
  "timestamp": "2025-01-01T10:05:04Z",
  "userId": "user-123"
}
```

Если `userId` из тела извлечь не удалось, возвращается `"userId": "unknown"`.

### Корневой путь `/` (404)

```bash
curl -i http://127.0.0.1:8000/
```

```json
{
  "state": "404",
  "code": "EMPTY_PATH",
  "details": "Requested path is empty",
  "path": "",
  "traceId": "trace-empty-123",
  "timestamp": "2025-01-01T10:05:03Z",
  "userId": "unknown"
}
```

## Автотесты (pytest)

Основные тесты находятся в [tests/test_app.py](tests/test_app.py).
Сервер для них запускать не нужно: используется `TestClient`, который
поднимает приложение внутри процесса.

```bash
cd mock-api
./.venv/bin/python -m pip install -r requirements-dev.txt
./.venv/bin/python -m pytest
```

Тесты проверяют:

- успешные ответы `alpha` и `beta` со всеми обязательными полями;
- пустой, пробельный и отсутствующий `ruleName` (404);
- отсутствие каждого из полей `userId`, `eventTs`, `triggerTs`, `metadata` (400);
- пустой `userId` и некорректный JSON (400);
- несуществующий endpoint и извлечение `userId` из тела;
- корневой путь `/` и ответ `EMPTY_PATH`;
- создание акции через `/admin/offers` и её использование в `alpha`;
- CORS для локального frontend-приложения;
- наличие Swagger UI и корректность OpenAPI-схемы;
- формирование ссылки на Swagger с учётом `--host` и `--port`.

Всего 23 основных теста. Они не зависят от чужого `localhost` и будут работать у
любого человека после установки зависимостей.

### Проверка недоступности сервера

Обычные тесты используют `TestClient` и **не проверяют, запущен ли Uvicorn**.
Если остановить сервер, эти 23 теста всё равно пройдут — так и должно быть:
они тестируют приложение в изолированном процессе.

Для проверки именно доступности сервера есть отдельный файл
[tests/test_integration.py](tests/test_integration.py). Он не входит в
`test_app.py`. Эти тесты делают реальный HTTP-запрос через `urllib`, поэтому
сервер и тесты нужно запускать в двух терминалах.

**Терминал 1 — запуск сервера:**

```bash
cd mock-api
./.venv/bin/python -m uvicorn app:app --reload --port 8000
```

**Терминал 2 — запуск интеграционных тестов:**

```bash
cd mock-api
MOCK_API_BASE_URL=http://127.0.0.1:8000 \
  ./.venv/bin/python -m pytest -m integration -q --tb=short
```

Если сервер работает, результат будет `2 passed`. Если остановить сервер и
запустить команду ещё раз, оба теста упадут с сообщением:

```text
Mock API недоступен по адресу http://127.0.0.1:8000
```

Без переменной `MOCK_API_BASE_URL` интеграционные тесты пропускаются, поэтому
обычный запуск `pytest` не требует поднятого сервера.

### Запуск интеграционных тестов в PyCharm

PyCharm не получает переменную `MOCK_API_BASE_URL` из другого терминала — её
нужно указать в Run Configuration:

1. Запустите сервер в терминале (Терминал 1 выше).
2. В PyCharm откройте **Run → Edit Configurations…**
3. Выберите конфигурацию `test_integration.py` (pytest).
4. В поле **Environment variables** добавьте:
   `MOCK_API_BASE_URL=http://127.0.0.1:8000`
5. Укажите **Working directory** — полный путь к папке `mock-api` на вашем
   компьютере.
6. Нажмите **Apply**, затем запустите конфигурацию.

Если переменная не задана, PyCharm покажет `2 skipped` и код завершения `0`:
тесты не выполнялись, поэтому это не зелёный результат проверки API.

## Postman-коллекция

Готовые файлы:

- [Mock-Offer-API.postman_collection.json](postman/Mock-Offer-API.postman_collection.json) — коллекция запросов и проверок;
- [Mock-Offer-API.local.postman_environment.json](postman/Mock-Offer-API.local.postman_environment.json) — окружение с адресом `http://127.0.0.1:8000`.

### Как запустить в Postman

1. Запустите локальный сервер.
2. Откройте Postman → **Import** и импортируйте оба JSON-файла.
3. Выберите окружение **«Mock Offer API — Local»**.
4. Откройте коллекцию **Mock Offer API** и нажмите **Run**.

Коллекция содержит 12 запросов и 51 проверку:

- успешные запросы к `alpha` и `beta`;
- пустой и отсутствующий `ruleName` (404);
- отсутствие каждого обязательного поля (400);
- несуществующий endpoint;
- корневой путь `/`;
- проверку OpenAPI-схемы;
- проверку, что `/docs` возвращает HTML Swagger UI с подключённым
  `SwaggerUIBundle` и ссылкой на `/openapi.json`.

> Postman не выполняет JavaScript страницы. Тест проверяет, что сервер вернул
> полноценную HTML-оболочку Swagger UI, а не пустой ответ. Фактический
> визуальный рендеринг нужно проверять в браузере.

Все запросы используют переменную `{{baseUrl}}`, поэтому коллекция не привязана
к конкретному компьютеру. Каждый запускает свой сервер и свою копию коллекции.

Для запуска из терминала через Newman (требуется Node.js):

```bash
npx --yes newman run "postman/Mock-Offer-API.postman_collection.json" \
  -e "postman/Mock-Offer-API.local.postman_environment.json"
```

Если сервер запущен с `--host 0.0.0.0`, в окружении Postman можно заменить
`baseUrl` на `http://<IP-адрес>:8000`, чтобы проверить API с другого устройства.

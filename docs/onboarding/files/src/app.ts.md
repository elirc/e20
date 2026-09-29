# `src/app.ts`

## What This File Is For

This file builds the Fastify application and defines the HTTP API surface.

It is an API composition file and runtime boundary file. It is not where the business rules live. Its job is to:

- create the app
- instantiate the store and service
- convert requests into `RequestContext`
- register routes
- convert thrown errors into HTTP responses

## Why This File Matters

This file teaches a junior developer how the codebase wants layers to interact.

Broader concepts it teaches:

- thin controllers / thin routes
- request-to-context translation
- boundary-layer error handling
- route grouping by domain module

If you understand this file, you can answer “Where does a request enter?” and “Which service method owns this behavior?”

## Key Exports / Main Units

- `buildApp`
  - Creates the Fastify app, constructs `ERPStore` and `ERPService`, registers all routes, and installs the error handler.

Important internal units:

- `getContext`
  - Reads the bearer token and optional `x-company-id`, then delegates to `service.authenticate`.
- `rateLimitLogin`
  - A simple in-memory throttle for login attempts.
- route handlers
  - Mostly one-line delegates from URL paths to service methods.
- `app.setErrorHandler`
  - Converts thrown errors into HTTP status codes and a response shape with `requestId`.

## How It Works

The file starts by creating three things:

- a Fastify app
- an `ERPStore`
- an `ERPService`

That tells you an important design choice: the service owns behavior, and the store owns state.

Next, `getContext` pulls identity information out of headers:

- `Authorization: Bearer <token>`
- optional `x-company-id`

That context is then reused in almost every route. This is how the code avoids repeating authentication logic inside every handler.

The route section is organized by module:

- auth
- companies and master data
- CRM
- sales
- buying
- accounting
- inventory
- projects
- document comments and attachments
- dashboards, search, reports, audit logs

Most handlers are intentionally small. Example pattern:

```ts
app.post("/sales/invoices/:id/submit", async (request) =>
  service.submitSalesInvoice(getContext(request), String((request.params as { id: string }).id)),
);
```

This is a good pattern for business apps because:

- the HTTP layer stays predictable
- the service layer stays testable outside of HTTP if needed
- permission and side-effect logic has one main home

At the bottom, the error handler inspects the error message text and turns it into an HTTP status.

Observed from code:

- `Forbidden` -> `403`
- auth failures -> `401`
- rate limiting -> `429`
- `not found` -> `404`
- everything else -> `400`

That is simple, but it also means error message text is part of behavior.

## How It Connects To Other Files

Inbound relationships:

- `src/server.ts` calls `buildApp`.
- `tests/erp.test.ts` also calls `buildApp` to create an isolated app per test.

Outbound relationships:

- depends on `src/domain/store.ts` for state
- depends on `src/domain/erp-service.ts` for all domain behavior

Contract relationships that matter:

- routes assume the service will validate request bodies
- the error handler assumes service errors use certain message patterns
- auth assumes tokens and company scoping are enforced by the service and store

## Important Design Choices

- Thin route handlers instead of business-heavy controllers
  - Likely chosen to keep domain behavior centralized.
- Service and store created inside `buildApp`
  - Makes test isolation easy because each app gets fresh in-memory state.
- Manual route registration
  - Simple and readable in a small repo, though it can get repetitive as the API grows.
- In-memory login rate limiting
  - Good enough for an MVP, but not durable across processes or restarts.
- String-based error classification
  - Fast to implement, but weaker than typed domain errors.

## Things A Junior Dev Should Notice

- `app.ts` is deliberately repetitive in a useful way. Similar routes help you see the naming conventions.
- Request params are manually cast. That means the service is the real safety net for validation.
- Every authenticated route goes through `getContext`. If you add a route and forget this, you likely created a security bug.
- The route layer does not enforce module-specific permissions. The service does.
- The comments and attachments routes are generic by `entityType` and `id`, which is flexible but easier to misuse.

## Code Review Lens

If this file were in a pull request, a strong reviewer should focus on:

- whether new routes authenticate and scope correctly
- whether route naming matches existing conventions
- whether the route delegates to the right service method
- whether request parsing is safe enough before reaching the service
- whether new error behavior depends on fragile string matching

Correctness risks:

- missing auth context
- inconsistent route paths between similar modules
- accidental exposure of a privileged action

Maintainability concerns:

- route sprawl
- duplicated parsing logic
- error mapping growing more fragile as the service expands

## Common Change Scenarios

### 1. Add a new endpoint

Before editing:

- inspect a neighboring route in the same module
- confirm which service method should own the logic
- confirm the required role and company scope

### 2. Improve error handling

Before editing:

- inspect which service methods throw the relevant error text
- check tests that assert HTTP status codes
- consider whether a typed error system would be safer than more message parsing

### 3. Add request schemas or OpenAPI support

Before editing:

- inspect how `zod` validation currently lives in `erp-service.ts`
- decide whether validation should move upward or stay in the service

### 4. Extract route modules

Before editing:

- make sure shared concerns like `getContext` and error handling still behave the same
- avoid duplicating store/service creation or auth glue

## Suggested Exercises

- Trace `POST /buying/receipts/:id/submit` from route handler into the service and identify where stock and GL side effects happen.
- Find three places where adding a route without `getContext` would create a bug.
- Propose a typed error object design that could replace message-based HTTP status mapping.
- Identify one module whose routes are simple enough to extract into a separate registration helper.

## Observed Facts vs Inference

Observed from code:

- `buildApp` creates both the store and service.
- Most routes are thin wrappers over service methods.
- Login rate limiting is in-memory and keyed by IP.
- HTTP status mapping is based on error message contents.

Inference / likely intent:

- The author wants the domain layer to stay independent from HTTP details.
- The current route design favors clarity and testability over abstraction.
- Error handling is intentionally lightweight for the MVP stage, not because it is ideal long-term.

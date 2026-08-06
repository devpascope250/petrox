# Petrox backend

Fastify API implementing the initial `ROADMAP.md`, `SCHEMA.md`, and `TASK.md` scope: JWT access tokens, rotating opaque refresh tokens, password/PIN login, admin-issued password reset tokens, RBAC, permission-filtered sidebar modules, Zod validation, rate limiting, redacted structured logs, and Supertest integration tests.

## Local setup

1. Copy `.env.example` to `.env` and replace all secrets/default credentials.
2. Create the MySQL database specified by `DATABASE_URL`, then run `pnpm install` from the repository root.
3. Prisma generation runs automatically after install; run `pnpm prisma:migrate -- --name initial` from `backend`.
4. Run `pnpm prisma:seed`, then `pnpm dev`.

The API is under `/api/v1`; health is at `/health`. Passwords use bcrypt, while PINs use the separately keyed HMAC-SHA-256 required by the roadmap. Refresh/reset tokens are random opaque values stored only as SHA-256 hashes. Password reset invalidates active refresh tokens. Permission changes apply once the current short-lived access token expires.

Use `pnpm test`, `pnpm typecheck`, and `pnpm build` as the standard verification commands.

If an editor reports that Prisma cannot be resolved, run `pnpm install` (or `pnpm prisma:generate`) from the repository root, then restart its TypeScript server.

## Error contract

All failures return an error object containing statusCode, a machine-readable code, a safe message, requestId, and optional data.

Throw BusinessError, NotFoundError, ConflictError, or AppError from services for expected failures. Zod, authentication, Prisma, rate-limit, routing, and unexpected errors are normalized globally. Unexpected internal messages are logged with the request ID and never returned to clients.
## Shared validation

Reusable HTTP-boundary primitives and parsing helpers live in src/shared/validation. Modules should compose these primitives in their own schema files instead of duplicating email, password, PIN, token, UUID, name, phone, or pagination rules. Keep domain-specific validation inside the owning module.
## Request context and responses

Authenticated routes receive request.contextUser with userId, roleId, role, and permissions. Successful responses contain success true and data. Error responses contain success false plus statusCode, code, message, requestId, and optional data.

The idempotent seed catalogue creates Dashboard and an Administration hierarchy containing Users and Roles, attaches their permissions, and grants the complete catalogue to the fixed Administrator role.

## Package manager

Use pnpm 11.20.0 through Corepack from the repository root. The pnpm lockfile is canonical; CI should run pnpm install --frozen-lockfile.

## Pagination

List endpoints accept page and pageSize query parameters, defaulting to 1 and 20 with a maximum page size of 100. Shared helpers in src/shared/pagination produce Prisma skip/take arguments and return items with page, pageSize, total, totalPages, hasNextPage, and hasPreviousPage metadata. Users are ordered newest-first and roles alphabetically for stable page boundaries.
## Sidebar hierarchy

GET /api/v1/modules/sidebar returns modules as an arbitrarily deep children tree. The hierarchy includes ancestors required to reach permitted descendants, excludes branches with no permitted modules, and sorts every level by sorting followed by name. Parent containers do not grant access to unauthorized descendants.
## Validation errors

Validation failures use error.details rather than error.data. Each detail has field, code, and message values sourced from the schema, allowing clients to bind messages directly to form controls. Nested array paths use notation such as items[0].name, and cross-field or object-level errors use _root. The data field remains reserved for business or persistence error context.
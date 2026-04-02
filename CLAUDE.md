# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (install deps + DB init)
npm run setup

# Development server (port 3100, Turbopack)
npm run dev

# Run tests
npm test

# Run a single test file
npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx

# Lint
npm run lint

# Build
npm run build

# Reset database
npm run db:reset

# Regenerate Prisma client after schema changes
npx prisma generate && npx prisma migrate dev
```

Set `ANTHROPIC_API_KEY` in `.env` to enable real AI generation. Without it, a `MockLanguageModel` is used that returns static components.

## Code Style

- Use comments sparingly. Only comment complex code.

## Architecture

UIGen is a Next.js 15 App Router app where users describe React components in a chat interface and see them rendered live. All generated files exist only in memory — nothing is written to disk.

### Key data flow

1. User types a message → `ChatContext` calls `POST /api/chat` with the message history and serialized virtual FS
2. Server reconstructs the `VirtualFileSystem`, calls Claude (`claude-haiku-4-5`) via Vercel AI SDK with `streamText`, providing two tools: `str_replace_editor` and `file_manager`
3. Tool calls stream back to the client → `FileSystemContext.handleToolCall()` applies mutations to the in-memory VFS
4. `FileSystemContext` triggers a `refreshTrigger` counter increment → `PreviewFrame` re-renders the iframe
5. `PreviewFrame` calls `createImportMap()` which Babel-transforms all JSX/TSX files into blob URLs and builds an ES module import map, then writes an `srcdoc` to the iframe

### Virtual File System (`src/lib/file-system.ts`)

`VirtualFileSystem` is an in-memory tree (root `FileNode` with `Map<string, FileNode>` children). The client uses `FileSystemContext` (React context + `useState`) to hold the VFS instance and trigger re-renders. The server reconstructs it from serialized JSON (`deserializeFromNodes`) on every chat request.

### AI tools

Two Vercel AI SDK tools are registered on the server:
- `str_replace_editor` — `create`, `str_replace`, `insert` commands (in `src/lib/tools/str-replace.ts`)
- `file_manager` — `rename`, `delete` commands (in `src/lib/tools/file-manager.ts`)

The AI system prompt (`src/lib/prompts/generation.tsx`) instructs Claude to always create `/App.jsx` as the entry point, use Tailwind for styling, and use `@/` import aliases for local files.

### Preview rendering (`src/lib/transform/jsx-transformer.ts`)

`createImportMap()` transforms all JS/TS/JSX/TSX files with `@babel/standalone`, creates blob URLs, resolves `@/` aliases, and maps third-party packages to `https://esm.sh/<package>`. The resulting import map + Tailwind CDN + an error boundary is injected into `createPreviewHTML()` which becomes the iframe's `srcdoc`. The preview uses React 19 from `esm.sh`.

### Authentication

JWT-based auth via `jose` with httpOnly cookies (`auth-token`, 7-day expiry). `src/lib/auth.ts` is `server-only`. Middleware at `src/middleware.ts` protects `/api/projects` and `/api/filesystem`. The chat endpoint (`/api/chat`) is not protected — anonymous users can generate components, but their work is only persisted to the database if they're authenticated and provide a `projectId`.

### Database

Prisma + SQLite (`prisma/dev.db`). The schema at `prisma/schema.prisma` is the source of truth for all database structure — reference it whenever you need to understand stored data. Two models: `User` (email/password) and `Project` (stores serialized `messages` and `data` as JSON strings). The Prisma client is generated to `src/generated/prisma/`.

### Context providers

`FileSystemProvider` wraps `ChatProvider` in the page layout. `ChatProvider` depends on `useFileSystem()` to serialize the VFS into chat request body and to apply incoming tool calls.

### Project routing

- `/` — anonymous workspace (no persistence)
- `/[projectId]` — authenticated workspace; loads saved messages and file data from DB, persists on every AI response

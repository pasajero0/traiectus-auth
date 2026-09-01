# Repository Structure

Template for documenting this repo's layout so agents can locate code and respect boundaries. Fill
the tables with **this project's** actual structure.

## Layout

| Path     | Purpose          |
| -------- | ---------------- |
| `<path>` | <what lives here> |

## Tooling

- **Package manager**: pnpm only.
- **Build**: `<build command>` → `<output dir>`.
- **Typecheck / static gate**: `<typecheck command>`.
- **Test**: `<test command>`.

## Where new files go

- New <unit> → `<path>` (+ register in `<entry>`).
- New test → mirror the source path under the test dir.

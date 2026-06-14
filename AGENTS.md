# AGENTS

## Project Overview

- Repository: `gerber-toolkit`.
- Source is in `src/`.
- Tests are in `tests/`.
- Specifications are in `spec/`.
- Documentation is in `docs/`.

## Build, Run, Test

- Install: `npm install`
- Test: `npm test`
- Format: `npm run format`

## Coding Style & Naming Conventions

- Prettier settings are in `.prettierrc.json`: 4-space indent, single quotes, no semicolons, no trailing commas.
- Keep files under 1000 lines; split modules/classes when they grow.
- Add JSDoc for every function/method, including private helpers.
- Add inline comments only where non-obvious behavior needs context.
- Utility modules should use class-based organization with static methods when appropriate.
- For single-class modules, name the `.mjs` file in CamelCase to match the class name.
- For private internals, use ECMAScript private elements.
- Prefer `async/await` for naturally asynchronous operations.

## Testing Guidelines

- Use repo scripts only (`npm test`).
- For every feature/fix/behavior change, add or update tests in `tests/`.
- Keep tests focused on observable package behavior.
- Tests must use repo-owned synthetic Gerber and Excellon samples only.
- Do not commit provided production fabrication files or source-derived fixture names.
- Parser and renderer fixes must stay universal; never special-case a specific source file or project identifier.

## Documentation Guidelines

- Keep root `README.md` as the entry point.
- Keep detailed docs in `docs/` and update them with behavior/architecture changes.
- Keep acceptance criteria and scope in `spec/`.

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Not eslint-config-next: this is a React Router 8 SPA (`ssr: false`) served
// by a standalone Hono/Bun process, not Next.js — none of core-web-vitals'
// next/image, next/link, or App Router rules apply here. This config is
// built from ESLint's own TypeScript + React + React Hooks building blocks
// instead.
export default defineConfig([
  // Generated output and codegen — never hand-authored, never linted.
  // Mirrors apps/dash/.gitignore's /build, /dist, /.react-router entries.
  globalIgnores(["build/**", "dist/**", ".react-router/**"]),

  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `const { key, ...rest } = obj` to omit `key` from `rest` is a
      // deliberate, common idiom (see env.test.ts's "DASH_PUBLIC_ORIGIN
      // 未设置时报错" test) — the extracted binding is never meant to be
      // used. Without this, the rule can't distinguish that from an
      // actually-forgotten variable.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },

  // Server + shared code runs on Bun, not in a browser: Node-flavored
  // globals (process, console, ...), no DOM.
  {
    files: ["src/server/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Client code runs in the browser and renders React. React 19's
  // automatic JSX runtime means files never import React themselves, so
  // the "jsx-runtime" preset (which turns off the two rules that assume
  // the classic runtime) is layered on top of "recommended".
  {
    files: ["src/client/**/*.{ts,tsx}"],
    extends: [react.configs.flat.recommended, react.configs.flat["jsx-runtime"]],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: {
      react: { version: "19.2" },
    },
    rules: {
      // TypeScript already enforces prop shapes at compile time. This rule
      // only understands the runtime PropTypes API, has no idea these
      // components are typed via `Route.ComponentProps`, and would flag
      // every destructured prop as "missing in props validation".
      "react/prop-types": "off",
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      // Upstream ships this as "warn" (eslint-plugin-react-hooks'
      // basicRuleConfigs), which would print but not fail `bun run
      // check`/CI. This exact rule is the reason this config exists: see
      // the long comment above the SSE effect in
      // src/client/routes/actions.tsx for the bug it caught (the
      // EventSource being torn down and reopened on every SSE event
      // because `useRevalidator()`'s return value isn't stable). Confirmed
      // by hand (see lint-report.md) that this version does not flag that
      // effect's empty dependency array — it understands `useEffectEvent`
      // — and that it DOES flag `[revalidator]` if that dependency comes
      // back.
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // Test files use bun:test, not an ESLint-aware test runner plugin, and
  // lean on `as any` / non-null assertions to shape mock data — both
  // deliberate here (see the comments at each use site), not something a
  // stricter rule should push back on.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // The config file itself: plain Node ESM, not part of the app's browser
  // or Bun-server runtime split above.
  {
    files: ["eslint.config.mjs"],
    languageOptions: { globals: globals.node },
  },
]);

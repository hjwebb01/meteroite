import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Next's React, import, and accessibility plugins still use pre-v10 rule APIs.
  ...fixupConfigRules([...nextVitals, ...nextTs]),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["src/**/*.tsx"],
    // Page-level shells render once, so fixed ids there cannot collide.
    ignores: ["src/features/reviews/components/reviews-workspace.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='id'] > Literal, JSXAttribute[name.name='id'] > JSXExpressionContainer > Literal",
          message:
            "A fixed id collides when the component renders twice; use useId() or derive it from the entity id.",
        },
      ],
    },
  },
  {
    // Vendored AI Elements render blob and data URLs that next/image cannot load.
    files: ["src/components/ai-elements/**"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);

export default eslintConfig;

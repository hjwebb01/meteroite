import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const DIRECTIVE =
  /^\s*(eslint|@ts-|@vitest|@jsx|istanbul|v8 ignore|prettier-ignore)|^\/\s*<reference/;

const noComments = {
  meta: {
    type: "problem",
    messages: {
      comment:
        "Delete the comment. A decision worth keeping goes in docs/adr; a hack it excuses needs an issue.",
    },
    schema: [],
  },
  create: (context) => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        if (!DIRECTIVE.test(comment.value))
          context.report({ loc: comment.loc, messageId: "comment" });
      }
    },
  }),
};

const eslintConfig = defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTs]),
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
    "motion/**",
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
    files: ["**/*.{js,mjs,ts,mts,tsx}"],
    plugins: { local: { rules: { "no-comments": noComments } } },
    rules: { "local/no-comments": "error" },
  },
  {
    files: ["src/**/*.tsx"],
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
    files: ["src/components/ai-elements/**"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);

export default eslintConfig;

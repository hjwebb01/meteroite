// @vitest-environment node
import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  executionCapability,
  openIsolatedRepository,
  cleanupExpiredCheckouts,
} from "./execution-provider";
const exec = promisify(execFile);
test("real Node repository runs tests at the pinned SHA without host secrets or network, then cancels", async ({
  skip,
}) => {
  const capability = await executionCapability();
  if (!capability.available) {
    skip();
    return;
  }
  const fixture = await mkdtemp(join(tmpdir(), "meteroite-node-fixture-"));
  try {
    await writeFile(
      join(fixture, "package.json"),
      JSON.stringify({
        name: "node-review-fixture",
        scripts: {
          test: "node --test",
          "check:dependencies": "node dependency-check.cjs",
        },
        devDependencies: { "is-number": "7.0.0" },
      }),
    );
    await writeFile(
      join(fixture, "dependency-check.cjs"),
      "const assert=require('node:assert/strict');assert.equal(require('is-number')(42),true);\n",
    );
    await writeFile(
      join(fixture, "sum.cjs"),
      "module.exports = (a, b) => a + b;\n",
    );
    await writeFile(
      join(fixture, "sum.test.cjs"),
      "const test=require('node:test'); const assert=require('node:assert/strict'); test('sum preserves values',()=>assert.equal(require('./sum.cjs')(2,3),5));\n",
    );
    await mkdir(join(fixture, "sources"));
    await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        writeFile(
          join(fixture, "sources", `file-${i}.js`),
          `module.exports=${i};\n` +
            "// ordinary repository source\n".repeat(60),
        ),
      ),
    );
    await exec("git", ["init", fixture]);
    await exec("git", ["-C", fixture, "add", "."]);
    await exec("git", [
      "-C",
      fixture,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "fixture",
    ]);
    const { stdout } = await exec("git", ["-C", fixture, "rev-parse", "HEAD"]);
    const sourceSha = stdout.trim();
    const runtime = await openIsolatedRepository({
      sourceSha,
      repositoryUrl: fixture,
      githubToken: "secret-that-must-not-enter-runtime",
      deadline: Date.now() + 20_000,
      signal: AbortSignal.timeout(20_000),
    });
    try {
      const identity = await runtime.run(
        ["git", "rev-parse", "HEAD"],
        AbortSignal.timeout(3000),
      );
      expect(identity.output.trim()).toBe(sourceSha);
      const result = await runtime.run(
        ["npm", "test"],
        AbortSignal.timeout(5000),
      );
      expect(result.status).toBe("passed");
      expect(result.output).toContain("sum preserves values");
      const verificationStarted = Date.now();
      await runtime.verifyFiles([], AbortSignal.timeout(3000));
      const verificationMs = Date.now() - verificationStarted;
      process.stderr.write(
        `1000-file immutable source comparison: ${verificationMs}ms\n`,
      );
      expect(verificationMs).toBeLessThan(3000);
      const missing = await runtime.run(
        ["npm", "run", "check:dependencies"],
        AbortSignal.timeout(3000),
      );
      expect(missing.status).toBe("unavailable");
      expect(missing.output).toContain("Dependency is-number is not installed");
      expect(missing.output).toContain("MODULE_NOT_FOUND");
      const uncached = await runtime.run(
        ["npm", "install", "--offline", "--ignore-scripts"],
        AbortSignal.timeout(5000),
      );
      expect(uncached.status).toBe("unavailable");
      expect(uncached.output).toContain("ENOTCACHED");
      const brokenLocal = await runtime.run(
        ["node", "-e", "require('./nonexistent-local-module')"],
        AbortSignal.timeout(3000),
      );
      expect(brokenLocal.status).toBe("failed");
      await runtime.replaceFiles(
        [
          {
            path: "sum.cjs",
            replacement: "module.exports = (a, b) => a - b;\n",
          },
        ],
        AbortSignal.timeout(3000),
      );
      const proposed = await runtime.run(
        ["npm", "test"],
        AbortSignal.timeout(5000),
      );
      expect(proposed.status).toBe("failed");
      expect(proposed.output).toContain("ERR_ASSERTION");
      await runtime.verifyFiles(
        [
          {
            path: "sum.cjs",
            replacement: "module.exports = (a, b) => a - b;\n",
          },
        ],
        AbortSignal.timeout(3000),
      );
      await runtime.run(
        [
          "node",
          "-e",
          "require('fs').writeFileSync('sum.test.cjs','// bypass test')",
        ],
        AbortSignal.timeout(3000),
      );
      await expect(
        runtime.verifyFiles(
          [
            {
              path: "sum.cjs",
              replacement: "module.exports = (a, b) => a - b;\n",
            },
          ],
          AbortSignal.timeout(3000),
        ),
      ).rejects.toThrow("changed the proposed or pinned source");
      await expect(
        runtime.replaceFiles(
          [{ path: "../escape", replacement: "bad" }],
          AbortSignal.timeout(3000),
        ),
      ).rejects.toThrow("Unsupported proposal file");
      const isolation = await runtime.run(
        [
          "node",
          "-e",
          "const fs=require('fs'); console.log(JSON.stringify({home:fs.existsSync('/home/hunter'),token:process.env.OPENROUTER_API_KEY,github:process.env.GIT_CONFIG_VALUE_0})); require('net').connect(443,'1.1.1.1').on('error',e=>console.log(e.code));",
        ],
        AbortSignal.timeout(3000),
      );
      expect(isolation.output).toContain('{"home":false}');
      expect(isolation.output).toContain("ENETUNREACH");
      const processCount = async () =>
        Number(
          (
            await exec("systemctl", [
              "--user",
              "show",
              runtime.executionUnit,
              "--property=TasksCurrent",
              "--value",
            ])
          ).stdout.trim(),
        );
      const before = await processCount();
      const lifecycle = await runtime.run(
        [
          "node",
          "-e",
          "const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});p.unref();console.log('ordinary child started');",
        ],
        AbortSignal.timeout(3000),
      );
      expect(lifecycle.status).toBe("passed");
      expect(lifecycle.output).toContain("ordinary child started");
      const after = await processCount();
      expect(after).toBe(before);
      process.stderr.write(
        `Ordinary detached Node child fully reaped: TasksCurrent ${before} -> ${after}\n`,
      );
      const namespace = await runtime.run(
        [
          "node",
          "-e",
          "const fs=require('fs');console.log(JSON.stringify({controller:fs.existsSync('/controller.mjs'),input:fs.existsSync('/input'),pidNamespace:fs.readlinkSync('/proc/self/ns/pid')}));",
        ],
        AbortSignal.timeout(3000),
      );
      const laterNamespace = await runtime.run(
        [
          "node",
          "-e",
          "console.log(require('fs').readlinkSync('/proc/self/ns/pid'))",
        ],
        AbortSignal.timeout(3000),
      );
      const isolated = JSON.parse(namespace.output);
      expect(isolated.controller).toBe(false);
      expect(isolated.input).toBe(false);
      expect(laterNamespace.output.trim()).not.toBe(isolated.pidNamespace);
      const tasks = await runtime.run(
        [
          "node",
          "-e",
          "const {spawn}=require('child_process'); let failures=0, children=[]; for(let i=0;i<80;i++){const p=spawn('node',['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});children.push(p);p.on('error',e=>{if(e.code==='EAGAIN') failures++});}setTimeout(()=>{console.log('aggregate-task-limit:'+failures);for(const p of children)p.kill();},500);",
        ],
        AbortSignal.timeout(5000),
      );
      expect(tasks.output).toMatch(/aggregate-task-limit:[1-9]/);
      await expect(
        runtime.run(
          ["node", "-e", "setTimeout(()=>{},30000)"],
          AbortSignal.timeout(150),
        ),
      ).rejects.toThrow("cancelled");
    } finally {
      await runtime.stop();
    }
    const expiring = await openIsolatedRepository({
      sourceSha,
      repositoryUrl: fixture,
      githubToken: "secret",
      deadline: Date.now() + 2500,
      signal: AbortSignal.timeout(10_000),
    });
    try {
      await expect(
        expiring.run(
          ["node", "-e", "setTimeout(()=>{},30000)"],
          AbortSignal.timeout(10_000),
        ),
      ).rejects.toThrow("stopped or exceeded its limits");
      await cleanupExpiredCheckouts();
      await expect(stat(expiring.directory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await expiring.stop();
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 30_000);

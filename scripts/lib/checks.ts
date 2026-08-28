/**
 * Tiny assertion harness shared by `verify-logic.ts` and `verify-core.ts`.
 * Deliberately not a test framework: the verify scripts run in production-like
 * environments (a Hostinger shell after a deploy) where `npm i -D vitest` is
 * not something we want to depend on.
 */
export class CheckRunner {
  private checks = 0;
  private failures = 0;

  section(title: string): void {
    console.log(`\n${title}`);
  }

  check(name: string, condition: boolean, detail = ""): boolean {
    this.checks += 1;
    if (condition) {
      console.log(`  PASS  ${name}`);
      return true;
    }
    this.failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    return false;
  }

  equal(name: string, actual: unknown, expected: unknown): boolean {
    return this.check(
      name,
      Object.is(actual, expected),
      `esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`,
    );
  }

  /** Assert that a synchronous `fn` throws, optionally with a specific `code`. */
  throws(name: string, fn: () => unknown, code?: string): boolean {
    try {
      fn();
      return this.check(name, false, "se esperaba un error y no hubo ninguno");
    } catch (error) {
      return this.matchThrown(name, error, code);
    }
  }

  /** Same, for a promise-returning `fn`. */
  async throwsAsync(name: string, fn: () => Promise<unknown>, code?: string): Promise<boolean> {
    try {
      await fn();
      return this.check(name, false, "se esperaba un error y no hubo ninguno");
    } catch (error) {
      return this.matchThrown(name, error, code);
    }
  }

  private matchThrown(name: string, error: unknown, code?: string): boolean {
    const actualCode = (error as { code?: string }).code;
    if (!code) return this.check(name, true);
    return this.check(
      name,
      actualCode === code,
      `código esperado "${code}", obtenido "${actualCode ?? String(error)}"`,
    );
  }

  summary(label: string): number {
    const passed = this.checks - this.failures;
    console.log(
      `\n${passed}/${this.checks} ${label}${this.failures ? ` — ${this.failures} FAILED` : ""}\n`,
    );
    return this.failures;
  }

  get failed(): number {
    return this.failures;
  }

  get total(): number {
    return this.checks;
  }
}

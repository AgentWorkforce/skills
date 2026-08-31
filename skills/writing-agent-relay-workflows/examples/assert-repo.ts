/**
 * Validate `owner/repo` and branch values before they are interpolated into a
 * shell command.
 *
 * `SHIP_ISSUE_REPO` and `SHIP_ISSUE_BRANCH` reach `gh` and `git` inside a
 * deterministic step's `command` string, so unvalidated values would be a
 * command-injection hole in an example people copy. Both character sets below
 * exclude shell metacharacters entirely.
 */
const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertRepo(value: string): string {
  if (!REPO_SLUG.test(value)) {
    throw new Error(
      `Invalid repository "${value}". Expected owner/repo using [A-Za-z0-9._-].`,
    );
  }
  return value;
}

export function assertBranch(value: string): string {
  if (!BRANCH_NAME.test(value) || value.includes('..')) {
    throw new Error(
      `Invalid branch "${value}". Expected [A-Za-z0-9._/-] with no "..".`,
    );
  }
  return value;
}

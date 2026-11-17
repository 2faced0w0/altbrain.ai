import { execFileSync } from "node:child_process";
export default async function teardown() {
  execFileSync("python", ["scripts/cleanup_auth_fixture.py"], {
    stdio: "inherit",
  });
}

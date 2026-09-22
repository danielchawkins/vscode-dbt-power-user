import * as assert from "assert";
import * as fs from "fs";
import { fixturePath } from "./helpers/testFixtures";
import { createLspFixture } from "./lspFixture";

suite("lspFixture", function () {
  test("removes temp copy when prepareProject throws", async function () {
    let projectRoot = "";
    await assert.rejects(async () => {
      await createLspFixture(fixturePath("single-project"), undefined, {
        prepareProject(root) {
          projectRoot = root;
          throw new Error("prepareProject failed");
        },
      });
    }, /prepareProject failed/);
    assert.ok(projectRoot.length > 0);
    assert.ok(!fs.existsSync(projectRoot));
  });

  test("removes temp copy on close", async function () {
    const fixture = await createLspFixture(fixturePath("single-project"));
    const projectRoot = fixture.projectRoot;
    assert.ok(fs.existsSync(projectRoot));
    await fixture.close();
    assert.ok(!fs.existsSync(projectRoot));
  });
});

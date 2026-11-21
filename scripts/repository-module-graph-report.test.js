import assert from "node:assert/strict"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import { createRepositoryModuleGraphReport } from "./repository-module-graph-report.js"

const writeRepositoryFile = ({ repositoryRoot, file, source }) => {
  const absolutePath = join(repositoryRoot, ...file.split("/"))
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, source)
}

test("reports repository source graph size and legacy cycles without failing the baseline", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "coinzilla-module-graph-report-"))

  try {
    const files = [
      {
        file: "apps/harvester/src/domain/one.js",
        source: 'import "./two.js"\n',
      },
      {
        file: "apps/harvester/src/domain/two.js",
        source: 'import "./one.js"\n',
      },
      {
        file: "packages/utils/src/index.js",
        source: "export const shared = true\n",
      },
      {
        file: "scripts/check-module-graph.js",
        source: 'import "../packages/utils/src/index.js"\n',
      },
      {
        file: "apps/harvester/src/domain/one.test.js",
        source: "throw new Error('test file must not be scanned')\n",
      },
    ]

    for (const file of files) {
      writeRepositoryFile({
        repositoryRoot,
        ...file,
      })
    }

    assert.deepEqual(
      createRepositoryModuleGraphReport({ repositoryRoot }),
      {
        mode: "report-only",
        moduleCount: 4,
        relativeEdgeCount: 3,
        cycles: [
          [
            "apps/harvester/src/domain/one.js",
            "apps/harvester/src/domain/two.js",
          ],
        ],
      },
      "The baseline must include Harvester, packages and scripts, exclude tests, and report cycles without enforcing them.",
    )
  } finally {
    rmSync(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})

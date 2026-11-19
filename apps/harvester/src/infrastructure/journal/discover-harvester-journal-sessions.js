import { readdir } from "node:fs/promises"
import path from "node:path"
import { createHistoryError } from "./helpers/journal-history-errors.js"

async function readSessionDirectoryEntries({ directory }) {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch (cause) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unable to enumerate Journal session directory: ${directory}`,
      details: { directory },
      cause,
    })
  }
}

function validateSessionDirectoryEntries({ directory, entries }) {
  const symbolicLinks = entries.filter((entry) => entry.isSymbolicLink())
  if (symbolicLinks.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Symbolic links make Journal session discovery incomplete: ${directory}`,
      details: { directory,
entries: symbolicLinks.map((entry) => entry.name) },
    })
  }

  const journalEntries = entries.filter((entry) => entry.name.endsWith(".jsonl"))
  const invalidJournalEntries = journalEntries.filter((entry) => !entry.isFile())
  if (invalidJournalEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `A Journal session entry is not a regular file: ${directory}`,
      details: { directory,
entries: invalidJournalEntries.map((entry) => entry.name) },
    })
  }

  const childDirectories = entries.filter((entry) => entry.isDirectory())
  const unknownEntries = entries.filter((entry) => !entry.isDirectory() && !entry.isFile())
  if (unknownEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unsupported filesystem entry in Journal session tree: ${directory}`,
      details: { directory,
entries: unknownEntries.map((entry) => entry.name) },
    })
  }

  return { journalEntries,
childDirectories }
}

function recordDiscoveredSessionDirectory({
  directory,
  entries,
  journalEntries,
  childDirectories,
  isRoot,
  maxSessions,
  state,
}) {
  if (journalEntries.length > 0) {
    state.sessionsDiscovered += journalEntries.length
    if (state.sessionsDiscovered > maxSessions) {
      throw createHistoryError({
        code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
        message: "Harvester Journal history exceeds maxSessions during discovery",
        details: { maxSessions,
sessionsDiscovered: state.sessionsDiscovered,
directory },
      })
    }
    state.discovered.push({
      directory,
      fileNames: journalEntries.map((entry) => entry.name).sort(),
    })
    return
  }

  if (!isRoot && childDirectories.length === 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_SESSION_MISSING",
      message: `Discovered process-session directory has no Journal JSONL file: ${directory}`,
      details: { directory },
    })
  }
  if (!isRoot && entries.some((entry) => entry.isFile())) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Journal session container has files but no session record file: ${directory}`,
      details: { directory,
entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
    })
  }
  if (isRoot && entries.some((entry) => entry.isFile() && !entry.name.endsWith(".jsonl"))) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `Unexpected file in Journal sessions root: ${directory}`,
      details: { directory,
entries: entries.filter((entry) => entry.isFile()).map((entry) => entry.name) },
    })
  }
}

function sortDirectoriesByName({ directories }) {
  const sortedDirectories = []
  for (const directory of directories) {
    let insertionIndex = sortedDirectories.length
    while (
      insertionIndex > 0 &&
      sortedDirectories[insertionIndex - 1].name.localeCompare(directory.name) > 0
    ) {
      insertionIndex -= 1
    }
    sortedDirectories.splice(insertionIndex, 0, directory)
  }
  return sortedDirectories
}

async function walkSessionDirectories({
  directory,
  isRoot = false,
  state,
  maxDirectories,
  maxSessions,
}) {
  state.directoriesVisited += 1
  if (state.directoriesVisited > maxDirectories) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_LIMIT_EXCEEDED",
      message: "Harvester Journal session discovery exceeds maxDirectories",
      details: { maxDirectories,
directory },
    })
  }

  const entries = await readSessionDirectoryEntries({ directory })
  const { journalEntries, childDirectories } = validateSessionDirectoryEntries({ directory,
entries })
  recordDiscoveredSessionDirectory({
    directory,
    entries,
    journalEntries,
    childDirectories,
    isRoot,
    maxSessions,
    state,
  })

  for (const child of sortDirectoriesByName({ directories: childDirectories })) {
    await walkSessionDirectories({
      directory: path.join(directory, child.name),
      state,
      maxDirectories,
      maxSessions,
    })
  }
}

async function discoverSessionDirectories({ sessionsRoot, maxDirectories, maxSessions }) {
  const state = {
    discovered: [],
    directoriesVisited: 0,
    sessionsDiscovered: 0,
  }
  await walkSessionDirectories({
    directory: sessionsRoot,
    isRoot: true,
    state,
    maxDirectories,
    maxSessions,
  })
  return {
    directories: state.discovered,
    directoriesVisited: state.directoriesVisited,
  }
}

function validateRootJournalEntries({
    rootDirectory,
    rootJournalEntries,
  }) {
  const invalidRootJournalEntries = rootJournalEntries.filter((entry) => !entry.isFile())
  if (invalidRootJournalEntries.length > 0) {
    throw createHistoryError({
      code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
      message: `A root-level Journal session entry is not a regular file: ${rootDirectory}`,
      details: {
        directory: rootDirectory,
        entries: invalidRootJournalEntries.map((entry) => entry.name),
      },
    })
  }
}

async function discoverRootSessionDirectories({
  rootDirectory,
  rootEntries,
  maxDirectories,
  maxSessions,
}) {
  const sessionDirectories = []
  let directoriesVisited = 0
  if (path.basename(rootDirectory) === "sessions") {
    const discovered = await discoverSessionDirectories({
      sessionsRoot: rootDirectory,
      maxDirectories,
      maxSessions,
    })
    return {
      sessionDirectories: discovered.directories,
      directoriesVisited: discovered.directoriesVisited,
    }
  }

  const rootJournalEntries = rootEntries.filter((entry) => entry.name.endsWith(".jsonl"))
  validateRootJournalEntries({
    rootDirectory,
    rootJournalEntries,
  })
  if (rootJournalEntries.length > 0) {
    sessionDirectories.push({
      directory: rootDirectory,
      fileNames: rootJournalEntries.map((entry) => entry.name).sort(),
    })
  }

  const sessionsEntry = rootEntries.find((entry) => entry.name === "sessions")
  if (sessionsEntry) {
    const sessionsDirectory = path.join(rootDirectory, "sessions")
    if (!sessionsEntry.isDirectory()) {
      throw createHistoryError({
        code: "HARVESTER_JOURNAL_DISCOVERY_INCOMPLETE",
        message: `Harvester sessions path is not a readable directory: ${sessionsDirectory}`,
        details: { directory: sessionsDirectory },
      })
    }
    const {
      directories,
      directoriesVisited: discoveredDirectoriesVisited,
    } = await discoverSessionDirectories({
      sessionsRoot: sessionsDirectory,
      maxDirectories,
      maxSessions,
    })
    sessionDirectories.push(...directories)
    directoriesVisited = discoveredDirectoriesVisited
  }
  return { sessionDirectories,
directoriesVisited }
}

function assertDiscoveredSessionCount({ sessionDirectories, maxSessions }) {
  let discoveredSessions = 0
  for (const entry of sessionDirectories) {
    discoveredSessions += entry.fileNames.length
  }
  if (discoveredSessions > maxSessions) {
    throw createHistoryError({
      code: "JOURNAL_RECOVERY_LIMIT_EXCEEDED",
      message: "Harvester Journal history exceeds maxSessions",
      details: { maxSessions,
discoveredSessions },
    })
  }
}

/**
 * Discover bounded flat and nested Journal session directories below a history root.
 *
 * @param {object} options
 * @param {string} options.rootDirectory
 * @param {number} options.maxDirectories
 * @param {number} options.maxSessions
 * @returns {Promise<{sessionDirectories: Array<object>, directoriesVisited: number}>}
 */
export async function discoverHarvesterJournalSessions({
  rootDirectory,
  maxDirectories,
  maxSessions,
}) {
  const rootEntries = await readdir(rootDirectory, { withFileTypes: true })
  const discovery = await discoverRootSessionDirectories({
    rootDirectory,
    rootEntries,
    maxDirectories,
    maxSessions,
  })
  assertDiscoveredSessionCount({
    sessionDirectories: discovery.sessionDirectories,
    maxSessions,
  })
  return discovery
}

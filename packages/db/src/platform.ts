import { MemoryRepository } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import type { PlatformRepository } from "./platform-types.js";
import { getMemoryPlatformRepository } from "./platform-memory.js";
import { PostgresPlatformRepository } from "./platform-postgres.js";

export function createPlatformRepository(repository: Repository): PlatformRepository {
  if (repository instanceof MemoryRepository) return getMemoryPlatformRepository(repository);
  if (repository instanceof PostgresRepository) return new PostgresPlatformRepository(repository);
  throw new Error("Business platform requires the canonical PostgreSQL or memory repository");
}
export {
  MemoryPlatformRepository,
  reserveRoomCoverageInMemory,
  consumeRoomCoverageInMemory,
  releaseRoomCoverageInMemory,
  assertAudienceAdmissionInMemory,
} from "./platform-memory.js";
export {
  PostgresPlatformRepository,
  reserveRoomCoverageForTransaction,
  consumeRoomCoverageForTransaction,
  releaseRoomCoverageForTransaction,
  assertAudienceAdmissionForTransaction,
} from "./platform-postgres.js";

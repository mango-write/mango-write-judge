// .env 固定从仓库根读取（apps/api 为 CWD 运行时也能命中）。
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnv({ path: rootEnv });

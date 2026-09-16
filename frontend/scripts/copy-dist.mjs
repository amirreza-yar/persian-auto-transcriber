import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const targetRoot = process.argv[2]
if (!targetRoot) {
  console.error("Usage: npm run deploy:backend -- /path/to/persian-stt-backend")
  process.exit(1)
}

const source = path.resolve("dist")
const target = path.resolve(targetRoot, "frontend", "dist")

await rm(target, { recursive: true, force: true })
await mkdir(path.dirname(target), { recursive: true })
await cp(source, target, { recursive: true })
console.log(`Copied ${source} -> ${target}`)

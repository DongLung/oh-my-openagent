// Runs a fixture script as its own Bun process and waits on the signals it prints: READY once its imports have
// loaded, DONE once its work has finished, then its exit. The deadline is only a hang ceiling; on expiry this kills
// exactly the child it spawned (by its own pid) and reports the phase it reached plus its stdout and stderr (#9890).
export type ChildPhase = "spawned" | "ready" | "done" | "exited"

export type SignalledChildResult = {
  readonly pid: number
  readonly phase: ChildPhase
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export const SUBPROCESS_DEADLINE_MS = process.platform === "win32" ? 60_000 : 20_000

export async function runSignalledChild(
  args: readonly string[],
  deadlineMs: number = SUBPROCESS_DEADLINE_MS,
): Promise<SignalledChildResult> {
  const child = Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const state: { phase: ChildPhase } = { phase: "spawned" }
  let stdout = ""
  const stderrText = new Response(child.stderr).text()
  const stdoutRead = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of child.stdout) {
      stdout += decoder.decode(chunk, { stream: true })
      const lines = stdout.split("\n")
      if (state.phase === "spawned" && lines.includes("READY")) state.phase = "ready"
      if (state.phase === "ready" && lines.includes("DONE")) state.phase = "done"
    }
    stdout += decoder.decode()
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), deadlineMs)
  })
  const outcome = await Promise.race([child.exited.then(() => "exited" as const), deadline])
  clearTimeout(timer)
  if (outcome === "deadline") child.kill("SIGKILL")
  const exitCode = await child.exited
  await stdoutRead
  const reachedPhase = outcome === "exited" && state.phase === "done" ? "exited" : state.phase
  return { pid: child.pid, phase: reachedPhase, exitCode, stdout, stderr: await stderrText, timedOut: outcome === "deadline" }
}

export function describeChild(result: SignalledChildResult): string {
  const how = result.timedOut ? "hit the hang deadline and was killed" : `exited with ${String(result.exitCode)}`
  return `child ${how} at phase "${result.phase}"\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
}

const proc = Bun.spawn(
  ['bun', 'dist/cli.js', '-p', '--model', 'sonnet', "Say exactly: BUILD_WORKS"],
  {
    cwd: import.meta.dir,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TERM: 'dumb' },
  }
)
proc.stdin.end()
const timeout = setTimeout(() => { console.error('TIMEOUT'); proc.kill() }, 30_000)
const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
])
clearTimeout(timeout)
const exitCode = await proc.exited
console.log('EXIT:', exitCode)
console.log('STDOUT:', stdout.slice(0, 500) || '(empty)')
if (stderr.trim()) console.log('STDERR:', stderr.slice(0, 500))

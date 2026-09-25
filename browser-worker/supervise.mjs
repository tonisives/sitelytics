import { spawn } from 'node:child_process'

let children = new Set(), stopping = false
let stop = code => {
 if (stopping) return
 stopping = true
 for (let child of children) child.kill('SIGTERM')
 let timer = setTimeout(() => { for (let child of children) child.kill('SIGKILL') }, 10000)
 Promise.all([...children].map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode) resolve(); else child.once('exit', resolve) }))).then(() => { clearTimeout(timer); process.exit(code) })
}
let run = (command, args) => {
 let child = spawn(command, args, { stdio: 'inherit' })
 children.add(child)
 child.once('error', () => { children.delete(child); stop(1) })
 child.once('exit', code => { children.delete(child); stop(code || 1) })
 return child
}
for (let signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop(0))
run('xvfb-run', ['-a', '-s', '-screen 0 1280x900x24 -nolisten tcp', 'bmux', 'host'])
let ready = false
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
 ready = await new Promise(resolve => {
  let check = spawn(process.execPath, ['/opt/bmux/resources/scripts/host-health.mjs'], { stdio: 'ignore' })
  check.once('error', () => resolve(false)); check.once('exit', code => resolve(code === 0))
 })
 if (ready) break
 await new Promise(resolve => setTimeout(resolve, 1000))
}
if (!stopping) { if (ready) run(process.execPath, ['worker.mjs']); else stop(1) }

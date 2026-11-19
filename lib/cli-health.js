/**
 * Is the claude CLI actually runnable?
 *
 * Written after a failure that stayed invisible for an hour. An upgrade ran
 * `npm install`, could not reach the registry for the platform-native optional
 * dependency, and its postinstall wrote a ~500-byte shell stub over
 * `bin/claude.exe`. The package version still read 2.1.328, so every version
 * check reported "up to date" — while every spawn failed with the opaque
 * `spawn UNKNOWN`, and the panel showed the user's message and then nothing.
 *
 * Version numbers cannot answer "does this run"; these two functions can.
 */
import fsp from 'node:fs/promises'

/** The placeholder's own wording. Matching it is more reliable than a size cap. */
export const CLI_STUB_MARKER = /native binary not installed|postinstall did not run|platform-native optional dependency/i

/** The real native binary is ~360 MB; npm's placeholder is a few hundred bytes. */
const STUB_MAX_BYTES = 1024 * 1024

/**
 * @param {string} cli absolute path to the claude executable
 * @returns {Promise<{ok: boolean, reason: string, message: string, size?: number}>}
 */
export async function cliHealth(cli) {
  if (!cli) {
    return { ok: false, reason: 'cli-missing', message: '未找到 claude CLI，请先在「高级 → claude CLI 路径」里指定可执行文件' }
  }
  let st
  try {
    st = await fsp.stat(cli)
  } catch (e) {
    return { ok: false, reason: 'cli-missing', message: `claude CLI 不存在：${cli}` }
  }
  // A real native binary is far above the cap. A .cmd/.js shim is small but
  // still legitimate, so only small files get read — and only to look for the
  // placeholder's own wording, never to guess from size alone.
  if (st.size < STUB_MAX_BYTES) {
    let head = ''
    try {
      const fh = await fsp.open(cli, 'r')
      try {
        const buf = Buffer.alloc(Math.min(st.size, 4096))
        await fh.read(buf, 0, buf.length, 0)
        head = buf.toString('utf-8')
      } finally {
        await fh.close()
      }
    } catch (e) {
      // Unreadable is not proof of a stub; let the spawn attempt report it.
    }
    if (CLI_STUB_MARKER.test(head)) {
      return {
        ok: false,
        reason: 'cli-stub',
        message: 'CLI 原生二进制缺失：当前 claude.exe 只是安装占位符（升级时平台包没下载成功）。请在「设置 → 高级 → 更新」里重新安装 CLI，或手动执行 npm install @anthropic-ai/claude-code-win32-x64。',
      }
    }
  }
  return { ok: true, reason: '', message: '', size: st.size }
}

/**
 * Turn an opaque spawn failure into something the reader can act on.
 * `spawn UNKNOWN` is what Windows reports when the target is not a real
 * executable — it names no cause and is not searchable.
 */
export function explainSpawnError(err, cli) {
  const code = String((err && (err.code || err.message)) || '')
  if (/ENOENT/i.test(code)) return `CLI 不存在：${cli}。请检查「高级 → claude CLI 路径」。`
  if (/EACCES|EPERM/i.test(code)) return `CLI 没有执行权限或被占用：${cli}。请检查杀毒软件拦截，或换一个安装目录。`
  if (/UNKNOWN/i.test(code)) {
    return `CLI 无法启动（spawn UNKNOWN）：${cli} 不是可执行文件。最常见的原因是升级时平台原生包没下载成功、只剩占位符 —— 请在「设置 → 高级 → 更新」里重新安装 CLI。`
  }
  return `CLI 启动失败：${code || '未知错误'}（${cli}）`
}

import { execFile } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

/*
 * 定时任务统管(2026-10-19 用户要求):本机的 launchd 定时任务收敛到 ~/claude/somejob/ ——
 *   plists/<label>.plist   任务实体(~/Library/LaunchAgents 下是符号链接,开机照常加载)
 *   jobs.json              任务清单 [{label,title,desc}](页面展示名/说明;label 白名单,不在清单里的拒操作)
 *   common.env / apply-schedule.sh / gen_dashboard.py / dashboard.html / 任务配置.md  调度层配置
 * 服务端只动 StartCalendarInterval 的 Hour/Minute 与 launchctl 启停(PlistBuddy/execFile 数组参数,无 shell 注入);
 * 任务脚本本体留在各自项目目录(run-*.sh 里相对路径、.venv、报告输出都跟着项目走,搬了反而出错)。
 * ⚠️ common.env 内含飞书 webhook/密钥,本服务永不读取其内容、接口永不回传(页面只回清单+时间+状态)。
 * bootout 停用只在本次登录会话有效——开机 LaunchAgents 符号链接会把它重新加载回来(页面注记)。
 */

const exec = promisify(execFile);
export const JOB_DIR = process.env.SOMEJOB_DIR || join(homedir(), 'claude', 'somejob');
const LAD = join(homedir(), 'Library', 'LaunchAgents');
const PB = '/usr/libexec/PlistBuddy';
const uid = (): number => process.getuid?.() ?? 501;

export interface JobDef { label: string; title: string; desc: string }
export interface JobRow extends JobDef {
  at: string | null; // 'HH:MM'(plist 当前值,解析失败 null)
  loaded: boolean; // launchctl 已注册(会按计划跑)
  lastRun: number | null; // StandardOutPath 日志文件 mtime(ms),没落盘过 null
  err?: string; // 该任务读取失败原因(如实显示,不拖累别的行)
}

// 'HH:MM' 严格两位时/分 → {h,m};越界/格式不合 null(纯函数,单测直跑)
export function parseAt(s: string): { h: number; m: number } | null {
  const mt = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || ''));
  return mt ? { h: +mt[1], m: +mt[2] } : null;
}
export function fmtAt(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// 白名单:jobs.json 里的 label 才允许任何操作
export function readManifest(): JobDef[] | null {
  const f = join(JOB_DIR, 'jobs.json');
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(j) ? j.filter((x: any) => /^com\.tianhui\.[\w-]+$/.test(String(x?.label))) : null;
  } catch {
    return null;
  }
}

async function pb(file: string, cmd: string): Promise<string> {
  const { stdout } = await exec(PB, ['-c', cmd, file], { timeout: 5000 });
  return stdout.trim();
}
async function loaded(label: string): Promise<boolean> {
  try {
    await exec('launchctl', ['list', label], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function jobsStatus(): Promise<{ ok: boolean; message?: string; jobs?: JobRow[] }> {
  const defs = readManifest();
  if (!defs) return { ok: false, message: `未找到任务清单 ${JOB_DIR}/jobs.json` };
  const jobs: JobRow[] = [];
  for (const d of defs) {
    const row: JobRow = { ...d, at: null, loaded: false, lastRun: null };
    try {
      const pl = join(JOB_DIR, 'plists', `${d.label}.plist`);
      if (!existsSync(pl)) throw new Error('plist 不在 somejob/plists');
      const [h, m] = [
        await pb(pl, 'Print :StartCalendarInterval:Hour'),
        await pb(pl, 'Print :StartCalendarInterval:Minute'),
      ];
      if (/^\d+$/.test(h) && /^\d+$/.test(m)) row.at = fmtAt(+h, +m);
      try {
        row.lastRun = statSync(await pb(pl, 'Print :StandardOutPath')).mtimeMs;
      } catch { /* 日志还没生成过 */ }
      row.loaded = await loaded(d.label);
    } catch (e: any) {
      row.err = String(e?.message || e).slice(0, 120);
    }
    jobs.push(row);
  }
  return { ok: true, jobs };
}

// 改时间:PlistBuddy 写实体 plist → bootout+bootstrap 重载(计划时刻 launchd 只在加载时读,改文件必须重载)
export async function saveJobAt(label: string, at: string): Promise<{ ok: boolean; message: string }> {
  if (!readManifest()?.some(d => d.label === label)) return { ok: false, message: '任务不在清单里' };
  const t = parseAt(at);
  if (!t) return { ok: false, message: `时间格式应为 HH:MM,收到「${at}」` };
  const pl = join(JOB_DIR, 'plists', `${label}.plist`);
  try {
    await pb(pl, `Set :StartCalendarInterval:Hour ${t.h}`);
    await pb(pl, `Set :StartCalendarInterval:Minute ${t.m}`);
    await reload(label);
    return { ok: true, message: `已改为 ${fmtAt(t.h, t.m)} 并重载` };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  }
}

// 立即跑一次(kickstart,不影响后续计划)
export async function runJobNow(label: string): Promise<{ ok: boolean; message: string }> {
  if (!readManifest()?.some(d => d.label === label)) return { ok: false, message: '任务不在清单里' };
  try {
    await exec('launchctl', ['kickstart', `gui/${uid()}/${label}`], { timeout: 10000 });
    return { ok: true, message: '已触发运行(结果看任务自己的飞书推送/日志)' };
  } catch (e: any) {
    return { ok: false, message: `触发失败(未加载的任务先点「启用」):${String(e?.message || e).slice(0, 120)}` };
  }
}

// 启用/停用:bootout 摘掉 / bootstrap 挂回。⚠️ 停用只到下次开机(符号链接在 LaunchAgents,开机会再加载)
export async function toggleJob(label: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  if (!readManifest()?.some(d => d.label === label)) return { ok: false, message: '任务不在清单里' };
  try {
    if (on) await reload(label);
    else await exec('launchctl', ['bootout', `gui/${uid()}/${label}`], { timeout: 5000 });
    return { ok: true, message: on ? '已启用(按计划时间跑)' : '本次登录会话内已停用(重启计算机会自动加载回来)' };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  }
}

// bootout 旧注册(没加载过就忽略报错)→ 从 LaunchAgents 符号链接 bootstrap 回来(launchd 跟到 somejob 实体)
async function reload(label: string): Promise<void> {
  try {
    await exec('launchctl', ['bootout', `gui/${uid()}/${label}`], { timeout: 5000 });
  } catch { /* 本来就没加载 */ }
  await exec('launchctl', ['bootstrap', `gui/${uid()}`, join(LAD, `${label}.plist`)], { timeout: 5000 });
}

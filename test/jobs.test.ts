import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/*
 * 定时任务服务单测(2026-10-19):纯函数 parseAt/fmtAt + jobs.json 白名单解析。
 * launchctl/PlistBuddy 交互不在这里测(个人机专用、E2E 在页面上点)。
 */

// SOMEJOB_DIR 必须在 require 之前就位(JOB_DIR 是模块级常量)
process.env.SOMEJOB_DIR = join(tmpdir(), 'somejob-jobs-test');
if (!existsSync(process.env.SOMEJOB_DIR)) mkdirSync(process.env.SOMEJOB_DIR, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseAt, fmtAt, readManifest } = require('../src/service/jobs.service');

describe('jobs.service 时间格式', () => {
  it('parseAt 严格两位 HH:MM', () => {
    expect(parseAt('23:30')).toEqual({ h: 23, m: 30 });
    expect(parseAt('08:20')).toEqual({ h: 8, m: 20 });
    expect(parseAt('9:30')).toBeNull(); // 必须两位时
    expect(parseAt('24:00')).toBeNull();
    expect(parseAt('23:60')).toBeNull();
    expect(parseAt('')).toBeNull();
    expect(parseAt(null)).toBeNull();
  });
  it('fmtAt 补零', () => {
    expect(fmtAt(8, 5)).toBe('08:05');
    expect(fmtAt(23, 30)).toBe('23:30');
  });
});

describe('jobs.service jobs.json 白名单', () => {
  it('只收 com.tianhui.* 行,坏 label 剔除', () => {
    writeFileSync(
      join(process.env.SOMEJOB_DIR, 'jobs.json'),
      JSON.stringify([
        { label: 'com.tianhui.bit-radar', title: '币圈雷达 · 晚间', desc: 'x' },
        { label: 'rm -rf /; evil', title: '坏', desc: '' },
        { label: 'com.evil.other', title: '别域', desc: '' },
      ])
    );
    const ms = readManifest();
    expect(ms).toHaveLength(1);
    expect(ms[0].label).toBe('com.tianhui.bit-radar');
  });
  it('缺文件/坏 JSON 回 null(接口据此显式报错)', () => {
    writeFileSync(join(process.env.SOMEJOB_DIR, 'jobs.json'), '{坏');
    expect(readManifest()).toBeNull();
    process.env.SOMEJOB_DIR = join(tmpdir(), 'somejob-不存在-' + Date.now());
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(require('../src/service/jobs.service').readManifest()).toBeNull();
  });
});

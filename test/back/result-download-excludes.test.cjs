const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const express = require('express');
const load = require('../helpers/load-security-module.cjs');

const { normalizeResultExcludes, resultDownloadFilter } = load(path.resolve('back/shared/resultDownloadFilter.ts'));

/** 从 ZIP 中央目录读取实际归档路径，不依赖额外 ZIP 测试库。 */
function zipNames(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const names = [];
  let offset = buffer.readUInt32LE(end + 16);
  while (offset < end) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const length = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 46, offset + 46 + length).toString());
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return names;
}

/** 覆盖中文目录、零层级 **、单字符、字面特殊字符与目录递归。 */
test('结果下载规则规范化并只支持明确的路径通配符', () => {
  assert.deepEqual(normalizeResultExcludes([' cache/ ', '', 'cache/', '**/*.log']), ['cache/', '**/*.log']);
  for (const invalid of ['../cache', '/cache', 'a/../b', 'a\\b', 'a//b', '{cache}', 'C:/cache'])
    assert.throws(() => normalizeResultExcludes([invalid]));
  assert.throws(() => normalizeResultExcludes(Array(201).fill('a')));
  const matches = resultDownloadFilter(['cache/', '**/*.log', '**/缓存/**', '报告?.json', 'data[1].tmp']);
  assert.equal(matches('cache', true), true);
  assert.equal(matches('cache', false), false);
  for (const name of ['a.log', '资料/b.log', '缓存', '资料/缓存', '资料/缓存/a.bin', '报告一.json', 'data[1].tmp']) assert.equal(matches(name, false), true, name);
  for (const name of ['资料.json', 'nested/cache', '报告十一.json', 'data1.tmp']) assert.equal(matches(name, true), false, name);
});

/** 真实 HTTP 与 ZIP 验证下载量下降，同时监测排除目录和文件没有被打开。 */
test('结果在青龙打包前排除，空结果、旧请求及参数校验兼容', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-pull-excludes-'));
  const directory = path.join(root, '医院结果');
  fs.mkdirSync(path.join(directory, 'cache/deep'), { recursive: true });
  fs.mkdirSync(path.join(directory, '资料'), { recursive: true });
  fs.writeFileSync(path.join(directory, '数据.json'), '{"有效":true}');
  fs.writeFileSync(path.join(directory, 'cache/deep/large.bin'), randomBytes(256 * 1024));
  fs.writeFileSync(path.join(directory, '资料/debug.log'), randomBytes(256 * 1024));
  const directories = [], openedFiles = [];
  const trackedFs = { ...fs.promises,
    opendir: async (name, ...args) => { directories.push(name); return fs.promises.opendir(name, ...args); },
    open: async (name, ...args) => { openedFiles.push(name); return fs.promises.open(name, ...args); },
  };
  const browser = load(path.resolve('back/api/fileBrowser.ts'), {
    'fs/promises': trackedFs,
    '../config/util': {},
    '../shared/i18n': { t: (text) => text },
    './i18n': { t: (text) => text },
    typedi: { Container: { get: () => ({ info() {}, error() {} }) } },
  }).default;
  const app = express(); app.use(express.json());
  app.use('/open/results', browser({ root, allowDirectoryDownload: true }));
  app.use(require('celebrate').errors());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/open/results/download`;
  const download = async (extra = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '', filename: '医院结果', ...extra }) });
  let response = await download();
  assert.equal(response.status, 200); assert.equal(response.headers.get('X-QL-Results-Filter'), null);
  const full = Buffer.from(await response.arrayBuffer());
  assert.ok(zipNames(full).includes('医院结果/cache/deep/large.bin'));
  directories.length = 0; openedFiles.length = 0;
  response = await download({ excludePatterns: ['cache/', '**/*.log'] });
  assert.equal(response.headers.get('X-QL-Results-Filter'), 'exclude-v1');
  const filtered = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(zipNames(filtered).sort(), ['医院结果/', '医院结果/数据.json', '医院结果/资料/'].sort());
  assert.ok(filtered.length < full.length / 100);
  assert.equal(directories.some((name) => name.includes('cache')), false);
  assert.equal(openedFiles.some((name) => name.includes('cache') || name.endsWith('.log')), false);
  response = await download({ excludePatterns: ['**'] });
  assert.deepEqual(zipNames(Buffer.from(await response.arrayBuffer())), ['医院结果/']);
  response = await download({ excludePatterns: ['does-not-exist/'] });
  assert.equal(Buffer.from(await response.arrayBuffer()).length, full.length);
  assert.equal((await download({ excludePatterns: ['../outside'] })).status, 400);
  assert.equal((await download({ excludePatterns: 'cache/' })).status, 400);
  assert.equal((await download({ filename: '医院结果/数据.json', excludePatterns: ['**'] })).status, 400);
  console.log(`青龙 ZIP 对比：全量 ${full.length} B，排除后 ${filtered.length} B；排除目录未遍历，排除文件未读取。`);
});

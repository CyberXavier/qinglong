import { Response } from 'express';
import { constants, ReadStream } from 'fs';
import * as fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ZipFile } from 'yazl';
import { resolveFileAccess } from './fileAccess';
import { t } from './i18n';

/** Stream a directory without buffering file contents or keeping all files open. */
export async function downloadDirectoryZip(
  directory: string,
  res: Response,
  blacklist: string[] = [],
) {
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  let stopped = false;
  let source: ReadStream | undefined;
  const interrupted = new Error(t('下载已中断'));
  const stop = () => {
    if (res.writableFinished) return;
    stopped = true;
    source?.destroy();
    zip.emit('error', interrupted);
  };
  res.once('close', stop);
  zip.on('error', (error) => {
    stopped = true;
    source?.destroy();
    output.destroy(error);
  });

  const addDirectory = async (dir: string, zipPath: string): Promise<void> => {
    if (stopped) throw interrupted;
    zip.addEmptyDirectory(zipPath);
    const entries = await fs.opendir(dir);
    for await (const entry of entries) {
      if (stopped) throw interrupted;
      if (entry.isSymbolicLink() || blacklist.includes(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      const stats = await fs.lstat(filePath);
      if (stats.isSymbolicLink()) continue;
      const safePath = resolveFileAccess(directory, [filePath], blacklist);
      if (!safePath) throw new Error(t('暂无权限'));
      const entryPath = path.posix.join(zipPath, entry.name);
      if (stats.isDirectory()) {
        await addDirectory(safePath, entryPath);
      } else if (stats.isFile()) {
        zip.addReadStreamLazy(
          entryPath,
          { mtime: stats.mtime, mode: stats.mode },
          (callback) => {
            // Validate again when the queued file is actually opened.
            const open = async () => {
              if (stopped) throw interrupted;
              const target = resolveFileAccess(
                directory,
                [safePath],
                blacklist,
              );
              if (!target) throw new Error(t('暂无权限'));
              const handle = await fs.open(
                target,
                constants.O_RDONLY | constants.O_NOFOLLOW,
              );
              try {
                const fileStats = await handle.stat();
                if (stopped || !fileStats.isFile()) {
                  throw interrupted;
                }
                const stream = handle.createReadStream();
                source = stream;
                stream.once('error', (error) => zip.emit('error', error));
                stream.once('close', () => {
                  if (source === stream) source = undefined;
                });
                callback(null, stream);
              } catch (error) {
                await handle.close();
                throw error;
              }
            };
            void open().catch((error) => zip.emit('error', error));
          },
        );
      }
    }
  };

  res.attachment(`${path.basename(directory)}.zip`);
  res.type('application/zip');
  try {
    await Promise.all([
      pipeline(output, res),
      (async () => {
        await addDirectory(directory, path.basename(directory));
        if (stopped) throw interrupted;
        zip.end();
      })(),
    ]);
  } catch (error) {
    zip.emit('error', error);
    res.destroy();
    throw error;
  } finally {
    stopped = true;
    res.off('close', stop);
    source?.destroy();
    output.destroy();
  }
}

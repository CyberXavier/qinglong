import { Router, Request, Response, NextFunction } from 'express';
import { celebrate, Joi } from 'celebrate';
import { Container } from 'typedi';
import { Logger } from 'winston';
import * as fs from 'fs/promises';
import { readDirs, readDir, IFile, getFileContentByName } from '../config/util';
import { resolveFileAccess } from '../shared/fileAccess';
import { t } from '../shared/i18n';
import { downloadDirectoryZip } from '../shared/directoryZip';

export default function fileBrowser({
  root,
  blacklist = [],
  createRoot = false,
  allowDirectoryDownload = false,
}: {
  root: string;
  blacklist?: string[];
  createRoot?: boolean;
  allowDirectoryDownload?: boolean;
}) {
  const route = Router();
  route.get(
    '/',
    celebrate({
      query: Joi.object({
        path: Joi.string().optional().allow(''),
      }).unknown(true),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const logger: Logger = Container.get('logger');
      try {
        let result: IFile[] = [];
        if (createRoot) await fs.mkdir(root, { recursive: true });
        if (req.query.path) {
          if (!resolveFileAccess(root, [req.query.path as string])) {
            return res.send({ code: 403, message: t('暂无权限') });
          }
          result = await readDir(req.query.path as string, root, blacklist);
        } else {
          result = await readDirs(root, root, blacklist, (a, b) => {
            if (a.type === b.type) {
              return a.title.localeCompare(b.title);
            } else {
              return a.type === 'directory' ? -1 : 1;
            }
          });
        }
        res.send({
          code: 200,
          data: result,
        });
      } catch (e) {
        logger.error('🔥 error: %o', e);
        return next(e);
      }
    },
  );

  route.get(
    '/detail',
    celebrate({
      query: Joi.object({
        path: Joi.string().optional().allow(''),
        file: Joi.string().required(),
      }).unknown(true),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const filePath = resolveFileAccess(root, [
          (req.query.path as string) || '',
          req.query.file as string,
        ]);
        if (!filePath) {
          return res.status(403).send({ code: 403, message: t('暂无权限') });
        }
        const content = await getFileContentByName(filePath);
        res.send({ code: 200, data: content });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.delete(
    '/',
    celebrate({
      body: Joi.object({
        filename: Joi.string().required(),
        path: Joi.string().optional().allow(''),
        type: Joi.string().optional(),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        let { filename, path } = req.body as {
          filename: string;
          path: string;
        };
        if (!path) {
          path = '';
        }
        const filePath = resolveFileAccess(root, [path, filename]);
        if (!filePath) {
          return res.send({
            code: 403,
            message: t('暂无权限'),
          });
        }
        await fs.rm(filePath, { force: true, recursive: true, maxRetries: 5 });
        res.send({ code: 200 });
      } catch (e) {
        return next(e);
      }
    },
  );

  route.post(
    '/download',
    celebrate({
      body: Joi.object({
        filename: Joi.string().required(),
        path: Joi.string().optional().allow(''),
      }),
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        let { filename, path } = req.body as {
          filename: string;
          path: string;
        };
        if (!path) {
          path = '';
        }
        const filePath = resolveFileAccess(root, [path, filename]);
        if (!filePath) {
          return res.status(403).send({
            code: 403,
            message: t('暂无权限'),
          });
        }
        if (allowDirectoryDownload) {
          const stats = await fs.lstat(filePath);
          if (stats.isDirectory()) {
            await downloadDirectoryZip(filePath, res, blacklist);
            return;
          }
          if (!stats.isFile()) {
            return res.status(403).send({ code: 403, message: t('暂无权限') });
          }
        }
        return res.download(filePath, filename, (err) => {
          if (err) {
            if (res.headersSent || res.destroyed) {
              res.destroy();
              return;
            }
            return next(err);
          }
        });
      } catch (e) {
        if (res.headersSent || res.destroyed) {
          const logger: Logger = Container.get('logger');
          logger.error('File download failed: %o', e);
          res.destroy();
          return;
        }
        return next(e);
      }
    },
  );

  return route;
}

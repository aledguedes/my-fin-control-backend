import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface CacheConfig {
  maxAge?: number; // Tempo em segundos (padrão: 300 = 5 minutos)
  mustRevalidate?: boolean;
}

/**
 * Middleware de cache HTTP usando ETags e Last-Modified
 *
 * Uso:
 * router.get('/endpoint', authenticateToken, cacheMiddleware(), handler)
 */
export const cacheMiddleware = (config: CacheConfig = {}) => {
  const { maxAge = 300, mustRevalidate = true } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    // Apenas para métodos GET e HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    // Armazenar função original de res.json
    const originalJson = res.json.bind(res);

    res.json = function (data: any) {
      // Calcular ETag baseado no conteúdo
      const etag = generateETag(data);

      // Verificar If-None-Match do cliente
      const clientETag = req.headers['if-none-match'];
      if (clientETag && clientETag === etag) {
        res.status(304).end(); // Not Modified
        return res;
      }

      // Adicionar headers de cache
      res.set({
        ETag: etag,
        'Cache-Control': `private, max-age=${maxAge}${mustRevalidate ? ', must-revalidate' : ''}`,
        Vary: 'Authorization', // Cache varia por usuário (token)
      });

      // Se os dados têm updated_at, usar como Last-Modified
      const lastModified = extractLastModified(data);
      if (lastModified) {
        res.set('Last-Modified', new Date(lastModified).toUTCString());

        // Verificar If-Modified-Since
        const ifModifiedSince = req.headers['if-modified-since'];
        if (ifModifiedSince) {
          const clientDate = new Date(ifModifiedSince);
          const serverDate = new Date(lastModified);
          if (serverDate <= clientDate) {
            res.status(304).end();
            return res;
          }
        }
      }

      return originalJson(data);
    };

    next();
  };
};

/**
 * Gera ETag baseado no hash do conteúdo
 */
function generateETag(data: any): string {
  const str = JSON.stringify(data);
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `"${hash}"`;
}

/**
 * Extrai o último updated_at dos dados retornados
 */
function extractLastModified(data: any): string | null {
  if (!data) return null;

  // Se for array, pegar o maior updated_at
  if (Array.isArray(data)) {
    const dates = data
      .map((item: any) => {
        // Pode estar em diferentes formatos
        if (item.updated_at) return new Date(item.updated_at).getTime();
        if (item.updatedAt) return new Date(item.updatedAt).getTime();
        return null;
      })
      .filter((d): d is number => d !== null);

    if (dates.length === 0) return null;
    return new Date(Math.max(...dates)).toISOString();
  }

  // Se for objeto com array dentro (ex: { transactions: [...] })
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    for (const key of keys) {
      if (Array.isArray(data[key])) {
        const dates = data[key]
          .map((item: any) => {
            if (item.updated_at) return new Date(item.updated_at).getTime();
            if (item.updatedAt) return new Date(item.updatedAt).getTime();
            return null;
          })
          .filter((d): d is number => d !== null);

        if (dates.length > 0) {
          return new Date(Math.max(...dates)).toISOString();
        }
      }
    }

    // Verificar se o próprio objeto tem updated_at
    if (data.updated_at) return new Date(data.updated_at).toISOString();
    if (data.updatedAt) return new Date(data.updatedAt).toISOString();
  }

  return null;
}

/**
 * Middleware para invalidar cache após mutações
 * Adiciona header Cache-Control: no-cache para forçar revalidação
 */
export const invalidateCache = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
};

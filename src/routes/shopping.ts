import express from 'express';
import { DatabaseService } from '../services/databaseService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { validateRequest } from '../validation';
import { normalizeProductPayload } from '../middleware/normalizeProductPayload';
import { cacheMiddleware, invalidateCache } from '../middleware/cache';

import {
  shoppingListSchema,
  duplicateShoppingListSchema,
  shoppingListItemSchema,
  productSchema,
  shoppingCategorySchema,
} from '../validation/schemas';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

/**
 * @swagger
 * /shopping/lists:
 *   get:
 *     summary: Listar listas de compras
 *     description: Retorna todas as listas de compras do usuário autenticado
 *     tags:
 *       - Compras - Listas
 *     responses:
 *       200:
 *         description: Lista de listas retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 lists:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShoppingList'
 *       500:
 *         description: Erro ao buscar listas
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Listar listas de compras
router.get(
  '/lists',
  authenticateToken,
  cacheMiddleware({ maxAge: 300 }), // 5 minutos
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const result = await DatabaseService.getShoppingLists(userId);

      if (result?.error) {
        return next(createError('Erro ao buscar listas', 500));
      }

      res.json({ lists: result?.data || [] });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists:
 *   post:
 *     summary: Criar lista de compras
 *     description: Cria uma nova lista de compras com itens opcionais vinculados ao usuário autenticado
 *     tags:
 *       - Compras - Listas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome da lista
 *                 example: Compras da Semana
 *               items:
 *                 type: array
 *                 description: Lista opcional de IDs de produtos para adicionar na criação
 *                 items:
 *                   type: string
 *                   example: prod_123
 *                 example:
 *                   - prod_id_1
 *                   - prod_id_4
 *                   - prod_id_7
 *     responses:
 *       201:
 *         description: Lista criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 status:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShoppingListItem'
 *       400:
 *         description: Erro de validação na entrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao criar lista
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Criar lista de compras
router.post(
  '/lists',
  authenticateToken,
  invalidateCache,
  validateRequest(shoppingListSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, items } = req.body;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res
          .status(400)
          .json({ error: 'O nome da lista é obrigatório.' });
      }
      if (items && !Array.isArray(items)) {
        return res
          .status(400)
          .json({ error: 'O campo items deve ser um array.' });
      }

      const result = await DatabaseService.createShoppingList({
        name,
        items,
        user_id: userId,
      });
      console.log(result);
      if (result?.error) {
        if (result.error.message?.includes('Produto não encontrado')) {
          return res.status(400).json({ error: result.error.message });
        }
        return next(createError('Erro ao criar lista', 500));
      }

      res.status(201).json(result.data);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/duplicate:
 *   post:
 *     summary: Duplicar lista de compras
 *     description: Cria uma nova lista baseada em uma lista existente, copiando produtos e quantidades
 *     tags:
 *       - Compras - Listas
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - baseListId
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome da nova lista
 *                 example: Compras da Próxima Semana
 *               baseListId:
 *                 type: string
 *                 description: ID da lista a ser copiada
 *                 example: list_123
 *     responses:
 *       201:
 *         description: Lista duplicada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShoppingList'
 *       400:
 *         description: Dados inválidos
 *       404:
 *         description: Lista base não encontrada
 *       500:
 *         description: Erro ao duplicar lista
 */
// Duplicar lista de compras
router.post(
  '/lists/duplicate',
  authenticateToken,
  invalidateCache,
  validateRequest(duplicateShoppingListSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, baseListId } = req.body;

      const result = await DatabaseService.duplicateShoppingList(
        baseListId,
        name,
        userId,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista base não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.status(201).json(result.data);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/products:
 *   get:
 *     summary: Listar produtos
 *     description: Retorna todos os produtos cadastrados pelo usuário
 *     tags:
 *       - Compras - Produtos
 *     responses:
 *       200:
 *         description: Lista de produtos retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *       500:
 *         description: Erro ao buscar produtos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Listar produtos
router.get(
  '/products',
  authenticateToken,
  cacheMiddleware({ maxAge: 300 }), // 5 minutos
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const result = await DatabaseService.getProducts(userId);

      if (result?.error) {
        return next(createError('Erro ao buscar produtos', 500));
      }

      res.json({ products: result?.data || [] });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/categories:
 *   get:
 *     summary: Listar categorias de compra
 *     description: Retorna todas as categorias de compra do usuário
 *     tags:
 *       - Compras - Categorias
 *     responses:
 *       200:
 *         description: Lista de categorias retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShoppingCategory'
 *       500:
 *         description: Erro ao buscar categorias
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Listar categorias de compra
router.get(
  '/categories',
  authenticateToken,
  cacheMiddleware({ maxAge: 600 }), // 10 minutos - categorias mudam pouco
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const result = await DatabaseService.getShoppingCategories(userId);

      if (result?.error) {
        return next(createError('Erro ao buscar categorias', 500));
      }

      res.json({ categories: result?.data || [] });
    } catch (error) {
      next(error);
    }
  },
);

// Criar categoria de compra
router.post(
  '/categories',
  authenticateToken,
  invalidateCache,
  validateRequest(shoppingCategorySchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name } = req.body;

      const result = await DatabaseService.createShoppingCategory({
        name,
        user_id: userId,
      });

      if (result?.error) {
        return next(createError('Erro ao criar categoria', 500));
      }

      res.status(201).json({ category: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/products:
 *   post:
 *     summary: Criar produto
 *     description: Cria um novo produto no catálogo do usuário
 *     tags:
 *       - Compras - Produtos
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - unit
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome do produto
 *                 example: Arroz Integral 5kg
 *               unit:
 *                 type: string
 *                 enum: [un, kg, l, dz, m, cx]
 *                 description: Unidade de medida
 *                 example: un
 *     responses:
 *       201:
 *         description: Produto criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product:
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         description: Produto duplicado (já existe produto com nome similar)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Já existe um produto cadastrado com o nome "Água Sanitária". Produtos com nomes similares (com ou sem acentos, maiúsculas/minúsculas) são considerados iguais.
 *       500:
 *         description: Erro ao criar produto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Criar produto
router.post(
  '/products',
  authenticateToken,
  invalidateCache,
  normalizeProductPayload,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, unit, category_id } = req.body;

      const result = await DatabaseService.createProduct({
        name,
        unit,
        category_id,
        user_id: userId,
      });

      if (result?.error) {
        // Erro de produto duplicado
        if (result.error.code === 'DUPLICATE_PRODUCT_NAME') {
          return res.status(400).json({ error: result.error.message });
        }
        return next(createError('Erro ao criar produto', 500));
      }

      res.status(201).json({ product: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{id}:
 *   get:
 *     summary: Detalhes da lista com itens
 *     description: Retorna os detalhes completos de uma lista de compras incluindo todos os itens
 *     tags:
 *       - Compras - Listas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da lista de compras
 *     responses:
 *       200:
 *         description: Detalhes da lista retornados com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 list:
 *                   $ref: '#/components/schemas/ShoppingList'
 *       404:
 *         description: Lista não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao buscar lista
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Detalhes da lista com itens
router.get(
  '/lists/:id',
  authenticateToken,
  cacheMiddleware({ maxAge: 180 }), // 3 minutos - lista pode mudar frequentemente
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da lista é obrigatório', 400));
      }

      const result = await DatabaseService.getShoppingListWithItems(id, userId);

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ list: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{id}:
 *   put:
 *     summary: Sincronizar lista completa
 *     description: Atualiza a lista e substitui todos os itens (Sincronização)
 *     tags:
 *       - Compras - Listas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da lista
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShoppingList'
 *     responses:
 *       200:
 *         description: Lista sincronizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShoppingList'
 *       500:
 *         description: Erro ao sincronizar lista
 */
router.put(
  '/lists/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const listData = req.body;

      if (!id) {
        return next(createError('ID da lista é obrigatório', 400));
      }

      const result = await DatabaseService.syncShoppingList(
        id,
        userId,
        listData,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ list: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{id}:
 *   delete:
 *     summary: Excluir lista
 *     description: Exclui uma lista de compras e todos os seus itens
 *     tags:
 *       - Compras - Listas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da lista de compras
 *     responses:
 *       200:
 *         description: Lista excluída com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Lista excluída com sucesso
 *       404:
 *         description: Lista não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao excluir lista
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Excluir lista
router.delete(
  '/lists/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da lista é obrigatório', 400));
      }

      const result = await DatabaseService.deleteShoppingList(id, userId);

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ message: 'Lista excluída com sucesso' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{id}/complete:
 *   post:
 *     summary: Finalizar lista
 *     description: Marca uma lista de compras como completed e calcula o valor total
 *     tags:
 *       - Compras - Listas
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da lista de compras
 *     responses:
 *       200:
 *         description: Lista completed com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 list:
 *                   $ref: '#/components/schemas/ShoppingList'
 *       404:
 *         description: Lista não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao finalizar lista
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Finalizar lista
router.put(
  // Alterado para PUT, mais adequado para atualização/sincronização
  '/lists/:id/complete',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      // Dados de cabeçalho da lista enviados pelo front-end (opcional)
      const listPayload = req.body;

      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da lista é obrigatório', 400));
      }

      const result = await DatabaseService.completeShoppingList(
        id,
        userId,
        listPayload,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      } // Transação financeira NÃO é mais criada automaticamente

      res.json({ list: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{listId}/items:
 *   post:
 *     summary: Adicionar item à lista
 *     description: Adiciona um novo item a uma lista de compras
 *     tags:
 *       - Compras - Itens
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da lista de compras
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product_id
 *               - quantity
 *             properties:
 *               product_id:
 *                 type: integer
 *                 description: ID do produto
 *                 example: 1
 *               quantity:
 *                 type: number
 *                 format: decimal
 *                 description: Quantidade do produto
 *                 example: 2.5
 *               price:
 *                 type: number
 *                 format: decimal
 *                 description: Preço unitário
 *                 example: 15.99
 *               category_id:
 *                 type: integer
 *                 description: ID da categoria (opcional)
 *     responses:
 *       201:
 *         description: Item adicionado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/ShoppingItem'
 *       404:
 *         description: Lista não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao criar item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Adicionar item à lista (Suporta lote ou individual)
router.post(
  '/lists/:listId/items',
  authenticateToken,
  invalidateCache,
  // validateRequest(shoppingListItemSchema), // Removido para suportar array
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { listId } = req.params;

      if (!listId) {
        return next(createError('ID da lista é obrigatório', 400));
      }

      if (Array.isArray(req.body)) {
        // Batch mode
        const result = await DatabaseService.addBatchShoppingItems(
          listId,
          userId,
          req.body,
        );
        if (result?.error) {
          return next(createError(result.error.message, 500));
        }
        res.status(201).json(result.data);
      } else {
        // Legacy single item mode
        const { quantity, price, product_id, category_id } = req.body;

        // Verificar se a lista existe e pertence ao usuário
        const listCheck = await DatabaseService.getShoppingListById(
          listId,
          userId,
        );
        if (!listCheck || !listCheck.data) {
          return next(createError('Lista não encontrada', 404));
        }

        const result = await DatabaseService.createShoppingItem({
          quantity,
          price: price || 0,
          shopping_list_id: listId,
          product_id,
          category_id,
          user_id: userId,
        });

        if (result?.error) {
          return next(createError('Erro ao criar item', 500));
        }

        res.status(201).json({ item: result?.data });
      }
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{listId}/items/{itemId}:
 *   put:
 *     summary: Atualizar item da lista
 *     description: Atualiza a quantidade, preço ou status de um item da lista
 *     tags:
 *       - Compras - Itens
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da lista de compras
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do item
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               quantity:
 *                 type: number
 *                 format: decimal
 *                 description: Nova quantidade
 *               price:
 *                 type: number
 *                 format: decimal
 *                 description: Novo preço unitário
 *               checked:
 *                 type: boolean
 *                 description: Marcar/desmarcar item como comprado
 *     responses:
 *       200:
 *         description: Item atualizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/ShoppingItem'
 *       404:
 *         description: Lista ou item não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao atualizar item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Atualizar item da lista
router.put(
  '/lists/:listId/items/:itemId',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { listId, itemId } = req.params;
      const { quantity, price, checked } = req.body;

      if (!listId || !itemId) {
        return next(createError('IDs são obrigatórios', 400));
      }

      const result = await DatabaseService.updateShoppingItem(
        itemId,
        listId,
        userId,
        { quantity, price, checked },
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ item: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/lists/{listId}/items/{itemId}:
 *   delete:
 *     summary: Excluir item da lista
 *     description: Remove um item de uma lista de compras
 *     tags:
 *       - Compras - Itens
 *     parameters:
 *       - in: path
 *         name: listId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da lista de compras
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do item
 *     responses:
 *       200:
 *         description: Item excluído com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Item excluído com sucesso
 *       404:
 *         description: Lista ou item não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao excluir item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Excluir item da lista
router.delete(
  '/lists/:listId/items/:itemId',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { listId, itemId } = req.params;

      if (!listId || !itemId) {
        return next(createError('IDs são obrigatórios', 400));
      }

      const result = await DatabaseService.deleteShoppingItem(
        itemId,
        listId,
        userId,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Lista não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ message: 'Item excluído com sucesso' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/products/{id}:
 *   put:
 *     summary: Atualizar produto
 *     description: Atualiza as informações de um produto
 *     tags:
 *       - Compras - Produtos
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do produto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome do produto
 *               unit:
 *                 type: string
 *                 enum: [un, kg, l, dz, m, cx]
 *                 description: Unidade de medida
 *               category_id:
 *                 type: integer
 *                 description: ID da categoria
 *     responses:
 *       200:
 *         description: Produto atualizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product:
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         description: Produto não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       400:
 *         description: Produto duplicado (já existe produto com nome similar)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Já existe um produto cadastrado com o nome "Água Sanitária". Produtos com nomes similares (com ou sem acentos, maiúsculas/minúsculas) são considerados iguais.
 *       500:
 *         description: Erro ao atualizar produto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Atualizar produto
router.put(
  '/products/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const { name, unit, category_id } = req.body;

      if (!id) {
        return next(createError('ID do produto é obrigatório', 400));
      }

      const result = await DatabaseService.updateProduct(id, userId, {
        name,
        unit,
        category_id,
      });

      if (result?.error) {
        // Erro de produto duplicado
        if (result.error.code === 'DUPLICATE_PRODUCT_NAME') {
          return res.status(400).json({ error: result.error.message });
        }
        const statusCode =
          result.error.message === 'Produto não encontrado' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ product: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/products/{id}:
 *   delete:
 *     summary: Excluir produto
 *     description: Exclui um produto do catálogo (não permitido se houver dependências)
 *     tags:
 *       - Compras - Produtos
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do produto
 *     responses:
 *       200:
 *         description: Produto excluído com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Produto excluído com sucesso
 *       404:
 *         description: Produto não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Produto possui dependências e não pode ser excluído
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao excluir produto
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Excluir produto
router.delete(
  '/products/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID do produto é obrigatório', 400));
      }

      const result = await DatabaseService.deleteProduct(id, userId);

      if (result?.error) {
        if (result.error.code === 'DEPENDENCY_ERROR') {
          return next(createError(result.error.message, 409));
        }
        const statusCode =
          result.error.message === 'Produto não encontrado' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ message: 'Produto excluído com sucesso' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/categories:
 *   post:
 *     summary: Criar categoria de compras
 *     description: Cria uma nova categoria para organizar produtos
 *     tags:
 *       - Compras - Categorias
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome da categoria
 *                 example: Higiene
 *     responses:
 *       201:
 *         description: Categoria criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 category:
 *                   $ref: '#/components/schemas/ShoppingCategory'
 *       400:
 *         description: Nome da categoria é obrigatório
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao criar categoria
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Criar categoria de compras
router.post(
  '/categories',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name } = req.body;

      if (!name) {
        return next(createError('Nome da categoria é obrigatório', 400));
      }

      const result = await DatabaseService.createShoppingCategory({
        name,
        user_id: userId,
      });

      if (result?.error) {
        return next(createError('Erro ao criar categoria', 500));
      }

      res.status(201).json({ category: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/categories/{id}:
 *   put:
 *     summary: Atualizar categoria de compras
 *     description: Atualiza o nome de uma categoria
 *     tags:
 *       - Compras - Categorias
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da categoria
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Novo nome da categoria
 *     responses:
 *       200:
 *         description: Categoria atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 category:
 *                   $ref: '#/components/schemas/ShoppingCategory'
 *       400:
 *         description: Parâmetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Categoria não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao atualizar categoria
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Atualizar categoria de compras
router.put(
  '/categories/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const { name } = req.body;

      if (!id) {
        return next(createError('ID da categoria é obrigatório', 400));
      }

      if (!name) {
        return next(createError('Nome da categoria é obrigatório', 400));
      }

      const result = await DatabaseService.updateShoppingCategory(id, userId, {
        name,
      });

      if (result?.error) {
        const statusCode =
          result.error.message === 'Categoria não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ category: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/categories/{id}:
 *   delete:
 *     summary: Excluir categoria de compras
 *     description: Exclui uma categoria (não permitido se houver produtos associados)
 *     tags:
 *       - Compras - Categorias
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da categoria
 *     responses:
 *       200:
 *         description: Categoria excluída com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Categoria excluída com sucesso
 *       404:
 *         description: Categoria não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Categoria possui produtos associados e não pode ser excluída
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao excluir categoria
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Excluir categoria de compras
router.delete(
  '/categories/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da categoria é obrigatório', 400));
      }

      const result = await DatabaseService.deleteShoppingCategory(id, userId);

      if (result?.error) {
        if (result.error.code === 'DEPENDENCY_ERROR') {
          return next(createError(result.error.message, 409));
        }
        const statusCode =
          result.error.message === 'Categoria não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ message: 'Categoria excluída com sucesso' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/cleanup-orphaned-transactions:
 *   post:
 *     summary: Limpar transações órfãs
 *     description: Remove transações financeiras de listas de compras que foram deletadas
 *     tags:
 *       - Compras - Listas
 *     responses:
 *       200:
 *         description: Limpeza executada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 deletedCount:
 *                   type: number
 *       500:
 *         description: Erro ao executar limpeza
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Limpar transações órfãs (transações de listas deletadas)
router.post(
  '/cleanup-orphaned-transactions',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const result =
        await DatabaseService.cleanupOrphanedShoppingTransactions(userId);

      if (result?.error) {
        return next(createError(result.error.message, 500));
      }

      res.json({
        message: result.data?.message || 'Limpeza concluída',
        deletedCount: result.data?.deletedCount || 0,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /shopping/transactions/{transactionId}:
 *   delete:
 *     summary: Deletar transação de compras específica
 *     description: Remove uma transação financeira específica de compras por ID
 *     tags:
 *       - Compras - Listas
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da transação a ser deletada
 *     responses:
 *       200:
 *         description: Transação deletada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Transação não encontrada
 *       500:
 *         description: Erro ao deletar transação
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Deletar transação específica de compras
router.delete(
  '/transactions/:transactionId',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { transactionId } = req.params;

      if (!transactionId) {
        return next(createError('ID da transação é obrigatório', 400));
      }

      const result = await DatabaseService.deleteShoppingTransaction(
        transactionId,
        userId,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Transação não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({
        message: result.data?.message || 'Transação deletada com sucesso',
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

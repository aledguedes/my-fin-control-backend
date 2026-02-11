import express from 'express';
import { DatabaseService } from '../services/databaseService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import {
  transactionSchema,
  financialCategorySchema,
  monthlyViewQuerySchema,
} from '../validation/schemas';
import { validateRequest, validateQuery } from '../validation/index';
import { normalizeTransactionPayload } from '../middleware/normalizeTransactionPayload';
import { createError } from '../middleware/errorHandler';
import { cacheMiddleware, invalidateCache } from '../middleware/cache';
import { parseISO, addMonths, getDate, isBefore } from 'date-fns';

const router = express.Router();

/**
 * @swagger
 * /financial/categories:
 *   get:
 *     summary: Listar categorias financeiras
 *     description: Retorna todas as categorias financeiras do usuário autenticado
 *     tags:
 *       - Financeiro - Categorias
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
 *                     $ref: '#/components/schemas/FinancialCategory'
 *       500:
 *         description: Erro ao buscar categorias
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Listar categorias financeiras
router.get(
  '/categories',
  authenticateToken,
  cacheMiddleware({ maxAge: 600 }), // 10 minutos - categorias mudam pouco
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const result = await DatabaseService.getFinancialCategories(userId);

      if (result?.error) {
        return next(createError('Erro ao buscar categorias', 500));
      }

      res.json({ categories: result?.data || [] });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/categories:
 *   post:
 *     summary: Criar categoria financeira
 *     description: Cria uma nova categoria financeira para o usuário autenticado
 *     tags:
 *       - Financeiro - Categorias
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nome da categoria
 *                 example: Moradia
 *               type:
 *                 type: string
 *                 enum: [revenue, expense]
 *                 description: Tipo da categoria (receita ou despesa)
 *                 example: expense
 *     responses:
 *       201:
 *         description: Categoria criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 category:
 *                   $ref: '#/components/schemas/FinancialCategory'
 *       500:
 *         description: Erro ao criar categoria
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Criar categoria financeira
router.post(
  '/categories',
  authenticateToken,
  invalidateCache,
  validateRequest(financialCategorySchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { name, type } = req.body;

      const result = await DatabaseService.createFinancialCategory({
        name,
        type,
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
 * /financial/transactions:
 *   get:
 *     summary: Listar transações
 *     tags:
 *       - Financeiro - Transações
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Data final (YYYY-MM-DD)
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: string
 *         description: ID da categoria para filtrar
 *     responses:
 *       '200':
 *         description: Lista de transações retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TransactionResponse'
 *       '500':
 *         description: Erro ao buscar transações
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Listar transações
router.get(
  '/transactions',
  authenticateToken,
  cacheMiddleware({ maxAge: 180 }), // 3 minutos - dados mais dinâmicos
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { start_date, end_date, category_id } = req.query;

      const filters: any = {};
      if (start_date) filters.start_date = start_date;
      if (end_date) filters.end_date = end_date;
      if (category_id) filters.category_id = category_id;

      const result = await DatabaseService.getFinancialTransactions(
        userId,
        filters,
      );

      if (result?.error) {
        return next(createError('Erro ao buscar transações', 500));
      }

      res.json({ transactions: result?.data || [] });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/transactions:
 *   post:
 *     summary: Criar transação
 *     tags:
 *       - Financeiro - Transações
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransactionCreate'
 *     responses:
 *       '201':
 *         description: Transação criada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   $ref: '#/components/schemas/TransactionResponse'
 *                 message:
 *                   type: string
 *       '400':
 *         description: Falha na validação de entrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Erro interno ao criar transação
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Criar transação
router.post(
  '/transactions',
  authenticateToken,
  invalidateCache,
  normalizeTransactionPayload,
  validateRequest(transactionSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const {
        description,
        amount,
        type,
        category_id,
        transaction_date,
        is_installment,
        is_recurrent,
        recurrence_start_date,
        installments,
        payment_method,
      } = req.body;

      const totalInstallments = installments.total_installments;
      const startDate = installments.start_date;
      const paidInstallments = installments.paid_installments || 0;

      const result = await DatabaseService.createFinancialTransaction({
        description,
        amount,
        type,
        category_id,
        user_id: userId,
        transaction_date,
        is_installment: is_installment,
        is_recurrent: is_recurrent || false,
        recurrence_start_date,
        total_installments: totalInstallments,
        start_date: startDate,
        paid_installments: paidInstallments,
        payment_method,
      });

      if (result?.error) {
        return next(createError('Erro ao criar transação financeira', 500));
      }

      res.status(201).json({
        transaction: result?.data,
        message: 'Transação criada com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/transactions/{id}:
 *   put:
 *     summary: Atualizar transação
 *     description: Atualiza uma transação financeira existente
 *     tags:
 *       - Financeiro - Transações
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID da transação
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *               - amount
 *               - type
 *               - category_id
 *               - transaction_date
 *             properties:
 *               description:
 *                 type: string
 *                 description: Descrição da transação
 *               amount:
 *                 type: number
 *                 format: decimal
 *                 description: Valor da transação
 *               type:
 *                 type: string
 *                 enum: [revenue, expense]
 *                 description: Tipo da transação
 *               category_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID da categoria
 *               transaction_date:
 *                 type: string
 *                 format: date
 *                 description: Data da transação (YYYY-MM-DD)
 *               installment_number:
 *                 type: integer
 *                 description: Número da parcela atual
 *               total_installments:
 *                 type: integer
 *                 description: Total de parcelas
 *     responses:
 *       200:
 *         description: Transação atualizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   $ref: '#/components/schemas/TransactionResponse'
 *       404:
 *         description: Transação não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao atualizar transação
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Atualizar transação
router.put(
  '/transactions/:id',
  authenticateToken,
  invalidateCache,
  validateRequest(transactionSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      if (!id) {
        return next(createError('ID da transação é obrigatório', 400));
      }
      const {
        description,
        amount,
        type,
        category_id,
        transaction_date,
        installment_number,
        total_installments,
        payment_method,
      } = req.body;

      const result = await DatabaseService.updateFinancialTransaction(
        id,
        userId,
        {
          description,
          amount,
          type,
          category_id,
          transaction_date,
          installment_number: installment_number || 1,
          total_installments: total_installments || 1,
          payment_method,
        },
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Transação não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ transaction: result?.data });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/transactions/{id}:
 *   delete:
 *     summary: Excluir transação
 *     description: Exclui uma transação financeira
 *     tags:
 *       - Financeiro - Transações
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da transação
 *     responses:
 *       200:
 *         description: Transação excluída com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Transação excluída com sucesso
 *       404:
 *         description: Transação não encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Erro ao excluir transação
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Excluir transação
router.delete(
  '/transactions/:id',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da transação é obrigatório', 400));
      }

      const result = await DatabaseService.deleteFinancialTransaction(
        id,
        userId,
      );

      if (result?.error) {
        const statusCode =
          result.error.message === 'Transação não encontrada' ? 404 : 500;
        return next(createError(result.error.message, statusCode));
      }

      res.json({ message: 'Transação excluída com sucesso' });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/summary/monthly-view:
 *   get:
 *     summary: Visão mensal consolidada
 *     tags:
 *       - Financeiro - Sumários
 *     parameters:
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *         description: "Ano da consulta (ex: 2024)"
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Mês da consulta (1-12)
 *     responses:
 *       '200':
 *         description: Visão mensal retornada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 year:
 *                   type: integer
 *                 month:
 *                   type: integer
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *       '400':
 *         description: Parâmetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Erro ao buscar visão mensal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Função auxiliar para normalizar installments (Supabase retorna JSONB como objeto, SQLite como string)
function parseInstallments(installments: any): any {
  if (!installments) return null;
  if (typeof installments === 'object') return installments; // Já é objeto (Supabase JSONB)
  if (typeof installments === 'string') {
    try {
      return JSON.parse(installments); // String JSON (SQLite)
    } catch {
      return null;
    }
  }
  return null;
}

// Visão mensal consolidada
router.get(
  '/summary/monthly-view',
  authenticateToken,
  cacheMiddleware({ maxAge: 60 }), // 1 minuto - dados calculados podem mudar
  validateQuery(monthlyViewQuerySchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { year: qYear, month: qMonth } = req.query; // Validar parâmetros (mantido por robustez, embora o Joi já faça)

      if (!qYear || !qMonth) {
        return next(
          createError('Parâmetros year e month são obrigatórios', 400),
        );
      }

      const yearNum = parseInt(qYear as string);
      const monthNum = parseInt(qMonth as string);

      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return next(createError('Parâmetros year e month inválidos', 400));
      }

      // Trava de segurança: não permite visualizar meses anteriores a Jan/2026
      if (yearNum < 2026) {
        return next(
          createError(
            'A visualização de dados anteriores a Janeiro de 2026 não é permitida.',
            400,
          ),
        );
      }

      // CHAMA A FUNÇÃO CORRIGIDA DO BANCO DE DADOS (DatabaseService)

      const result = await DatabaseService.getMonthlyTransactions(
        userId,
        yearNum,
        monthNum,
      );

      if (result?.error) {
        return next(createError('Erro ao buscar visão mensal', 500));
      } // Processar transações para gerar entradas reais e virtuais:

      const transactions = result?.data || [];
      const monthlyView: any[] = [];

      const year = yearNum;
      const month = monthNum; // 1-12

      transactions.forEach((tx: any) => {
        // --- Lógica para Transações Parceladas (Geração de Parcelas Virtuais) ---
        // Normaliza campos que podem ser armazenados como JSON ou colunas
        const installmentsData = parseInstallments(tx.installments);
        const isInstallment =
          tx.is_installment === 1 ||
          tx.is_installment === true ||
          (installmentsData && installmentsData.totalInstallments > 1);

        const totalInstallments =
          installmentsData?.totalInstallments || tx.total_installments || 1;

        if (isInstallment && totalInstallments > 1) {
          // Determina a data de início da primeira parcela
          let startDateStr =
            tx.start_date || tx.transaction_date || installmentsData?.startDate;

          if (!startDateStr) return; // pula malformados
          const startDate = parseISO(startDateStr as string); // Itera para gerar parcelas virtuais

          for (let i = 1; i <= totalInstallments; i++) {
            const due = addMonths(startDate, i - 1);
            const dueYear = due.getFullYear();
            const dueMonth = due.getMonth() + 1; // Se o vencimento for no mês consultado, adiciona à view

            if (dueYear === year && dueMonth === month) {
              monthlyView.push({
                id: `${tx.id}_inst_${i}`,
                parent_id: tx.id,
                description: `${tx.description} (${i}/${totalInstallments})`, // Adicionado o número da parcela na descrição
                amount: (tx.amount || 0) / totalInstallments,
                type: tx.type,
                date: due.toISOString().split('T')[0],
                installment_number: i,
                total_installments: totalInstallments,
                category_id: tx.category_id,
                isInstallment: true,
              });
            }
          }
          return;
        } // --- Lógica para Transações Recorrentes (Geração de Entrada Virtual) ---

        const isRecurrent = tx.is_recurrent === 1 || tx.is_recurrent === true;
        if (isRecurrent) {
          const installmentsDataRecurrent = parseInstallments(tx.installments);
          let recurrenceStart =
            tx.recurrence_start_date ||
            installmentsDataRecurrent?.startDate ||
            null;

          if (!recurrenceStart) return;
          const start = parseISO(recurrenceStart as string); // Cria a data de ocorrência para o mês/ano consultado, mantendo o dia do mês de início // Note: month - 1 é porque Date usa 0-11 para meses

          const occurrence = new Date(year, month - 1, getDate(start)); // Garante que a ocorrência não seja antes da data de início real da recorrência

          if (isBefore(occurrence, start)) return;

          monthlyView.push({
            id: tx.id,
            description: tx.description,
            amount: tx.amount,
            type: tx.type,
            date: occurrence.toISOString().split('T')[0],
            category_id: tx.category_id,
            isRecurrent: true,
          });
          return;
        } // --- Lógica para Transações Únicas (Filtradas pelo DB) --- // A transação já foi filtrada pelo DB para cair no mês correto

        const txDate = tx.transaction_date || tx.date;
        if (txDate) {
          const parsed = parseISO(txDate);
          if (
            parsed.getFullYear() === year &&
            parsed.getMonth() + 1 === month
          ) {
            monthlyView.push({
              id: tx.id,
              description: tx.description,
              amount: tx.amount,
              type: tx.type,
              date: txDate,
              category_id: tx.category_id,
              isInstallment: false,
            });
          }
        }
      }); // --- NOVO: Cálculo do Sumário Consolidado ---

      let totalRevenue = 0;
      let totalExpense = 0;

      monthlyView.forEach((item) => {
        // Certifica-se de que o valor é um número
        const amount = parseFloat(item.amount || 0);
        if (item.type === 'revenue') {
          totalRevenue += amount;
        } else if (item.type === 'expense') {
          totalExpense += amount;
        }
      });

      const balance = totalRevenue - totalExpense;

      const summary = {
        // Arredonda para 2 casas decimais para evitar imprecisão de ponto flutuante
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalExpense: parseFloat(totalExpense.toFixed(2)),
        balance: parseFloat(balance.toFixed(2)),
      };

      res.json({
        year: yearNum,
        month: monthNum,
        transactions: monthlyView,
        summary, // NOVO: Incluído o objeto summary
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * @swagger
 * /financial/summary/installment-plans:
 *   get:
 *     summary: Planos de parcelamento
 *     description: Retorna todos os planos de parcelamento do usuário com status e valores calculados
 *     tags:
 *       - Financeiro - Sumários
 *     responses:
 *       200:
 *         description: Planos de parcelamento retornados com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 installmentPlans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                         description: ID da transação parcelada
 *                       description:
 *                         type: string
 *                         description: Descrição do parcelamento
 *                       totalAmount:
 *                         type: number
 *                         description: Valor total
 *                       installmentAmount:
 *                         type: number
 *                         description: Valor de cada parcela
 *                       totalInstallments:
 *                         type: integer
 *                         description: Total de parcelas
 *                       paidInstallments:
 *                         type: integer
 *                         description: Parcelas pagas
 *                       remainingInstallments:
 *                         type: integer
 *                         description: Parcelas restantes
 *                       startDate:
 *                         type: string
 *                         format: date
 *                         description: Data de início
 *                       status:
 *                         type: string
 *                         enum: [ativo, atrasado, concluído]
 *                         description: Status do parcelamento
 *                       type:
 *                         type: string
 *                         enum: [revenue, expense]
 *                         description: Tipo da transação
 *                       category_id:
 *                         type: string
 *                         format: uuid
 *                         description: ID da categoria
 *       500:
 *         description: Erro ao buscar planos de parcelamento
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Planos de parcelamento
router.get(
  '/summary/installment-plans',
  authenticateToken,
  cacheMiddleware({ maxAge: 180 }), // 3 minutos
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;

      const result = await DatabaseService.getInstallmentPlans(userId);

      if (result?.error) {
        console.error('Erro ao buscar planos de parcelamento:', result.error);
        return next(
          createError(
            `Erro ao buscar planos de parcelamento: ${result.error.message || JSON.stringify(result.error)}`,
            500,
          ),
        );
      }

      const transactions = result?.data || [];
      const today = new Date();

      // Processar cada plano de parcelamento (accept normalized plans or raw transactions)
      const installmentPlans = transactions.map((transaction: any) => {
        if (transaction && transaction.totalAmount !== undefined) {
          // Already normalized by DatabaseService
          return transaction;
        }

        const startDateObj = new Date(
          transaction.transaction_date || transaction.start_date,
        );
        const totalInstallments = transaction.total_installments || 1;
        const installmentsDataPlan = parseInstallments(
          transaction.installments,
        );
        const paidInstallments =
          installmentsDataPlan?.paidInstallments ??
          (transaction.installment_number && transaction.installment_number > 0
            ? transaction.installment_number - 1
            : 0);

        const remainingInstallments = Math.max(
          0,
          totalInstallments - paidInstallments,
        );
        const installmentAmount = transaction.amount / totalInstallments;

        // Calcular status (simplified)
        let status = 'ativo';
        if (paidInstallments >= totalInstallments) {
          status = 'concluído';
        } else {
          const expectedPaidByNow = Math.floor(
            (today.getTime() - startDateObj.getTime()) /
              (30 * 24 * 60 * 60 * 1000),
          );
          if (expectedPaidByNow > paidInstallments) status = 'atrasado';
        }

        return {
          id: transaction.id,
          description: transaction.description,
          totalAmount: transaction.amount,
          installmentAmount,
          totalInstallments,
          paidInstallments,
          remainingInstallments,
          startDate: transaction.transaction_date || transaction.start_date,
          status,
          type: transaction.type,
          category_id: transaction.category_id,
        };
      });

      res.json({ installmentPlans });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

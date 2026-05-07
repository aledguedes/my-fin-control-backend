import express from 'express';
import { DatabaseService } from '../services/databaseService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import {
  transactionSchema,
  financialCategorySchema,
  monthlyViewQuerySchema,
  updatePaymentSchema,
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
  normalizeTransactionPayload,
  validateRequest(transactionSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const idParam = req.params['id'];

      if (!idParam) {
        return next(createError('ID da transação é obrigatório', 400));
      }

      let id: string = idParam as string;

      // Trata IDs virtuais de parcelas (ex: uuid_inst_1)
      if (id.includes('_inst_')) {
        id = id.split('_inst_')[0]!;
      }

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

      // Extrair informações do objeto installments se existirem
      const totalInstallments = installments?.total_installments || 1;
      const startDate = installments?.start_date || transaction_date;
      const paidInstallments = installments?.paid_installments ?? 0;
      const installmentNumber = req.body.installment_number || 1;

      const result = await DatabaseService.updateFinancialTransaction(
        id,
        userId,
        {
          description,
          amount,
          type,
          category_id,
          transaction_date,
          installment_number: installmentNumber,
          total_installments: totalInstallments,
          paid_installments: paidInstallments,
          start_date: startDate,
          is_installment,
          is_recurrent,
          recurrence_start_date,
          payment_method,
          installments, // Passa o objeto completo para o DatabaseService
          update_scope: req.body.update_scope,
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
      const idParam = req.params['id'];

      if (!idParam) {
        return next(createError('ID da transação é obrigatório', 400));
      }

      let id: string = idParam as string;

      // Trata IDs virtuais de parcelas (ex: uuid_inst_1)
      if (id.includes('_inst_')) {
        id = id.split('_inst_')[0]!;
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

// Função auxiliar para buscar o valor correto no histórico baseado na data
function getAmountFromHistory(
  history: any[],
  targetDate: Date,
  defaultAmount: number,
): number {
  if (!history || history.length === 0) return defaultAmount;
  // O histórico vem ordenado por data decrescente (do mais recente para o mais antigo)
  const validEntry = history.find(
    (h) => !isBefore(targetDate, parseISO(h.effective_date)),
  );
  return validEntry ? parseFloat(validEntry.amount) : defaultAmount;
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
      const { year: qYear, month: qMonth, showHidden: qShowHidden } = req.query;

      // Converte para boolean de forma robusta e sem erros de tipo
      const showHidden =
        qShowHidden !== undefined && String(qShowHidden) === 'true';

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

      // Identifica transações que são "exceções" (filhas) para este mês
      // Elas substituirão a projeção do "pai"
      const currentMonthOverrides = transactions
        .filter((tx: any) => tx.parent_transaction_id)
        .map((tx: any) => tx.parent_transaction_id);

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
              const paidCount =
                tx.paid_installments || installmentsData?.paidInstallments || 0;
              const isPaid = i <= paidCount;
              const today = new Date();
              today.setHours(0, 0, 0, 0);

              let status = 'upcoming';
              if (isPaid) {
                status = 'paid';
              } else if (isBefore(due, today)) {
                status = 'overdue';
              }

              // Lógica de Exclusão para Parcelas
              const excludedMonths = tx.excluded_months || [];
              const currentMonthKey = `${year}-${month.toString().padStart(2, '0')}`;
              const isExcluded = excludedMonths.includes(currentMonthKey);

              if (isExcluded && !showHidden) {
                continue; // Pula esta parcela se estiver oculta e não pedimos para mostrar
              }

              // Se este mês já tem uma transação real/exceção para este pai, pula a projeção da parcela
              if (currentMonthOverrides.includes(tx.id)) {
                continue;
              }

              monthlyView.push({
                id: `${tx.id}_inst_${i}`,
                parent_id: tx.id,
                description: tx.description,
                amount: (tx.amount || 0) / totalInstallments,
                type: tx.type,
                date: due.toISOString().split('T')[0],
                installment_number: i,
                total_installments: totalInstallments,
                category_id: tx.category_id,
                isInstallment: true,
                status: status.toUpperCase(), // Retorna em inglês (PAID, OVERDUE, UPCOMING)
                isHidden: isExcluded,
                isVirtual: true,
              });
            }
          }
          return;
        } // --- Lógica para Transações Recorrentes (Geração de Entrada Virtual) ---

        const isRecurrent = tx.is_recurrent === 1 || tx.is_recurrent === true;
        if (isRecurrent) {
          const installmentsDataRecurrent = parseInstallments(tx.installments);

          // Tenta pegar a data de início de vários campos possíveis
          let recurrenceStart =
            tx.recurrence_start_date ||
            tx.start_date ||
            tx.transaction_date ||
            installmentsDataRecurrent?.startDate ||
            null;

          if (!recurrenceStart) return;
          const start = parseISO(recurrenceStart as string);

          // Cria a data de ocorrência para o mês/ano consultado
          const occurrence = new Date(year, month - 1, getDate(start));

          if (isBefore(occurrence, start)) return;

          // Lógica de Exclusão (Pular meses específicos ou marcar como ocultos)
          const excludedMonths = tx.excluded_months || [];
          const currentMonthKey = `${year}-${month.toString().padStart(2, '0')}`;
          const isExcluded = excludedMonths.includes(currentMonthKey);

          if (isExcluded && !showHidden) {
            return; // Se estiver excluído e não pedimos para mostrar, pula
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          // Lógica de "Contador de Meses" para Recorrentes:
          // Calculamos quantos meses se passaram desde o início da recorrência até o mês visualizado
          const monthDiff =
            (year - start.getFullYear()) * 12 +
            (month - 1 - start.getMonth()) +
            1;

          const paidCount = tx.paid_installments || 0;
          const isPaid = paidCount >= monthDiff;

          let status = 'UPCOMING';
          if (isPaid) {
            status = 'PAID';
          } else if (isBefore(occurrence, today)) {
            status = 'OVERDUE';
          }

          // Se este mês já tem uma transação real/exceção para este pai, pula a projeção
          if (currentMonthOverrides.includes(tx.id)) {
            return;
          }

          // Busca o valor vigente no histórico para este mês
          const effectiveAmount = getAmountFromHistory(
            tx.value_history,
            occurrence,
            tx.amount,
          );

          monthlyView.push({
            id: tx.id,
            description: tx.description,
            amount: effectiveAmount,
            type: tx.type,
            date: occurrence.toISOString().split('T')[0],
            category_id: tx.category_id,
            isRecurrent: true,
            status: status,
            installment_number: monthDiff, // Enviamos o "mês" da recorrência para o front usar no PATCH
            paid_installments: paidCount,
            isHidden: isExcluded,
            isVirtual: true,
            hasHistory: tx.value_history && tx.value_history.length > 1,
          });
          return;
        }

        const txDate = tx.transaction_date || tx.date;
        if (txDate) {
          const parsed = parseISO(txDate);
          if (
            parsed.getFullYear() === year &&
            parsed.getMonth() + 1 === month
          ) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Lógica MANUAL para contas únicas: paid_installments >= 1 significa PAGA
            const isPaid = (tx.paid_installments || 0) >= 1;

            let status = 'UPCOMING';
            if (isPaid) {
              status = 'PAID';
            } else if (isBefore(parsed, today)) {
              status = 'OVERDUE';
            }

            // Lógica de Exclusão para Transações Únicas
            const excludedMonths = tx.excluded_months || [];
            const currentMonthKey = `${year}-${month.toString().padStart(2, '0')}`;
            const isExcluded = excludedMonths.includes(currentMonthKey);

            if (isExcluded && !showHidden) {
              return; // Pula se estiver oculta
            }

            monthlyView.push({
              id: tx.id,
              description: tx.description,
              amount: tx.amount,
              type: tx.type,
              date: txDate,
              category_id: tx.category_id,
              isInstallment: false,
              status: status,
              paid_installments: tx.paid_installments || 0,
              isHidden: isExcluded,
              isException: !!tx.parent_transaction_id,
            });
          }
        }
      }); // --- NOVO: Cálculo do Sumário Consolidado ---

      let totalRevenue = 0;
      let totalExpense = 0;

      monthlyView.forEach((item) => {
        // Ignora itens ocultos do cálculo do sumário
        if (item.isHidden) return;

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
        monthlyView: monthlyView,
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

        // Calcular status baseado em datas e parcelas pagas
        let status = 'UPCOMING';
        if (paidInstallments >= totalInstallments) {
          status = 'PAID';
        } else {
          // Verifica se a próxima parcela a ser paga está atrasada
          const nextInstallmentDate = addMonths(startDateObj, paidInstallments);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (isBefore(nextInstallmentDate, today)) {
            status = 'OVERDUE';
          }
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

// Atualizar status de pagamento (parcelas pagas)
router.patch(
  '/transactions/:id/payment',
  authenticateToken,
  invalidateCache,
  validateRequest(updatePaymentSchema),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      if (!id) {
        return next(createError('ID da transação é obrigatório', 400));
      }

      const { paid_installments } = req.body;

      let transactionId: string = id as string;
      // Se vier um ID virtual (id_inst_1), extraímos o ID real
      if (transactionId.includes('_inst_')) {
        transactionId = transactionId.split('_inst_')[0]!;
      }

      const result = await DatabaseService.updatePaymentStatus(
        transactionId,
        userId,
        paid_installments,
      );

      if (result?.error) {
        return next(createError('Erro ao atualizar status de pagamento', 500));
      }

      res.json({
        message: 'Status de pagamento atualizado com sucesso',
        transaction: result.data,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Alternar exclusão de mês para múltiplas transações (Batch)
router.patch(
  '/transactions/batch/exclude',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const updates = req.body; // Espera o array [{id, month, action}, ...]

      if (!Array.isArray(updates)) {
        return next(
          createError('O corpo da requisição deve ser um array', 400),
        );
      }

      const results = [];

      for (const item of updates) {
        const { id, month, action } = item;

        if (!id || !month) continue;

        const txResult = await DatabaseService.getFinancialTransactions(
          userId,
          { id },
        );
        const tx = txResult.data?.[0];

        if (tx) {
          let excludedMonths = tx.excluded_months || [];
          const monthsToProcess = Array.isArray(month) ? month : [month];

          if (action === 'add') {
            monthsToProcess.forEach((m: string) => {
              if (!excludedMonths.includes(m)) excludedMonths.push(m);
            });
          } else {
            excludedMonths = excludedMonths.filter(
              (m: string) => !monthsToProcess.includes(m),
            );
          }

          await DatabaseService.updateFinancialTransaction(id, userId, {
            excluded_months: excludedMonths,
          });
          results.push({ id, status: 'success' });
        } else {
          results.push({ id, status: 'not_found' });
        }
      }

      res.json({ message: 'Processamento em lote concluído', results });
    } catch (error) {
      next(error);
    }
  },
);

// Alternar exclusão de mês para recorrentes
router.patch(
  '/transactions/:id/exclude',
  authenticateToken,
  invalidateCache,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;
      const { month, action } = req.body; // action: 'add' ou 'remove'

      if (!id || !month) {
        return next(createError('ID e mês são obrigatórios', 400));
      }

      // Busca a transação atual
      const txResult = await DatabaseService.getFinancialTransactions(userId, {
        id,
      });
      const tx = txResult.data?.[0];

      if (!tx) {
        return next(createError('Transação não encontrada', 404));
      }

      let excludedMonths = tx.excluded_months || [];
      const monthsToProcess = Array.isArray(month) ? month : [month];

      if (action === 'add') {
        monthsToProcess.forEach((m: string) => {
          if (!excludedMonths.includes(m)) {
            excludedMonths.push(m);
          }
        });
      } else {
        excludedMonths = excludedMonths.filter(
          (m: string) => !monthsToProcess.includes(m),
        );
      }

      // Atualiza o banco
      const result = await DatabaseService.updateFinancialTransaction(
        id,
        userId,
        {
          excluded_months: excludedMonths,
        },
      );

      if (result.error) {
        return next(createError('Erro ao atualizar exclusões', 500));
      }

      res.json({
        message:
          action === 'add'
            ? 'Mês removido da recorrência'
            : 'Mês restaurado na recorrência',
        excluded_months: excludedMonths,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

import { databaseManager } from '../config/database';
import {
  parseISO,
  differenceInMonths,
  isBefore,
  isAfter,
  addMonths,
} from 'date-fns';

const db = databaseManager.getDatabase();
const dbConfig = databaseManager.getConfig();

/**
 * Normaliza o nome do produto para comparação:
 * - Remove acentos
 * - Converte para minúsculas
 * - Remove espaços extras e faz trim
 */
function normalizeProductName(name: string): string {
  if (!name) return '';

  // Remove acentos
  const withoutAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Converte para minúsculas, remove espaços extras e faz trim
  return withoutAccents.toLowerCase().trim().replace(/\s+/g, ' ');
}

export class DatabaseService {
  // Métodos genéricos para Supabase
  private static async querySupabase(
    table: string,
    operation: string,
    data?: any,
    filters?: any,
  ) {
    // Agora sempre assumimos Supabase
    let query = db.from(table);

    switch (operation) {
      case 'select':
        query = query.select('*');
        if (filters) {
          Object.keys(filters).forEach((key) => {
            query = query.eq(key, filters[key]);
          });
        }
        break;
      case 'insert':
        query = query.insert(data);
        break;
      case 'update':
        query = query.update(data);
        if (filters) {
          Object.keys(filters).forEach((key) => {
            query = query.eq(key, filters[key]);
          });
        }
        break;
      case 'delete':
        query = query.delete();
        if (filters) {
          Object.keys(filters).forEach((key) => {
            query = query.eq(key, filters[key]);
          });
        }
        break;
    }

    const result = await query;
    return { data: result.data, error: result.error };
  }

  // Métodos específicos para Users
  static async getUserByEmail(email: string) {
    const result = await db
      .from('tbl_users')
      .select('*')
      .eq('email', email)
      .single();
    return { data: result.data, error: result.error };
  }

  static async createUser(userData: any) {
    // Usa select() no final da query 'insert' para retornar o objeto criado, se configurado assim no helper,
    // mas o helper genérico usa o padrão do supabase que retorna vazio por padrão se não chamar select().
    // A chamada direta abaixo é mais segura para garantir o retorno.
    const result = await db
      .from('tbl_users')
      .insert(userData)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async getUserById(id: string | number) {
    return await this.querySupabase('tbl_users', 'select', null, { id });
  }

  // Métodos para Financial Categories
  static async getFinancialCategories(userId: string | number) {
    const result = await db
      .from('tbl_financial_categories')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    return { data: result.data, error: result.error };
  }

  static async createFinancialCategory(categoryData: any) {
    const result = await db
      .from('tbl_financial_categories')
      .insert(categoryData)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async getFinancialTransactions(
    userId: string | number,
    filters?: any,
  ) {
    let query = db.from('tbl_transactions').select('*').eq('user_id', userId);

    if (filters?.start_date)
      query = query.gte('transaction_date', filters.start_date);
    if (filters?.end_date)
      query = query.lte('transaction_date', filters.end_date);
    if (filters?.category_id)
      query = query.eq('category_id', filters.category_id);
    if (filters?.id) query = query.eq('id', filters.id);

    const result = await query;
    return { data: result.data, error: result.error };
  }

  static async createFinancialTransaction(transactionData: any) {
    const {
      description,
      amount,
      type,
      category_id,
      user_id,
      transaction_date,
      is_installment = false,
      is_recurrent = false,
      recurrence_start_date,
      total_installments = 1,
      paid_installments = 0,
      start_date,
      payment_method,
    } = transactionData;

    let installments_json = null;

    const installmentsData = {
      totalInstallments: total_installments,
      paidInstallments: paid_installments,
      startDate: start_date,
    };
    installments_json = installmentsData; // JSONB aceita objeto direto

    const dataToInsert = {
      description,
      amount,
      type,
      category_id,
      user_id,
      transaction_date: transaction_date,
      is_installment,
      total_installments,
      installment_number: 1,
      start_date: start_date || transaction_date,
      installments: installments_json,
      is_recurrent,
      recurrence_start_date: recurrence_start_date || null,
      payment_method,
    };

    const result = await this.withRetry(() =>
      db.from('tbl_transactions').insert(dataToInsert).select().single(),
    );

    return { data: result.data, error: result.error };
  }

  static async getFinancialTransactionById(
    id: string | number,
    userId: string | number,
  ) {
    const result = await db
      .from('tbl_transactions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    return {
      data: result.data,
      error: result.error,
    };
  }

  static async updateFinancialTransaction(
    id: string | number,
    userId: string | number,
    transactionData: any,
  ) {
    const updateScope = transactionData.update_scope || 'all';
    const isRecurrent = transactionData.is_recurrent === true;

    // Cenário: Alteração em transação recorrente
    if (isRecurrent && transactionData.amount !== undefined) {
      // 1. Apenas este mês: Cria uma exceção (filha) e oculta este mês no pai
      if (updateScope === 'single') {
        const { data: parent } = await this.getFinancialTransactionById(
          id,
          userId,
        );
        if (!parent) return { data: null, error: { message: 'Pai não encontrado' } };

        // Cria a transação filha
        const childData = {
          ...transactionData,
          user_id: userId,
          parent_transaction_id: id,
          is_recurrent: false, // A filha é uma transação única
        };
        delete childData.update_scope;

        const childResult = await this.createFinancialTransaction(childData);

        // Adiciona o mês atual na lista de excluídos do pai
        const date = parseISO(transactionData.transaction_date);
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, '0')}`;
        const excluded = parent.excluded_months || [];
        if (!excluded.includes(monthKey)) {
          excluded.push(monthKey);
          await db
            .from('tbl_transactions')
            .update({ excluded_months: excluded })
            .eq('id', id);
        }

        return childResult;
      }

      // 2. Deste mês em diante: Adiciona ao histórico de valores
      if (updateScope === 'future') {
        await this.updateRecurrenceValue(
          id as string,
          transactionData.amount,
          transactionData.transaction_date,
        );
        // Opcional: Atualiza outros campos (descrição, categoria) no pai
      }
    }

    // Mapeia os campos do camelCase do JS para o snake_case do Postgres/Supabase
    const updateData: any = {};

    if (transactionData.description !== undefined)
      updateData.description = transactionData.description;
    if (transactionData.amount !== undefined)
      updateData.amount = transactionData.amount;
    if (transactionData.type !== undefined)
      updateData.type = transactionData.type;
    if (transactionData.category_id !== undefined)
      updateData.category_id = transactionData.category_id;
    if (transactionData.transaction_date !== undefined)
      updateData.transaction_date = transactionData.transaction_date;
    if (transactionData.installment_number !== undefined)
      updateData.installment_number = transactionData.installment_number;
    if (transactionData.total_installments !== undefined)
      updateData.total_installments = transactionData.total_installments;
    if (transactionData.is_recurrent !== undefined)
      updateData.is_recurrent = transactionData.is_recurrent;
    if (transactionData.is_installment !== undefined)
      updateData.is_installment = transactionData.is_installment;
    if (transactionData.recurrence_start_date !== undefined)
      updateData.recurrence_start_date = transactionData.recurrence_start_date;
    if (transactionData.start_date !== undefined)
      updateData.start_date = transactionData.start_date;
    if (transactionData.payment_method !== undefined)
      updateData.payment_method = transactionData.payment_method;
    if (transactionData.installments !== undefined) {
      const inst = transactionData.installments;
      updateData.installments = {
        totalInstallments:
          inst.total_installments || transactionData.total_installments,
        paidInstallments:
          inst.paid_installments !== undefined
            ? inst.paid_installments
            : transactionData.paid_installments,
        startDate: inst.start_date || transactionData.start_date,
      };
    }
    if (transactionData.paid_installments !== undefined)
      updateData.paid_installments = transactionData.paid_installments;
    if (transactionData.excluded_months !== undefined)
      updateData.excluded_months = transactionData.excluded_months;

    // Se houver transaction_date mas não start_date nas transações únicas, sincroniza
    if (updateData.transaction_date && updateData.start_date === undefined) {
      updateData.start_date = updateData.transaction_date;
    }

    const result = await this.withRetry(() =>
      db
        .from('tbl_transactions')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single(),
    );

    return { data: result.data, error: result.error };
  }

  static async deleteFinancialTransaction(
    id: string | number,
    userId: string | number,
  ) {
    // 1. Busca a transação para saber se é recorrência ou exceção
    const { data: tx } = await this.getFinancialTransactionById(id, userId);
    if (!tx) return { data: null, error: { message: 'Transação não encontrada' } };

    // 2. Se for uma exceção (filha), removemos o mês da lista de 'excluded_months' do pai
    if (tx.parent_transaction_id) {
      const { data: parent } = await this.getFinancialTransactionById(tx.parent_transaction_id, userId);
      if (parent) {
        const date = parseISO(tx.transaction_date);
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        const excluded = parent.excluded_months || [];
        const newExcluded = excluded.filter((m: string) => m !== monthKey);
        
        if (newExcluded.length !== excluded.length) {
          await db.from('tbl_transactions').update({ excluded_months: newExcluded }).eq('id', parent.id);
        }
      }
    }

    // 3. Se for uma recorrência mestre, fazemos Deleção Suave (Soft Delete)
    if (tx.is_recurrent && !tx.parent_transaction_id) {
      // Define a data de fim como o dia anterior à transação atual ou hoje
      // Isso faz com que ela pare de ser projetada para o futuro
      const result = await db
        .from('tbl_transactions')
        .update({ end_date: tx.transaction_date })
        .eq('id', id);
      
      return { data: { success: !result.error, softDeleted: true }, error: result.error };
    }

    // 4. Deleção física para transações únicas ou parcelas
    const result = await db
      .from('tbl_transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    
    return { data: { success: !result.error }, error: result.error };
  }

  /**
   * Adiciona um novo valor ao histórico de uma transação recorrente
   */
  static async updateRecurrenceValue(
    transactionId: string,
    amount: number,
    effectiveDate: string,
  ) {
    const result = await db
      .from('tbl_transaction_value_history')
      .insert({
        transaction_id: transactionId,
        amount,
        effective_date: effectiveDate,
      })
      .select()
      .single();

    return { data: result.data, error: result.error };
  }

  /**
   * Busca o histórico de valores para um conjunto de transações
   */
  static async getTransactionsValueHistory(transactionIds: string[]) {
    if (!transactionIds.length) return { data: [], error: null };
    const result = await db
      .from('tbl_transaction_value_history')
      .select('*')
      .in('transaction_id', transactionIds)
      .order('effective_date', { ascending: false });

    return { data: result.data, error: result.error };
  }

  static async getMonthlyTransactions(
    userId: string | number,
    year: number,
    month: number,
  ) {
    const monthStr = month.toString().padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;

    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${monthStr}-${lastDay}`;

    // 1. Busca todas as transações (reais e recorrentes)
    const result = await db
      .from('tbl_transactions')
      .select('*')
      .eq('user_id', userId)
      .or(
        // Transações únicas no mês
        `and(is_installment.eq.false,is_recurrent.eq.false,transaction_date.gte.${startDate},transaction_date.lte.${endDate}),` +
          // Transações recorrentes: busca se começaram antes ou durante o mês e não "terminaram" antes
          `and(is_recurrent.eq.true,or(recurrence_start_date.lte.${endDate},start_date.lte.${endDate},transaction_date.lte.${endDate}),or(end_date.is.null,end_date.gte.${startDate})),` +
          // Parcelamentos: busca todos os parcelamentos ativos
          `is_installment.eq.true`,
      )
      .order('transaction_date', { ascending: true });

    if (result.error) return { data: null, error: result.error };

    // 2. Busca o histórico de valores para as transações retornadas
    const transactionIds = (result.data || []).map((tx: any) => tx.id);
    const historyResult = await this.getTransactionsValueHistory(transactionIds);

    // 3. Acopla o histórico de valores nos objetos de transação para processamento posterior
    const transactionsWithHistory = (result.data || []).map((tx: any) => {
      const history = (historyResult.data || []).filter(
        (h: any) => h.transaction_id === tx.id,
      );
      return { ...tx, value_history: history };
    });

    return { data: transactionsWithHistory, error: null };
  }

  /**
   * Helper para executar operações no banco com re-tentativa em caso de erro de conexão (fetch failed)
   */
  private static async withRetry<T>(
    operation: () => Promise<T>,
    retries = 3,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        const errorMsg = error?.message || '';
        const isFetchError =
          errorMsg.includes('fetch failed') ||
          (error.cause && String(error.cause).includes('fetch failed'));

        if (isFetchError && i < retries - 1) {
          console.warn(
            `[DatabaseService] Tentativa ${i + 1} falhou devido a erro de conexão (fetch failed). Tentando novamente em ${i + 1}s...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Falha de conexão com o banco após múltiplas tentativas.');
  }

  static async getInstallmentPlans(userId: string | number) {
    try {
      const result = await this.withRetry(() =>
        db
          .from('tbl_transactions')
          .select('*')
          .eq('user_id', userId)
          .gt('total_installments', 1)
          .order('transaction_date', { ascending: true }),
      );

      if (result.error) {
        console.error('Erro na query getInstallmentPlans:', result.error);
        return { data: null, error: result.error };
      }

      // Processamento similar ao que existia para garantir formato consistente se necessário
      // No Supabase, o JSON já vem parseado em 'installments'
      const plans = (result.data || []).map((tx: any) => {
        const installments = tx.installments;
        const totalInstallments =
          tx.total_installments || installments?.totalInstallments || 1;

        const startDateStr =
          installments?.startDate || tx.start_date || tx.transaction_date;

        // --- Lógica MANUAL: Usa o valor gravado no banco ou fallback para o que já existia ---
        let paidInstallments = tx.paid_installments ?? 0;

        // Fallback caso o banco esteja com valor legado (opcional, mas bom para transição)
        if (
          paidInstallments === 0 &&
          installments?.paidInstallments !== undefined
        ) {
          paidInstallments = installments.paidInstallments;
        }

        const installmentAmount = tx.amount / totalInstallments;

        // Calcular status dinâmico baseado na data atual e parcelas pagas
        let status = 'UPCOMING';
        if (paidInstallments >= totalInstallments) {
          status = 'PAID';
        } else if (startDateStr) {
          const startDate = parseISO(startDateStr);
          // Verifica se a PRÓXIMA parcela a ser paga (índice = paidInstallments) está atrasada
          const nextInstallmentDate = addMonths(startDate, paidInstallments);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (isBefore(nextInstallmentDate, today)) {
            status = 'OVERDUE';
          }
        }

        return {
          id: tx.id,
          description: tx.description,
          totalAmount: tx.amount,
          installmentAmount,
          totalInstallments,
          paidInstallments,
          remainingInstallments: Math.max(
            0,
            totalInstallments - paidInstallments,
          ),
          startDate: startDateStr,
          status,
          type: tx.type,
          category_id: tx.category_id,
        };
      });

      return { data: plans, error: null };
    } catch (error: any) {
      console.error('Erro em getInstallmentPlans:', error);
      return {
        data: null,
        error: {
          message:
            error.message ||
            'Erro desconhecido ao buscar planos de parcelamento',
          details: error,
        },
      };
    }
  }

  static async getShoppingLists(userId: string | number) {
    const result = await db
      .from('tbl_shopping_lists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }); // Usar created_at pois updated_at não existe na tabela
    return { data: result.data, error: result.error };
  }

  static async getShoppingListById(
    id: string | number,
    userId: string | number,
  ) {
    const result = await db
      .from('tbl_shopping_lists')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    return { data: result.data, error: result.error };
  }

  static async getShoppingListWithItems(
    id: string | number,
    userId: string | number,
  ) {
    // Busca a lista
    const listResult = await db
      .from('tbl_shopping_lists')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (listResult.error) {
      return { data: null, error: listResult.error };
    }

    // Busca os itens com detalhes do produto
    const itemsResult = await db
      .from('tbl_shopping_list_items')
      .select(
        `
        *,
        tbl_products (
          name,
          category_id,
          tbl_shopping_categories (
            name
          )
        )
      `,
      )
      .eq('shopping_list_id', id);

    // Transforma a estrutura para ficar compatível com o frontend se necessário
    // O frontend espera items com product_name e category_name planos?
    // Olhando o original SQLite: "SELECT si.*, p.name as product_name, sc.name as category_name"
    // Vamos mapear para manter compatibilidade
    const items = (itemsResult.data || []).map((item: any) => ({
      ...item,
      product_name: item.tbl_products?.name,
      category_name: item.tbl_products?.tbl_shopping_categories?.name,
    }));

    return {
      data: {
        ...listResult.data,
        items,
      },
      error: itemsResult.error,
    };
  }

  static async deleteShoppingList(
    id: string | number,
    userId: string | number,
  ) {
    // 1. Verificar se a lista existe e obter informações
    const listResult = await db
      .from('tbl_shopping_lists')
      .select('name, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!listResult.data) {
      return {
        data: null,
        error: { message: 'Lista não encontrada' },
      };
    }

    const listName = listResult.data.name;
    const listStatus = listResult.data.status;

    // 2. Se a lista estiver completada, remover a transação relacionada
    if (listStatus === 'completed') {
      const description = `Compras: ${listName || 'Lista'}`;

      // Buscar e deletar a transação relacionada
      const transactionResult = await db
        .from('tbl_transactions')
        .delete()
        .eq('description', description)
        .eq('user_id', userId)
        .eq('type', 'expense');

      if (transactionResult.error) {
        console.error(
          'Erro ao deletar transação relacionada:',
          transactionResult.error,
        );
        // Continua mesmo se houver erro ao deletar a transação
      }
    }

    // 3. Deletar a lista
    const result = await db
      .from('tbl_shopping_lists')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    console.log('deleteShoppingList result:', result);
    return { data: { success: !result.error }, error: result.error };
  }

  /**
   * Remove transações órfãs (transações de listas de compras que foram deletadas)
   */
  static async cleanupOrphanedShoppingTransactions(userId: string | number) {
    try {
      console.log('Iniciando limpeza de transações órfãs para userId:', userId);

      // 1. Buscar todas as transações do tipo expense do usuário
      // Vamos buscar todas e filtrar por descrição em JavaScript para evitar problemas com .like()
      const transactionsResult = await db
        .from('tbl_transactions')
        .select('id, description')
        .eq('user_id', userId)
        .eq('type', 'expense');

      if (transactionsResult.error) {
        console.error('Erro ao buscar transações:', transactionsResult.error);
        return {
          data: null,
          error: {
            message: 'Erro ao buscar transações',
            details: transactionsResult.error,
          },
        };
      }

      // Filtrar apenas transações que começam com "Compras:"
      const transactions = (transactionsResult.data || []).filter((tx: any) =>
        tx.description?.startsWith('Compras:'),
      );

      console.log(
        `Encontradas ${transactions.length} transação(ões) de compras`,
      );

      if (transactions.length === 0) {
        return {
          data: {
            deletedCount: 0,
            message: 'Nenhuma transação de compras encontrada',
          },
          error: null,
        };
      }

      // 2. Buscar todas as listas de compras do usuário (não apenas completadas,
      // pois uma lista pode ter sido deletada após ser completada)
      const listsResult = await db
        .from('tbl_shopping_lists')
        .select('name')
        .eq('user_id', userId);

      if (listsResult.error) {
        console.error('Erro ao buscar listas:', listsResult.error);
        return {
          data: null,
          error: {
            message: 'Erro ao buscar listas de compras',
            details: listsResult.error,
          },
        };
      }

      const existingLists = (listsResult.data || []).map(
        (list: any) => list.name,
      );
      console.log(
        `Encontradas ${existingLists.length} lista(s) de compras existente(s)`,
      );

      // 3. Normalizar nomes das listas para comparação (lowercase, trim, remover espaços extras)
      const normalizeName = (name: string) => {
        return name.toLowerCase().trim().replace(/\s+/g, ' '); // Remove espaços múltiplos
      };

      const normalizedExistingLists = existingLists.map(normalizeName);
      console.log('Listas existentes normalizadas:', normalizedExistingLists);

      // 4. Identificar transações órfãs
      const orphanedTransactions: string[] = [];

      for (const transaction of transactions) {
        // Extrair o nome da lista da descrição (formato: "Compras: Nome da Lista")
        const listName = transaction.description
          .replace(/^Compras:\s*/i, '') // Case-insensitive
          .trim();

        const normalizedListName = normalizeName(listName);

        console.log(
          `Verificando transação: "${transaction.description}" -> Nome extraído: "${listName}" -> Normalizado: "${normalizedListName}"`,
        );

        // Se não encontrar uma lista correspondente (comparação normalizada), é uma transação órfã
        if (!normalizedExistingLists.includes(normalizedListName)) {
          orphanedTransactions.push(transaction.id);
          console.log(
            `✓ Transação órfã encontrada: ID=${transaction.id}, Descrição="${transaction.description}", Nome extraído="${listName}"`,
          );
        } else {
          console.log(
            `✓ Transação válida (lista encontrada): ID=${transaction.id}, Descrição="${transaction.description}"`,
          );
        }
      }

      if (orphanedTransactions.length === 0) {
        return {
          data: {
            deletedCount: 0,
            message: 'Nenhuma transação órfã encontrada',
          },
          error: null,
        };
      }

      console.log(
        `Preparando para deletar ${orphanedTransactions.length} transação(ões) órfã(s)`,
      );
      console.log('IDs das transações órfãs:', orphanedTransactions);

      // 5. Deletar transações órfãs uma por uma para garantir que funcione
      let deletedCount = 0;
      const errors: any[] = [];

      for (const transactionId of orphanedTransactions) {
        const deleteResult = await db
          .from('tbl_transactions')
          .delete()
          .eq('id', transactionId)
          .eq('user_id', userId);

        if (deleteResult.error) {
          console.error(
            `Erro ao deletar transação ${transactionId}:`,
            deleteResult.error,
          );
          errors.push({ id: transactionId, error: deleteResult.error });
        } else {
          deletedCount++;
        }
      }

      if (errors.length > 0 && deletedCount === 0) {
        return {
          data: null,
          error: {
            message: 'Erro ao deletar transações órfãs',
            details: errors,
          },
        };
      }

      const message =
        errors.length > 0
          ? `${deletedCount} transação(ões) removida(s), ${errors.length} erro(s)`
          : `${deletedCount} transação(ões) órfã(s) removida(s) com sucesso`;

      console.log('Limpeza concluída:', message);

      return {
        data: {
          deletedCount,
          errors: errors.length > 0 ? errors : undefined,
          message,
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Erro em cleanupOrphanedShoppingTransactions:', error);
      return {
        data: null,
        error: {
          message: 'Erro ao limpar transações órfãs',
          details: error.message || error,
        },
      };
    }
  }

  /**
   * Deleta uma transação específica de compras por ID
   * Útil para remover transações órfãs específicas manualmente
   */
  static async deleteShoppingTransaction(
    transactionId: string | number,
    userId: string | number,
  ) {
    try {
      // Verificar se a transação existe e é do tipo expense com descrição "Compras:"
      const transactionResult = await db
        .from('tbl_transactions')
        .select('id, description, type')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .single();

      if (transactionResult.error || !transactionResult.data) {
        return {
          data: null,
          error: {
            message: 'Transação não encontrada',
            details: transactionResult.error,
          },
        };
      }

      const transaction = transactionResult.data;

      // Verificar se é uma transação de compras
      if (
        transaction.type !== 'expense' ||
        !transaction.description?.startsWith('Compras:')
      ) {
        return {
          data: null,
          error: {
            message: 'Esta transação não é uma transação de compras válida',
          },
        };
      }

      // Deletar a transação
      const deleteResult = await db
        .from('tbl_transactions')
        .delete()
        .eq('id', transactionId)
        .eq('user_id', userId);

      if (deleteResult.error) {
        return {
          data: null,
          error: {
            message: 'Erro ao deletar transação',
            details: deleteResult.error,
          },
        };
      }

      return {
        data: {
          success: true,
          message: 'Transação de compras deletada com sucesso',
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Erro em deleteShoppingTransaction:', error);
      return {
        data: null,
        error: {
          message: 'Erro ao deletar transação de compras',
          details: error.message || error,
        },
      };
    }
  }

  static async completeShoppingList(
    id: string | number,
    userId: string | number,
    listPayload: any,
  ) {
    // 1. Verificar lista
    const listResult = await db
      .from('tbl_shopping_lists')
      .select('name')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!listResult.data) {
      return { data: null, error: { message: 'Lista não encontrada' } };
    }
    const listName = listResult.data.name;

    // 2. Atualizar itens se fornecidos
    if (listPayload && Array.isArray(listPayload.items)) {
      // Como update em lote não é trivial sem RPC, vamos iterar (ou usar upsert se tivéssemos todos os campos)
      // Iterar é seguro para pouca quantidade.
      for (const item of listPayload.items) {
        await db
          .from('tbl_shopping_list_items')
          .update({
            quantity: item.quantity,
            price: item.price,
            checked: item.checked,
          })
          .eq('id', item.id)
          .eq('shopping_list_id', id);
      }
    }

    // 3. Recalcular total (fazendo query dos itens atualizados)
    const itemsResult = await db
      .from('tbl_shopping_list_items')
      .select('quantity, price')
      .eq('shopping_list_id', id);

    if (itemsResult.error) {
      return {
        data: null,
        error: { message: 'Erro ao buscar itens da lista para cálculo.' },
      };
    }

    const items = itemsResult.data || [];
    const totalAmount = items.reduce((sum: number, item: any) => {
      const q = Number(item.quantity) || 0;
      const p = Number(item.price) || 0;
      return sum + q * p;
    }, 0);

    const completedAt = new Date().toISOString().split('T')[0];

    // 4. Atualizar lista com status completed
    await db
      .from('tbl_shopping_lists')
      .update({
        status: 'completed',
        completed_at: completedAt,
        total_amount: totalAmount,
      })
      .eq('id', id)
      .eq('user_id', userId);

    // 5. Retornar lista atualizada
    const finalResult = await db
      .from('tbl_shopping_lists')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    return {
      data: {
        ...finalResult.data,
        totalAmount,
        listName,
        completedAt,
      },
      error: null,
    };
  }

  static async getShoppingItems(listId: string | number) {
    const result = await db
      .from('tbl_shopping_list_items')
      .select(
        `*, 
        tbl_products(name, category_id), 
        category:tbl_products(tbl_shopping_categories(name))
      `,
      )
      .eq('shopping_list_id', listId);

    // Ajuste para compatibilidade (sugerido no código original)
    // O front pode esperar product_name solto ou o objeto relations
    return { data: result.data, error: result.error };
  }

  static async createShoppingItem(itemData: any) {
    console.log('createShoppingItem itemData:', itemData);
    const result = await db
      .from('tbl_shopping_list_items')
      .insert(itemData)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async updateShoppingItem(
    itemId: string | number,
    listId: string | number,
    userId: string | number,
    itemData: any,
  ) {
    const result = await db
      .from('tbl_shopping_list_items')
      .update(itemData)
      .eq('id', itemId)
      .eq('shopping_list_id', listId) // Garante que pertence à lista
      .select()
      .single();

    return { data: result.data, error: result.error };
  }

  static async deleteShoppingItem(
    itemId: string | number,
    listId: string | number,
    userId: string | number,
  ) {
    const result = await db
      .from('tbl_shopping_list_items')
      .delete()
      .eq('id', itemId)
      .eq('shopping_list_id', listId);

    return { data: { success: !result.error }, error: result.error };
  }

  static async syncShoppingList(
    listId: string | number,
    userId: string | number,
    listData: any,
  ) {
    const { name, items, status } = listData;

    // 1. Verificar propriedade da lista
    const listCheck = await db
      .from('tbl_shopping_lists')
      .select('id')
      .eq('id', listId)
      .eq('user_id', userId)
      .single();

    if (!listCheck.data) {
      return { data: null, error: { message: 'Lista não encontrada' } };
    }

    // 2. Atualizar detalhes da lista
    if (name || status) {
      const updateData: any = {};
      if (name) updateData.name = name;
      if (status) updateData.status = status;

      const updateRes = await db
        .from('tbl_shopping_lists')
        .update(updateData)
        .eq('id', listId);

      if (updateRes.error) {
        return { data: null, error: updateRes.error };
      }
    }

    // 3. Substituir itens (Delete all + insert new)
    // Como não temos transações complexas, vamos fazer sequencialmente

    // Deletar existentes
    const deleteRes = await db
      .from('tbl_shopping_list_items')
      .delete()
      .eq('shopping_list_id', listId);

    if (deleteRes.error) {
      return { data: null, error: deleteRes.error };
    }

    // Inserir novos
    if (items && Array.isArray(items) && items.length > 0) {
      const itemsToInsert = items.map((item: any) => ({
        quantity: item.quantity,
        price: item.price || 0,
        shopping_list_id: listId,
        product_id: item.productId || item.product_id,
        checked: item.checked ? true : false,
      }));

      const insertRes = await db
        .from('tbl_shopping_list_items')
        .insert(itemsToInsert);

      if (insertRes.error) {
        return { data: null, error: insertRes.error };
      }
    }

    // Retornar lista completa
    return await this.getShoppingListWithItems(listId, userId);
  }

  static async addBatchShoppingItems(
    listId: string | number,
    userId: string | number,
    items: any[],
  ) {
    // 1. Verificar propriedade da lista
    const listCheck = await db
      .from('tbl_shopping_lists')
      .select('id')
      .eq('id', listId)
      .eq('user_id', userId)
      .single();

    if (!listCheck.data) {
      return { data: null, error: { message: 'Lista não encontrada' } };
    }

    // 2. Insert items
    const itemsToInsert = items.map((item: any) => ({
      quantity: item.quantity,
      price: item.price || 0,
      shopping_list_id: listId,
      product_id: item.productId || item.product_id,
      checked: item.checked ? true : false,
    }));

    const result = await db
      .from('tbl_shopping_list_items')
      .insert(itemsToInsert)
      .select();

    return { data: { items: result.data }, error: result.error };
  }

  // Métodos para Products
  static async getProducts(userId: string | number) {
    const result = await db
      .from('tbl_products')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    return { data: result.data, error: result.error };
  }

  /**
   * Verifica se já existe um produto com o mesmo nome normalizado para o usuário
   */
  private static async checkProductNameDuplicate(
    name: string,
    userId: string | number,
    excludeId?: string | number,
  ) {
    if (!name) return null;

    // Buscar todos os produtos do usuário
    const result = await db
      .from('tbl_products')
      .select('id, name')
      .eq('user_id', userId);

    if (result.error) {
      return null; // Em caso de erro, retorna null para não bloquear
    }

    const normalizedNewName = normalizeProductName(name);

    // Verificar se algum produto tem o mesmo nome normalizado
    for (const product of result.data || []) {
      // Se estiver atualizando, ignora o próprio produto
      if (excludeId && product.id === excludeId) {
        continue;
      }

      const normalizedExistingName = normalizeProductName(product.name);
      if (normalizedExistingName === normalizedNewName) {
        return product; // Retorna o produto duplicado encontrado
      }
    }

    return null; // Nenhum duplicado encontrado
  }

  static async createProduct(productData: any) {
    const { name, user_id } = productData;

    // Verificar se já existe produto com o mesmo nome normalizado
    const duplicate = await this.checkProductNameDuplicate(name, user_id);
    if (duplicate) {
      return {
        data: null,
        error: {
          message: `Já existe um produto cadastrado com o nome "${duplicate.name}". Produtos com nomes similares (com ou sem acentos, maiúsculas/minúsculas) são considerados iguais.`,
          code: 'DUPLICATE_PRODUCT_NAME',
        },
      };
    }

    const result = await db
      .from('tbl_products')
      .insert(productData)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async getProductById(id: string | number, userId: string | number) {
    const result = await db
      .from('tbl_products')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    return { data: result.data, error: result.error };
  }

  static async updateProduct(
    id: string | number,
    userId: string | number,
    productData: any,
  ) {
    const { name } = productData;

    // Se o nome está sendo atualizado, verificar duplicatas
    if (name) {
      const duplicate = await this.checkProductNameDuplicate(
        name,
        userId,
        id, // Exclui o próprio produto da verificação
      );
      if (duplicate) {
        return {
          data: null,
          error: {
            message: `Já existe um produto cadastrado com o nome "${duplicate.name}". Produtos com nomes similares (com ou sem acentos, maiúsculas/minúsculas) são considerados iguais.`,
            code: 'DUPLICATE_PRODUCT_NAME',
          },
        };
      }
    }

    const result = await db
      .from('tbl_products')
      .update(productData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async checkProductDependencies(id: string | number) {
    const result = await db
      .from('tbl_shopping_list_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id);

    return {
      data: {
        hasDependencies: (result.count || 0) > 0,
        count: result.count || 0,
      },
      error: result.error,
    };
  }

  static async deleteProduct(id: string | number, userId: string | number) {
    // 1. Verificar dependências
    const deps = await this.checkProductDependencies(id);
    if (deps.data?.hasDependencies) {
      return {
        data: null,
        error: {
          message:
            'Não é possível excluir o produto pois ele está sendo usado em listas de compras',
          code: 'DEPENDENCY_ERROR',
        },
      };
    }

    // 2. Deletar
    const result = await db
      .from('tbl_products')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    return { data: { success: !result.error }, error: result.error };
  }

  // Métodos para Shopping Categories
  static async getShoppingCategories(userId: string | number) {
    const result = await db
      .from('tbl_shopping_categories')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    return { data: result.data, error: result.error };
  }

  static async createShoppingCategory(categoryData: any) {
    const result = await db
      .from('tbl_shopping_categories')
      .insert(categoryData)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async getShoppingCategoryById(
    id: string | number,
    userId: string | number,
  ) {
    const result = await db
      .from('tbl_shopping_categories')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    return { data: result.data, error: result.error };
  }

  static async updateShoppingCategory(
    id: string | number,
    userId: string | number,
    categoryData: any,
  ) {
    const result = await db
      .from('tbl_shopping_categories')
      .update(categoryData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static async checkCategoryDependencies(id: string | number) {
    const result = await db
      .from('tbl_products')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    return {
      data: {
        hasDependencies: (result.count || 0) > 0,
        count: result.count || 0,
      },
      error: result.error,
    };
  }

  static async deleteShoppingCategory(
    id: string | number,
    userId: string | number,
  ) {
    // 1. Dependências
    const deps = await this.checkCategoryDependencies(id);
    if (deps.data?.hasDependencies) {
      return {
        data: null,
        error: {
          message:
            'Não é possível excluir a categoria pois ela está sendo usada por produtos',
          code: 'DEPENDENCY_ERROR',
        },
      };
    }

    const result = await db
      .from('tbl_shopping_categories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    return { data: { success: !result.error }, error: result.error };
  }

  static async getAllFinancialCategories(userId: string) {
    const result = await db
      .from('tbl_financial_categories')
      .select('*')
      .eq('user_id', userId);
    return { data: result.data, error: result.error };
  }

  static async createShoppingList(listData: any) {
    const { name, items = [], user_id } = listData;

    // 1. Criar lista
    const listInsert = await db
      .from('tbl_shopping_lists')
      .insert({
        name,
        user_id,
        status: 'pending',
        // created_at é default NOW()
      })
      .select()
      .single();

    if (listInsert.error) {
      return {
        data: null,
        error: listInsert.error,
      };
    }

    const list = listInsert.data;

    // 2. Se não houver itens, retorna a lista
    if (!items || items.length === 0) {
      return { data: { ...list, items: [] }, error: null };
    }

    // 3. Verificar se produtos existem (opcional, mas bom pra consistência)
    // O Supabase vai dar erro de FK se não existirem, então podemos pular verificação manual se confiarmos na FK constraint.
    // Mas para dar mensagem personalizada como no original, poderíamos verificar.
    // Vamos confiar na FK constraint 'fk_product_id' ou 'on delete restrict' para simplificar,
    // ou fazer a verificação se o usuário exigiu comportamento idêntico.
    // O original fazia: "Produto não encontrado: ${product_id}" e deletava a lista criada.

    // Vamos tentar inserir os itens. Se falhar, deletamos a lista.
    const itemsToInsert = items.map((product_id: string) => ({
      shopping_list_id: list.id,
      product_id,
      quantity: 1,
      price: 0,
      checked: false,
    }));

    const itemsInsert = await db
      .from('tbl_shopping_list_items')
      .insert(itemsToInsert)
      .select();

    if (itemsInsert.error) {
      // Rollback manual
      await db.from('tbl_shopping_lists').delete().eq('id', list.id);

      return {
        data: null,
        error: itemsInsert.error, // Retorna o erro do banco (provavelmente FK violation se produto não existir)
      };
    }

    return {
      data: { ...list, items: itemsInsert.data || [] },
      error: null,
    };
  }

  static async duplicateShoppingList(
    baseListId: string | number,
    newName: string,
    userId: string | number,
  ) {
    // 1. Buscar itens da lista base
    // Usamos getShoppingListWithItems para garantir que temos todos os itens
    const baseListWithItems = await this.getShoppingListWithItems(
      baseListId,
      userId,
    );

    if (baseListWithItems.error || !baseListWithItems.data) {
      return {
        data: null,
        error: baseListWithItems.error || {
          message: 'Lista base não encontrada',
        },
      };
    }

    const { items } = baseListWithItems.data;

    // 2. Criar a nova lista
    const listInsert = await db
      .from('tbl_shopping_lists')
      .insert({
        name: newName,
        user_id: userId,
        status: 'pending',
      })
      .select()
      .single();

    if (listInsert.error) {
      return { data: null, error: listInsert.error };
    }

    const newList = listInsert.data;

    // 3. Se a lista base não tiver itens, retorna apenas a nova lista
    if (!items || items.length === 0) {
      return { data: { ...newList, items: [] }, error: null };
    }

    // 4. Preparar itens para inserção na nova lista
    const itemsToInsert = items.map((item: any) => ({
      shopping_list_id: newList.id,
      product_id: item.product_id,
      quantity: 0,
      price: 0,
      checked: false,
    }));

    const itemsInsert = await db
      .from('tbl_shopping_list_items')
      .insert(itemsToInsert)
      .select();

    if (itemsInsert.error) {
      // Rollback: Deleta a lista criada se falhar a inserção dos itens
      await db.from('tbl_shopping_lists').delete().eq('id', newList.id);
      return { data: null, error: itemsInsert.error };
    }

    return {
      data: { ...newList, items: itemsInsert.data || [] },
      error: null,
    };
  }

  static async updatePaymentStatus(
    id: string | number,
    userId: string | number,
    paidInstallments: number,
  ) {
    const result = await db
      .from('tbl_transactions')
      .update({ paid_installments: paidInstallments })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    return { data: result.data, error: result.error };
  }

  static getConfig() {
    return dbConfig;
  }

  static getDatabase() {
    return db;
  }
}

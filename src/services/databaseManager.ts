import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export interface DatabaseConfig {
  type: 'sqlite' | 'supabase';
  connection: any;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: any;
  private config: DatabaseConfig;

  private constructor() {
    const env = process.env['NODE_ENV'] || 'development';

    if (env === 'production') {
      // Supabase em produção
      const supabaseUrl = process.env['SUPABASE_URL']!;
      const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

      this.config = {
        type: 'supabase',
        connection: createClient(supabaseUrl, supabaseKey),
      };
    } else {
      // SQLite em desenvolvimento
      const dbPath = process.env['SQLITE_DB_PATH'] || './dev.sqlite3';
      this.config = {
        type: 'sqlite',
        connection: new Database(dbPath),
      };

      this.initializeSQLite();
    }

    this.db = this.config.connection;
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getDatabase() {
    return this.db;
  }

  getConfig() {
    return this.config;
  }

  /**
   * Inicialização completa do banco SQLite:
   * - Criação das tabelas espelhando a estrutura do Supabase
   * - Inserção de dados iniciais (seed)
   */
  private initializeSQLite() {
    if (this.config.type !== 'sqlite') return;

    const db = this.config.connection;

    // Registrar função para gerar UUIDs (compatível com gen_random_uuid() do Postgres)
    try {
      db.function('gen_random_uuid', () => crypto.randomUUID());
    } catch (e) {
      // Ignora se já estiver registrada
    }

    db.exec(`
      PRAGMA foreign_keys = ON;

      ---------------------------------------------------------------------
      -- 001: USERS
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_users (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON tbl_users(email);

      ---------------------------------------------------------------------
      -- 002: FINANCIAL CATEGORIES
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_financial_categories (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('revenue', 'expense')),
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_financial_categories_user_id ON tbl_financial_categories(user_id);
      CREATE INDEX IF NOT EXISTS idx_financial_categories_type ON tbl_financial_categories(type);

      ---------------------------------------------------------------------
      -- 003: TRANSACTIONS
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_transactions (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        description TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
        type TEXT NOT NULL CHECK (type IN ('revenue', 'expense')),
        transaction_date DATE NOT NULL,
        payment_method TEXT,
        installments TEXT,
        is_installment INTEGER DEFAULT 0,
        is_recurrent INTEGER DEFAULT 0,
        recurrence_start_date DATE,
        category_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        installment_number INTEGER DEFAULT 1,
        total_installments INTEGER DEFAULT 1,
        parent_transaction_id TEXT,
        paid_installments INTEGER DEFAULT 0,
        start_date DATE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES tbl_financial_categories(id) ON DELETE RESTRICT,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON tbl_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON tbl_transactions(category_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON tbl_transactions(transaction_date);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON tbl_transactions(type);

      ---------------------------------------------------------------------
      -- 004: SHOPPING CATEGORIES
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_shopping_categories (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_shopping_categories_user_id ON tbl_shopping_categories(user_id);

      ---------------------------------------------------------------------
      -- 005: PRODUCTS
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_products (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        name TEXT NOT NULL,
        unit TEXT NOT NULL CHECK (unit IN ('un', 'kg', 'l', 'dz', 'm', 'cx')),
        category_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES tbl_shopping_categories(id) ON DELETE RESTRICT,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_products_user_id ON tbl_products(user_id);
      CREATE INDEX IF NOT EXISTS idx_products_category_id ON tbl_products(category_id);

      ---------------------------------------------------------------------
      -- 006: SHOPPING LISTS
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_shopping_lists (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        total_amount DECIMAL(10,2),
        user_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES tbl_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_shopping_lists_user_id ON tbl_shopping_lists(user_id);
      CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON tbl_shopping_lists(status);

      ---------------------------------------------------------------------
      -- 007: SHOPPING LIST ITEMS
      ---------------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS tbl_shopping_list_items (
        id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
        quantity DECIMAL(10,3) NOT NULL CHECK (quantity > 0),
        price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
        checked BOOLEAN DEFAULT 0,
        shopping_list_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shopping_list_id) REFERENCES tbl_shopping_lists(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES tbl_products(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_shopping_list_items_list_id ON tbl_shopping_list_items(shopping_list_id);
      CREATE INDEX IF NOT EXISTS idx_shopping_list_items_product_id ON tbl_shopping_list_items(product_id);
    `);

    // Ensure columns exist on tbl_transactions (for upgrades)
    try {
      const cols: any[] = db
        .prepare("PRAGMA table_info('tbl_transactions')")
        .all();

      const hasIsRecurrent = cols.some((c) => c.name === 'is_recurrent');
      const hasRecurrenceStart = cols.some(
        (c) => c.name === 'recurrence_start_date',
      );
      const hasPaymentMethod = cols.some((c) => c.name === 'payment_method');
      const hasInstallments = cols.some((c) => c.name === 'installments');
      const hasStartDate = cols.some((c) => c.name === 'start_date');

      if (!hasIsRecurrent) {
        try {
          db.prepare(
            'ALTER TABLE tbl_transactions ADD COLUMN is_recurrent INTEGER DEFAULT 0',
          ).run();
          console.log(
            'Migration: added column is_recurrent to tbl_transactions',
          );
        } catch (e: any) {
          console.warn('Could not add is_recurrent column:', e.message || e);
        }
      }

      if (!hasRecurrenceStart) {
        try {
          db.prepare(
            'ALTER TABLE tbl_transactions ADD COLUMN recurrence_start_date DATE',
          ).run();
          console.log(
            'Migration: added column recurrence_start_date to tbl_transactions',
          );
        } catch (e: any) {
          console.warn(
            'Could not add recurrence_start_date column:',
            e.message || e,
          );
        }
      }

      if (!hasPaymentMethod) {
        try {
          db.prepare(
            'ALTER TABLE tbl_transactions ADD COLUMN payment_method TEXT',
          ).run();
          console.log(
            'Migration: added column payment_method to tbl_transactions',
          );
        } catch (e: any) {
          console.warn('Could not add payment_method column:', e.message || e);
        }
      }

      if (!hasInstallments) {
        try {
          db.prepare(
            'ALTER TABLE tbl_transactions ADD COLUMN installments TEXT',
          ).run();
          console.log(
            'Migration: added column installments to tbl_transactions',
          );
        } catch (e: any) {
          console.warn('Could not add installments column:', e.message || e);
        }
      }

      if (!hasStartDate) {
        try {
          db.prepare(
            'ALTER TABLE tbl_transactions ADD COLUMN start_date DATE',
          ).run();
          console.log('Migration: added column start_date to tbl_transactions');
        } catch (e: any) {
          console.warn('Could not add start_date column:', e.message || e);
        }
      }
    } catch (e: any) {
      console.warn(
        'Could not inspect tbl_transactions columns:',
        e.message || e,
      );
    }

    // ---------------------------------------------------------
    // SEED DATA
    // ---------------------------------------------------------
    const existingUsers = db
      .prepare(`SELECT COUNT(*) AS total FROM tbl_users`)
      .get();

    if (existingUsers.total === 0) {
      console.log('Seeding initial data...');

      // 1. Admin User
      db.prepare(
        `
        INSERT INTO tbl_users (email, password)
        VALUES (
          'admin@fin-control.com',
          '$2a$12$i6aZNprRzbowY0A1kD3Dru5ho7V4z4uXGBx5vAG4ZO3jtMI/7/ob2'
        );
      `,
      ).run();

      const user = db
        .prepare(
          `SELECT id FROM tbl_users WHERE email = 'admin@fin-control.com'`,
        )
        .get();
      const userId = user.id;

      // 2. Financial Categories
      const financialCategories = [
        { name: 'Salário', type: 'revenue' },
        { name: 'Freelance', type: 'revenue' },
        { name: 'Investimentos', type: 'revenue' },
        { name: 'Vendas', type: 'revenue' },
        { name: 'Alimentação', type: 'expense' },
        { name: 'Moradia', type: 'expense' },
        { name: 'Transporte', type: 'expense' },
        { name: 'Saúde', type: 'expense' },
        { name: 'Lazer', type: 'expense' },
        { name: 'Educação', type: 'expense' },
        { name: 'Compras', type: 'expense' },
        { name: 'Contas Fixas', type: 'expense' },
        { name: 'Outros', type: 'expense' },
      ];

      const insertFinancialCategory = db.prepare(
        `INSERT INTO tbl_financial_categories (name, type, user_id) VALUES (?, ?, ?)`,
      );

      for (const cat of financialCategories) {
        console.log(cat.name, cat.type, userId);
        insertFinancialCategory.run(cat.name, cat.type, userId);
      }

      // 3. Shopping Categories
      const categories = [
        'Açougue',
        'Bebidas',
        'Cereais e Grãos',
        'Congelados',
        'Frios e Laticínios',
        'Higiene Pessoal',
        'Hortifruti',
        'Limpeza',
        'Mercearia',
        'Padaria',
        'Utilidades', // Para itens de casa/cozinha
      ];

      const insertCategory = db.prepare(
        `INSERT INTO tbl_shopping_categories (name, user_id) VALUES (?, ?)`,
      );

      const categoryMap = new Map<string, string>();

      for (const catName of categories) {
        insertCategory.run(catName, userId);
        const catRow = db
          .prepare(
            `SELECT id FROM tbl_shopping_categories WHERE name = ? AND user_id = ?`,
          )
          .get(catName, userId);
        categoryMap.set(catName, catRow.id);
      }

      // 4. Products
      const productsData = [
        // Cereais e Grãos
        { name: 'Arroz Branco', unit: 'kg', cat: 'Cereais e Grãos' },
        { name: 'Feijão Carioca', unit: 'kg', cat: 'Cereais e Grãos' },
        { name: 'Farinha de Trigo', unit: 'kg', cat: 'Cereais e Grãos' },
        { name: 'Fubá', unit: 'kg', cat: 'Cereais e Grãos' },
        // Mercearia
        { name: 'Macarrão Espaguete', unit: 'kg', cat: 'Mercearia' },
        { name: 'Macarrão Parafuso', unit: 'kg', cat: 'Mercearia' },
        { name: 'Óleo de Soja', unit: 'l', cat: 'Mercearia' },
        { name: 'Óleo de Girassol', unit: 'l', cat: 'Mercearia' },
        { name: 'Azeite de Oliva', unit: 'l', cat: 'Mercearia' },
        { name: 'Açúcar Cristal', unit: 'kg', cat: 'Mercearia' },
        { name: 'Açúcar Refinado', unit: 'kg', cat: 'Mercearia' },
        { name: 'Café em Pó', unit: 'kg', cat: 'Mercearia' },
        { name: 'Chá Mate', unit: 'cx', cat: 'Mercearia' },
        { name: 'Chá de Camomila', unit: 'cx', cat: 'Mercearia' },
        { name: 'Sal Refinado', unit: 'kg', cat: 'Mercearia' },
        { name: 'Sal Grosso', unit: 'kg', cat: 'Mercearia' },
        { name: 'Molho de Tomate', unit: 'un', cat: 'Mercearia' },
        { name: 'Extrato de Tomate', unit: 'un', cat: 'Mercearia' },
        { name: 'Milho Verde em Lata', unit: 'un', cat: 'Mercearia' },
        { name: 'Ervilha em Lata', unit: 'un', cat: 'Mercearia' },
        { name: 'Atum em Lata', unit: 'un', cat: 'Mercearia' },
        { name: 'Sardinha em Lata', unit: 'un', cat: 'Mercearia' },
        { name: 'Leite Condensado', unit: 'un', cat: 'Mercearia' },
        { name: 'Creme de Leite', unit: 'un', cat: 'Mercearia' },
        { name: 'Gelatina', unit: 'un', cat: 'Mercearia' },
        // Frios e Laticínios
        { name: 'Leite Integral', unit: 'l', cat: 'Frios e Laticínios' },
        { name: 'Leite Desnatado', unit: 'l', cat: 'Frios e Laticínios' },
        { name: 'Manteiga', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Margarina', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Queijo Mussarela', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Queijo Prato', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Queijo Minas', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Requeijão', unit: 'un', cat: 'Frios e Laticínios' },
        { name: 'Iogurte Natural', unit: 'un', cat: 'Frios e Laticínios' },
        { name: 'Iogurte Saborizado', unit: 'un', cat: 'Frios e Laticínios' },
        { name: 'Presunto', unit: 'kg', cat: 'Frios e Laticínios' },
        { name: 'Mortadela', unit: 'kg', cat: 'Frios e Laticínios' },
        // Padaria
        { name: 'Pão Francês', unit: 'kg', cat: 'Padaria' },
        { name: 'Pão Integral', unit: 'un', cat: 'Padaria' },
        { name: 'Bolo Simples', unit: 'un', cat: 'Padaria' },
        { name: 'Torradas', unit: 'un', cat: 'Padaria' },
        // Açougue
        { name: 'Frango Inteiro', unit: 'kg', cat: 'Açougue' },
        { name: 'Peito de Frango', unit: 'kg', cat: 'Açougue' },
        { name: 'Coxa e Sobrecoxa', unit: 'kg', cat: 'Açougue' },
        { name: 'Carne Moída', unit: 'kg', cat: 'Açougue' },
        { name: 'Bife de Alcatra', unit: 'kg', cat: 'Açougue' },
        { name: 'Picanha', unit: 'kg', cat: 'Açougue' },
        { name: 'Linguiça Toscana', unit: 'kg', cat: 'Açougue' },
        { name: 'Carne Suína', unit: 'kg', cat: 'Açougue' },
        // Hortifruti
        { name: 'Cebola', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Batata', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Cenoura', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Alface', unit: 'un', cat: 'Hortifruti' },
        { name: 'Banana Prata', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Maçã', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Laranja', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Limão', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Pimentão', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Abobrinha', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Berinjela', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Abacate', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Uva', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Mamão', unit: 'kg', cat: 'Hortifruti' },
        { name: 'Melancia', unit: 'kg', cat: 'Hortifruti' },
        // Bebidas
        { name: 'Refrigerante Coca-Cola 2L', unit: 'un', cat: 'Bebidas' },
        { name: 'Refrigerante Guaraná 2L', unit: 'un', cat: 'Bebidas' },
        { name: 'Água Mineral 1.5L', unit: 'un', cat: 'Bebidas' },
        { name: 'Água com Gás', unit: 'un', cat: 'Bebidas' },
        { name: 'Suco de Laranja', unit: 'l', cat: 'Bebidas' },
        { name: 'Suco de Uva', unit: 'l', cat: 'Bebidas' },
        { name: 'Cerveja Lata', unit: 'un', cat: 'Bebidas' },
        { name: 'Isotônico', unit: 'un', cat: 'Bebidas' },
        { name: 'Energético', unit: 'un', cat: 'Bebidas' },
        // Limpeza
        { name: 'Detergente', unit: 'un', cat: 'Limpeza' },
        { name: 'Sabão em Pó', unit: 'kg', cat: 'Limpeza' },
        { name: 'Amaciante', unit: 'l', cat: 'Limpeza' },
        { name: 'Desinfetante', unit: 'l', cat: 'Limpeza' },
        { name: 'Água Sanitária', unit: 'l', cat: 'Limpeza' },
        { name: 'Lustra Móveis', unit: 'un', cat: 'Limpeza' },
        { name: 'Esponja de Aço', unit: 'un', cat: 'Limpeza' },
        { name: 'Sabão em Barra', unit: 'un', cat: 'Limpeza' },
        { name: 'Saco de Lixo 30L', unit: 'un', cat: 'Limpeza' },
        { name: 'Saco de Lixo 50L', unit: 'un', cat: 'Limpeza' },
        { name: 'Papel Higiênico', unit: 'un', cat: 'Limpeza' },
        { name: 'Papel Toalha', unit: 'un', cat: 'Limpeza' },
        { name: 'Pano de Chão', unit: 'un', cat: 'Limpeza' },
        { name: 'Vassoura', unit: 'un', cat: 'Limpeza' },
        { name: 'Rodo', unit: 'un', cat: 'Limpeza' },
        // Higiene Pessoal
        { name: 'Sabonete', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Shampoo', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Condicionador', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Pasta de Dente', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Escova de Dente', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Fio Dental', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Desodorante', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Absorvente', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Algodão', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Cotonete', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Lâmina de Barbear', unit: 'un', cat: 'Higiene Pessoal' },
        { name: 'Creme de Barbear', unit: 'un', cat: 'Higiene Pessoal' },
        // Utilidades (Cozinha / Casa)
        { name: 'Fósforos', unit: 'un', cat: 'Utilidades' },
        { name: 'Papel Alumínio', unit: 'un', cat: 'Utilidades' },
        { name: 'Papel Filme', unit: 'un', cat: 'Utilidades' },
        { name: 'Guardanapos', unit: 'un', cat: 'Utilidades' },
        { name: 'Filtro de Café', unit: 'un', cat: 'Utilidades' },
        { name: 'Velas', unit: 'un', cat: 'Utilidades' },
        { name: 'Pilhas AA', unit: 'un', cat: 'Utilidades' },
        { name: 'Pilhas AAA', unit: 'un', cat: 'Utilidades' },
        // Pet
        { name: 'Ração para Cães', unit: 'kg', cat: 'Utilidades' },
        { name: 'Ração para Gatos', unit: 'kg', cat: 'Utilidades' },
        { name: 'Areia para Gatos', unit: 'kg', cat: 'Utilidades' },
      ];

      const insertProduct = db.prepare(
        `INSERT INTO tbl_products (name, unit, category_id, user_id) VALUES (?, ?, ?, ?)`,
      );

      for (const prod of productsData) {
        const catId = categoryMap.get(prod.cat);
        if (catId) {
          insertProduct.run(prod.name, prod.unit, catId, userId);
        }
      }
    }
  }
}

export const databaseManager = DatabaseManager.getInstance();

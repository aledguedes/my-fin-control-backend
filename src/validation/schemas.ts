import Joi from 'joi';

export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email(),
  username: Joi.string(),
  password: Joi.string().required(),
}).or('email', 'username');

export const transactionSchema = Joi.object({
  id: Joi.string().optional(),
  description: Joi.string().required(),
  amount: Joi.number().positive().required(),
  type: Joi.string().valid('revenue', 'expense').required(),
  is_recurrent: Joi.boolean().optional(),
  category_id: Joi.string().uuid().required(),
  transaction_date: Joi.date().iso().required(),
  payment_method: Joi.string().optional(),
  recurrence_start_date: Joi.date().iso().when('is_recurrent', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  is_installment: Joi.boolean().required(),
  installments: Joi.object({
    total_installments: Joi.number()
      .integer()
      .min(1)
      .required()
      .when('is_installment', {
        is: false,
        then: Joi.valid(1).required(),
      }),
    paid_installments: Joi.number().integer().min(0).required(), // CAMPO INCLUÍDO
    start_date: Joi.date()
      .iso()
      .required()
      .when('is_installment', {
        is: false,
        then: Joi.valid(Joi.ref('transaction_date')).required(),
      }),
  }).required(),
});

export const financialCategorySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid('revenue', 'expense').required(),
});

export const shoppingListSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  items: Joi.array().items(Joi.string().uuid()).optional(),
});

// Este schema define a estrutura completa de um item individual dentro do array 'items'
export const fullShoppingListItemSchema = Joi.object({
  id: Joi.string().uuid().required(),
  quantity: Joi.number().positive().required(),
  price: Joi.number().min(0).required(), // Ajustado para aceitar 0
  checked: Joi.boolean().required(),
  productId: Joi.string().uuid().required(),
  shoppingListId: Joi.string().uuid().required(),
  name: Joi.string().min(1).required(),
  categoryId: Joi.string().uuid().required(),
  unit: Joi.string().valid('un', 'kg', 'l', 'dz', 'm', 'cx').required(),
  createdAt: Joi.date().iso().required(),
  updatedAt: Joi.date().iso().required(),
}).required();

// Este schema define a estrutura do JSON COMPLETO enviado pelo frontend
export const fullShoppingListPayloadSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().min(1).max(200).required(),
  status: Joi.string().valid('pending', 'completed').required(),
  created_at: Joi.date().iso().required(),
  completed_at: Joi.date().iso().allow(null), // Pode ser nulo
  total_amount: Joi.number().min(0).allow(null), // Pode ser nulo
  user_id: Joi.string().uuid().required(),
  // O campo 'items' usa o schema de item detalhado criado acima
  items: Joi.array().items(fullShoppingListItemSchema).min(0).required(),
}).required();

export const shoppingListItemSchema = Joi.object({
  quantity: Joi.number().positive().required(),
  price: Joi.number().positive().required(),
  product_id: Joi.string().uuid().required(),
});

export const productSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  unit: Joi.string().valid('un', 'kg', 'l', 'dz', 'm', 'cx').required(),
  category_id: Joi.string().uuid().required(),
});

export const shoppingCategorySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
});

export const monthlyViewQuerySchema = Joi.object({
  year: Joi.number().integer().min(2020).max(2030).required(),
  month: Joi.number().integer().min(1).max(12).required(),
});

export const updatePaymentSchema = Joi.object({
  paid_installments: Joi.number().integer().min(0).required(),
});

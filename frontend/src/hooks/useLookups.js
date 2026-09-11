import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../context/AppProviders';

/**
 * Listas de apoio dos formulários. Ficam em cache longo porque contas,
 * categorias e cartões mudam com muito menos frequência que lançamentos.
 */
const LOOKUP_OPTIONS = { staleTime: 5 * 60 * 1000 };

export const useAccounts = (params) =>
  useQuery({
    queryKey: ['accounts', params],
    queryFn: () => api.get('/accounts', params),
    ...LOOKUP_OPTIONS,
  });

export const useCategories = (kind) =>
  useQuery({
    queryKey: ['categories', kind],
    queryFn: () => api.get('/categories', { kind, flat: true }),
    ...LOOKUP_OPTIONS,
  });

export const useCategoryTree = (kind) =>
  useQuery({
    queryKey: ['categories-tree', kind],
    queryFn: () => api.get('/categories', { kind }),
    ...LOOKUP_OPTIONS,
  });

export const useCards = () =>
  useQuery({
    queryKey: ['cards'],
    queryFn: () => api.get('/cards'),
    ...LOOKUP_OPTIONS,
  });

/**
 * Mutação com invalidação e aviso padronizados.
 * `invalidate` recebe as chaves de query que ficaram obsoletas.
 */
export function useApiMutation({ mutationFn, invalidate = [], successMessage, onSuccess }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      for (const key of invalidate) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }
      // Saldos e patrimônio dependem de quase tudo: revalidam sempre.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['networth'] });

      const message = typeof successMessage === 'function' ? successMessage(data) : successMessage;
      if (message) toast.success(message);
      onSuccess?.(data, variables);
    },
    onError: (err) => toast.error(err.message),
  });
}

/** Opções de <Select> para contas. */
export function accountOptions(data) {
  return (data?.data ?? []).map((a) => ({ value: a.id, label: a.name }));
}

/** Opções de categoria com subcategorias indentadas. */
export function categoryOptions(data) {
  const list = data?.data ?? [];
  const parents = list.filter((c) => !c.parent_id);
  const options = [];
  for (const parent of parents) {
    options.push({ value: parent.id, label: parent.name });
    for (const child of list.filter((c) => c.parent_id === parent.id)) {
      options.push({ value: child.id, label: `   ${child.name}` });
    }
  }
  return options;
}

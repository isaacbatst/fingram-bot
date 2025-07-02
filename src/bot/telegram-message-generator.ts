/* eslint-disable no-useless-escape */
import { ActionType } from '../domain/action';
import { Category } from '../domain/category';
import { Paginated } from '../domain/paginated';
import { Transaction } from '../domain/transaction';
import { Vault } from '../domain/vault';

export class TelegramMessageGenerator {
  /**
   * Escapa caracteres especiais do Markdown V2 do Telegram
   * @param text Texto a ser escapado
   * @returns Texto escapado
   */
  escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  /**
   * Formata uma mensagem de sucesso para uma transação
   * @param vault Cofre onde a transação foi registrada
   * @param transaction Dados da transação
   * @returns Mensagem formatada em Markdown V2
   */
  formatTransactionSuccessMessage(
    vault: Vault,
    transaction: {
      amount: number;
      type: 'expense' | 'income';
      description?: string;
      createdAt: Date;
      categoryName: string | null;
    },
  ): string {
    const valor = this.escapeMarkdownV2(
      Math.abs(transaction.amount).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      }),
    );
    const saldo = this.escapeMarkdownV2(
      vault.getBalance().toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      }),
    );
    const tipo = transaction.type === 'income' ? 'Receita' : 'Despesa';
    const emoji = transaction.type === 'income' ? '🟢' : '🔴';
    const desc = transaction.description
      ? `\n*Descrição:* ${this.escapeMarkdownV2(transaction.description)}`
      : '';
    return (
      `${emoji} *${tipo} registrada com sucesso\\!*\n\n` +
      `*Valor:* ${valor}${desc}\n` +
      `*Categoria:* ${this.escapeMarkdownV2(
        transaction.categoryName ?? 'Nenhuma categoria especificada',
      )}\n\n` +
      `*Saldo atual:* ${saldo}` +
      `\n\n` +
      this.formatBudgetSummary(vault)
    );
  }

  /**
   * Formata um resumo do cofre incluindo saldo e orçamentos
   * @param vault Cofre a ser formatado
   * @returns Mensagem formatada em Markdown V2
   */
  formatVault(vault: Vault): string {
    const balance = vault.getBalance().toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });

    let text = `💰 Cofre\n`;
    text += `Token: \`${this.escapeMarkdownV2(vault.token)}\`\n`;
    text += `Criado em: ${this.escapeMarkdownV2(vault.createdAt.toLocaleDateString('pt-BR'))}\n`;
    text += `Saldo atual: ${this.escapeMarkdownV2(balance)}\n\n`;
    text += this.formatBudgetSummary(vault);

    return text;
  }

  formatActionDetected(action: {
    type: ActionType;
    id: string;
    payload: {
      amount: number;
      description?: string;
      categoryName?: string | null;
      categoryCode?: string | null;
    };
  }): string {
    const emoji = action.type === ActionType.INCOME ? '🟢' : '🔴';
    const formattedAmount = Math.abs(action.payload.amount).toLocaleString(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      },
    );

    const category =
      action.payload.categoryName && action.payload.categoryCode
        ? `#${action.payload.categoryCode} | ${action.payload.categoryName}`
        : action.payload.categoryName ||
          action.payload.categoryCode ||
          'Nenhuma categoria especificada';

    return (
      `${emoji} Detectei que você deseja registrar a seguinte ${action.type === ActionType.INCOME ? 'receita' : 'despesa'}:\n\n` +
      `*Valor:* ${this.escapeMarkdownV2(formattedAmount)}\n` +
      `*Descrição:* ${action.payload.description ? this.escapeMarkdownV2(action.payload.description) : 'Sem descrição'}\n\n` +
      `*Categoria:* ${this.escapeMarkdownV2(category)}\n\n` +
      `Deseja confirmar?`
    );
  }

  formatVaultCreated(vault: Vault): string {
    return (
      `Cofre criado com sucesso\\!\n\n` +
      `*Token de Acesso:* \`${this.escapeMarkdownV2(vault.token)}\`\n\n` +
      'Envie uma mensagem começando com `@ai`:\n\n' +
      '_Exemplos:_ \n\n`@ai 100 salário de setembro`\n`@ai 50 compra de supermercado`\n\n' +
      `Use /help para ver os comandos disponíveis\\.`
    );
  }

  formatVaultJoined(vault: { id: string; token: string }): string {
    return (
      `Você se conectou ao cofre com sucesso\\!\n\n` +
      `*ID do Cofre:* ${this.escapeMarkdownV2(vault.id)}\n` +
      `*Token de Acesso:* ${this.escapeMarkdownV2(vault.token)}\n\n` +
      `Agora você pode registrar receitas e despesas neste cofre\\.`
    );
  }

  formatTransactionEdited(
    code: string,
    newAmount: number,
    vault: { getBalance(): number },
  ): string {
    return (
      `Transação\#${this.escapeMarkdownV2(code)} editada com sucesso\\!\n\n` +
      `*Novo valor:* R$ ${this.escapeMarkdownV2(newAmount.toFixed(2).replace('.', ','))}\n` +
      `*Saldo atual:* R$ ${this.escapeMarkdownV2(vault.getBalance().toFixed(2).replace('.', ','))}`
    );
  }

  formatBudgetsSet(vault: Vault): string {
    return (
      `Orçamentos definidos com sucesso\\!\n\n` +
      `*Saldo atual:* ${this.escapeMarkdownV2(
        vault.getBalance().toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        }),
      )}\n` +
      `*Orçamentos:* \n` +
      Array.from(vault.budgets.values())
        .map(
          (budget) =>
            `• \`#${this.escapeMarkdownV2(budget.category.code)}\` ${this.escapeMarkdownV2(budget.category.name)} \\| ${this.escapeMarkdownV2(
              budget.amount.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                minimumFractionDigits: 2,
              }),
            )}`,
        )
        .join('\n')
    );
  }

  formatCategories(categories: Category[]): string {
    if (categories.length === 0) {
      return 'Nenhuma categoria disponível no momento.';
    }

    let text = `*Categorias Disponíveis:*\n\n`;
    for (const category of categories) {
      text += `• \`#${this.escapeMarkdownV2(category.code)}\` \\| ${this.escapeMarkdownV2(category.name)}\n`;
    }
    text += `\nUse o código da categoria para definir orçamentos ou registrar transações\\.\n`;
    return text;
  }

  formatTransactions(
    paginated: Paginated<Transaction>,
    args: {
      date?: { day?: number; month: number; year: number };
      page?: number;
    },
  ): string {
    const { date, page = 1 } = args;
    const totalPages = Math.max(
      1,
      Math.ceil(paginated.total / paginated.pageSize),
    );
    let text = `*Transações do Cofre:*\n\n`;

    // Metadata about filters
    let dateArg = '';
    if (date) {
      if (date.day) {
        text += `Filtro: ${date.day.toString().padStart(2, '0')}/${date.month.toString().padStart(2, '0')}/${date.year}\n`;
        dateArg = `-d ${date.day.toString().padStart(2, '0')}/${date.month.toString().padStart(2, '0')}/${date.year}`;
      } else {
        text += `Filtro: ${date.month.toString().padStart(2, '0')}/${date.year}\n`;
        dateArg = `-d ${date.month.toString().padStart(2, '0')}/${date.year}`;
      }
    }

    if (paginated.items.length === 0) {
      return (
        text + 'Nenhuma transação encontrada para os critérios especificados\\.'
      );
    }
    text += `Página ${page} de ${totalPages}\n\n`;

    for (const transaction of paginated.items) {
      const value = Math.abs(transaction.amount).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      });
      const data = transaction.createdAt.toLocaleDateString('pt-BR');
      text += `• \`#${this.escapeMarkdownV2(transaction.code)}\` \\| ${this.escapeMarkdownV2(value)} \\| ${this.escapeMarkdownV2(data)} \\| ${transaction.description ? this.escapeMarkdownV2(transaction.description) : '\\-'}\n\n`;
    }

    // Pagination navigation info
    if (totalPages > 1) {
      text += `Página ${page} de ${totalPages}\n`;
      if (page > 1) {
        text += `⬅️ \`/transactions \\-p ${page - 1}${dateArg ? ' ' + dateArg : ''}\`\n`;
      }
      if (page < totalPages) {
        text += `➡️ \`/transactions \\-p ${page + 1}${dateArg ? ' ' + dateArg : ''}\`\n`;
      }
    }

    return text;
  }

  formatHelp(): string {
    return (
      'Comandos disponíveis:\n\n' +
      '/setbudget <categoria1> <quantia1>, <categoria2> <quantia2> - Define orçamentos para categorias específicas. Use o código da categoria e a quantia desejada.\n' +
      '/expense <quantia> [descrição] - Registra uma despesa no cofre. A quantia deve ser um número, e a descrição é opcional.\n' +
      '/income <quantia> [descrição] - Registra uma receita no cofre. A quantia deve ser um número, e a descrição é opcional.\n' +
      '/edit <código> <nova quantia> - Edita uma transação existente no cofre. O código é o identificador da transação, e a nova quantia deve ser um número.\n' +
      '/summary - Exibe o resumo do cofre atual.\n' +
      '/transactions -p <página> -d mm/yyyy|dd-mm-yyyy - Exibe as transações do cofre. Use -p para especificar a página (padrão é 1) e -d para filtrar por data (mês/ano ou dia-mês-ano).\n' +
      '/join <token> - Conecta-se a um cofre existente usando o token.'
    );
  }

  formatBudgetSummary(vault: Vault): string {
    let text: string = '';
    const budgetsSummary = vault.getBudgetsSummary();
    if (budgetsSummary.length > 0) {
      text += `• Orçamento: R$ ${this.escapeMarkdownV2(
        vault.totalBudgetedAmount().toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        }),
      )}\n`;
      text += `  Total gasto: R$ ${this.escapeMarkdownV2(
        vault.totalSpentAmount().toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        }),
      )}\n`;
      text += `  ${this.formatPercentageBar(vault.percentageTotalBudgetedAmount())}\n\n`;

      text += `*Categorias*:\n\n`;

      for (const budget of budgetsSummary) {
        const spent = budget.spent.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        });
        const amount = budget.amount.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        });
        const percentage = Math.round(budget.percentageUsed);
        const cappedPercentage = Math.max(0, Math.min(percentage, 100));
        const barLength = 10;
        const filledLength = Math.round((cappedPercentage / 100) * barLength);
        const bar =
          '█'.repeat(Math.max(0, Math.min(filledLength, barLength))) +
          '░'.repeat(Math.max(0, barLength - filledLength));

        text += `• \`#${this.escapeMarkdownV2(budget.category.code)}\` ${this.escapeMarkdownV2(budget.category.name)} ${this.escapeMarkdownV2(amount)}\n`;
        text += `  Gastos: ${this.escapeMarkdownV2(spent)} \\\n ${bar} ${percentage}%\n\n`;
      }
    } else {
      text += `Nenhum orçamento definido\\.\n`;
    }

    return text;
  }

  formatPercentageBar(percentage: number, barLength: number = 10): string {
    const filledLength = Math.round((percentage / 100) * barLength);
    const bar =
      '█'.repeat(Math.max(0, Math.min(filledLength, barLength))) +
      '░'.repeat(Math.max(0, barLength - filledLength));
    return `${bar} ${this.escapeMarkdownV2(percentage.toFixed(0))}%`;
  }
}

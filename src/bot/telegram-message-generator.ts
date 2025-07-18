import { ActionType } from '../vault/domain/action';
import { Category } from '../vault/domain/category';
import { Paginated } from '../vault/domain/paginated';
import { BudgetSummary, SerializedVault, Vault } from '../vault/domain/vault';
import { TransactionDTO } from '../vault/dto/transaction.dto,';

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
    vault: SerializedVault,
    transaction: TransactionDTO,
  ): string {
    const value = this.escapeMarkdownV2(
      Math.abs(transaction.amount).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      }),
    );
    const saldo = this.escapeMarkdownV2(
      vault.balance.toLocaleString('pt-BR', {
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
      `*Valor:* ${value}${desc}\n` +
      `*Categoria:* ${this.escapeMarkdownV2(
        transaction.category?.name ?? 'Nenhuma categoria especificada',
      )}\n\n` +
      `*Saldo atual:* ${saldo}` +
      `\n\n` +
      this.formatBudgetSummary(vault, vault.budgetsSummary)
    );
  }

  /**
   * Formata um resumo do cofre incluindo saldo e orçamentos
   * @param vault Cofre a ser formatado
   * @returns Mensagem formatada em Markdown V2
   */
  formatVault(
    vault: SerializedVault,
    budget: BudgetSummary[],
    date?: {
      month: number;
      year: number;
    },
  ): string {
    date = date ?? {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    };
    const balance = vault.balance.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });

    let text = `💰 Cofre\n`;
    text += `Token: \`${this.escapeMarkdownV2(vault.token)}\`\n`;
    text += `Criado em: ${this.escapeMarkdownV2(new Date(vault.createdAt).toLocaleDateString('pt-BR'))}\n`;
    text += `Resumo referente a: ${date.month.toString().padStart(2, '0')}/${date.year}\n`;
    text += `Saldo atual: ${this.escapeMarkdownV2(balance)}\n\n`;
    text += this.formatBudgetSummary(vault, budget);

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
      'Envie uma mensagem começando com `/ai`:\n\n' +
      '_Exemplos:_ \n\n`/ai 100 salário de setembro`\n`/ai 50 compra de supermercado`\n\n' +
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
    transaction: TransactionDTO,
    vault: { getBalance(): number },
  ): string {
    const amount = Math.abs(transaction.amount).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });

    const date = transaction.createdAt.toLocaleDateString('pt-BR');
    const balance = vault.getBalance().toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });

    let text = `✅ Transação \\#${this.escapeMarkdownV2(code)} editada com sucesso\\!\n\n`;
    text += `*Detalhes da transação:*\n`;
    text += `• *Código:* \`#${this.escapeMarkdownV2(code)}\`\n`;
    text += `• *Valor:* ${this.escapeMarkdownV2(amount)}\n`;
    text += `• *Tipo:* ${this.escapeMarkdownV2(transaction.type === 'income' ? 'Receita' : 'Despesa')}\n`;
    text += `• *Data:* ${this.escapeMarkdownV2(date)}\n`;

    if (transaction.description) {
      text += `• *Descrição:* ${this.escapeMarkdownV2(transaction.description)}\n`;
    }

    if (transaction.category) {
      text += `• *Categoria:* \`#${this.escapeMarkdownV2(transaction.category.code)}\` ${this.escapeMarkdownV2(transaction.category.name)}\n`;
    }

    text += `\n*Saldo atual:* ${this.escapeMarkdownV2(balance)}`;

    return text;
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
      text += `• \`#${this.escapeMarkdownV2(category.code)}\` \\| ${this.escapeMarkdownV2(category.name)}`;
      if (category.description) {
        text += ` \\- ${this.escapeMarkdownV2(category.description)}`;
      }
      text += `\n`;
    }
    text += `\nUse o código da categoria para definir orçamentos ou registrar transações\\.\n`;
    return text;
  }

  formatTransactions(
    paginated: Paginated<TransactionDTO>,
    args: {
      date?: { day?: number; month: number; year: number };
      page?: number;
    },
  ): string {
    // Set default values
    const now = new Date();
    const defaultDate = {
      day: undefined,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    };
    const date = args.date
      ? {
          day: args.date.day ?? undefined,
          month: args.date.month ?? defaultDate.month,
          year: args.date.year ?? defaultDate.year,
        }
      : defaultDate;
    const page = args.page ?? 1;

    const totalPages = Math.max(
      1,
      Math.ceil(paginated.total / paginated.pageSize),
    );
    let text = `*Transações do Cofre:*\n\n`;

    // Metadata about filters
    let dateArg = '';
    if (date.day !== undefined) {
      text += `Filtro: ${date.day.toString().padStart(2, '0')}/${date.month.toString().padStart(2, '0')}/${date.year}`;
      dateArg = `-d ${date.day.toString().padStart(2, '0')}/${date.month.toString().padStart(2, '0')}/${date.year}`;
    } else {
      text += `Filtro: ${date.month.toString().padStart(2, '0')}/${date.year}`;
      dateArg = `-d ${date.month.toString().padStart(2, '0')}/${date.year}`;
    }

    if (paginated.items.length === 0) {
      return (
        text +
        '\n\nNenhuma transação encontrada para os critérios especificados\\.'
      );
    }
    text += ` \\| Página ${page} de ${totalPages}\n\n`;

    for (const transaction of paginated.items) {
      const value = Math.abs(transaction.amount).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      });
      const dateStr = transaction.createdAt.toLocaleDateString('pt-BR');
      text += `• ${transaction.type === 'income' ? '🟢' : '🔴'} \`#${this.escapeMarkdownV2(transaction.code)}\` \\| ${this.escapeMarkdownV2(value)} \\|${transaction.category ? ` ${this.escapeMarkdownV2(transaction.category.name)} \\|` : ''} ${this.escapeMarkdownV2(dateStr)}${transaction.description ? `\n${this.escapeMarkdownV2(transaction.description)}` : ''}\n\n`;
    }

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
      '*Como usar:*\n\n' +
      'A forma mais rápida de registrar receitas e despesas é usando o comando `/ai`.\n\n' +
      '*Exemplo:*\n' +
      '`/ai 100 salário de setembro`\n' +
      '`/ai 50 supermercado`\n\n' +
      'O bot entende o valor, tipo (receita ou despesa) e descrição automaticamente!\n\n' +
      '---\n\n' +
      '*Comandos avançados/opcionais:*\n' +
      '• /create — Cria um novo cofre.\n' +
      '• /join <token> — Entra em um cofre existente usando o token.\n' +
      '• /income <quantia> [descrição] — Registra uma receita manualmente.\n' +
      '• /expense <quantia> [descrição] — Registra uma despesa manualmente.\n' +
      '• /edit <código> [opções] — Edita uma transação existente.\n' +
      '    Opções: -v <valor>, -d <dd/mm/yyyy>, -c <categoria>, -desc "descrição"\n' +
      '• /setbudget <categoria1> <quantia1>, <categoria2> <quantia2> ... — Define orçamentos para categorias.\n' +
      '• /summary [-d mm/yyyy] — Mostra o resumo do cofre.\n' +
      '• /categories — Lista as categorias disponíveis.\n' +
      '• /transactions [-p página] [-d mm/yyyy|dd/mm/yyyy] — Lista transações do cofre.\n' +
      '• /editprompt <novo prompt> — Edita o prompt do cofre.\n' +
      '• /delete <código> — Deleta uma transação pelo código.\n' +
      '• /help — Mostra esta mensagem de ajuda.\n\n' +
      'Para detalhes de uso de cada comando, digite o comando sem argumentos.'
    );
  }

  formatBudgetSummary(
    vault: SerializedVault,
    budgetsSummary: BudgetSummary[],
  ): string {
    let text: string = '';
    if (budgetsSummary.length > 0) {
      text += `• Orçamento: R$ ${this.escapeMarkdownV2(
        vault.totalBudgetedAmount.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        }),
      )}\n`;
      text += `\n  Total gasto: R$ ${this.escapeMarkdownV2(
        vault.totalSpentAmount.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        }),
      )}\n`;
      text += `  ${this.formatPercentageBar(vault.percentageTotalBudgetedAmount)}\n\n`;

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

        text += `• \`#${this.escapeMarkdownV2(budget.category.code)}\` ${this.escapeMarkdownV2(budget.category.name)} ${this.escapeMarkdownV2(amount)}\n`;
        text += `  Gastos: ${this.escapeMarkdownV2(spent)} \\\n ${this.formatPercentageBar(percentage)}\n\n`;
      }
    } else {
      text += `Nenhum orçamento definido\\.\n`;
    }

    return text;
  }

  formatPercentageBar(percentage: number, barLength: number = 10): string {
    const cappedPercentage = Math.min(percentage, 100);
    const filledLength = Math.round((cappedPercentage / 100) * barLength);
    const isOverflow = percentage > 100;

    const filledBar = isOverflow
      ? '🟥'.repeat(filledLength)
      : '🟩'.repeat(filledLength);
    const emptyBar = '⬜'.repeat(Math.max(0, barLength - filledLength));

    const bar = filledBar + emptyBar;
    return `${bar} ${this.escapeMarkdownV2(percentage.toFixed(0))}%`;
  }
}

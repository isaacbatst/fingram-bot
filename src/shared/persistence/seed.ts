export const CATEGORIES_SEED: {
  id: string;
  name: string;
  code: string;
  description: string;
  transaction_type: 'income' | 'expense' | 'both';
}[] = [
  {
    id: 'f00110c1-fd2f-42d2-b579-8cc337668d82',
    name: '🏡 Moradia',
    code: '1',
    description:
      'Aluguel, condomínio, contas de casa como luz, água, internet, gás, manutenção, IPTU, reformas, seguro residencial, taxas condominiais, prestação da casa, encanador, eletricista. Palavras-chave: aluguel, condomínio, energia, água, internet, IPTU, manutenção, conserto, residência.',
    transaction_type: 'expense',
  },
  {
    id: 'a29eb76c-0def-43ef-9c21-95928616e6f5',
    name: '🛒 Compras',
    code: '2',
    description:
      'Supermercado, compras de alimentos, feira, padaria, higiene pessoal (exceto remédios), itens de limpeza, pequenas compras do dia a dia, utensílios domésticos, farmácia para produtos não-medicamentosos (ex: shampoo, escova, protetor solar). Palavras-chave: mercado, supermercado, feira, padaria, carne, pão, leite, papel higiênico, sabonete, shampoo, limpeza.',
    transaction_type: 'expense',
  },
  {
    id: 'f2662cda-938f-4af6-8fcc-b9d6b7bfc061',
    name: '🚗 Transporte',
    code: '3',
    description:
      'Combustível (gasolina, etanol, diesel), manutenção de veículos, peças, impostos e taxas como IPVA e licenciamento, Uber, 99, ônibus, metrô, estacionamento, pedágio, seguro do veículo, revisão, CNH, transporte por aplicativo, oficina mecânica, multas de trânsito. Palavras-chave: gasolina, uber, ônibus, metrô, pedágio, IPVA, oficina, manutenção, seguro carro, CNH.',
    transaction_type: 'expense',
  },
  {
    id: '9854990d-b348-4572-a077-dd4710cc9973',
    name: '🎓 Educação',
    code: '4',
    description:
      'Mensalidade escolar, faculdade, pós-graduação, cursos online, cursos técnicos, aulas particulares, livros, material escolar, apostilas, cursos de idiomas, inscrição em vestibular ou concursos, material didático, plataforma educacional. Palavras-chave: escola, faculdade, curso, apostila, material escolar, vestibular, livro, idioma.',
    transaction_type: 'expense',
  },
  {
    id: '2d865bfa-84a3-4b06-9ac0-23bb50439954',
    name: '🏥 Saúde',
    code: '5',
    description:
      'Remédios, farmácia para medicamentos, consultas médicas, exames laboratoriais, plano de saúde, internação, vacinas, dentista, psicólogo, terapia, tratamentos, fisioterapia, equipamentos e aparelhos de saúde, consultas online, esportes, academia, pilates, yoga, nutricionista, personal trainer, check-ups, bem-estar físico e mental. Palavras-chave: remédio, consulta, exame, dentista, psicólogo, plano de saúde, academia, fisioterapia, vacina, suplemento, pilates, terapia, laboratório, teste de covid.',
    transaction_type: 'expense',
  },
  {
    id: 'c5d35a1b-5d61-4412-9083-52bd9468fbe5',
    name: '🎉 Lazer',
    code: '6',
    description:
      'Cinema, shows, streaming (Netflix, Spotify, etc.), hobbies, bares, festas, restaurantes, viagens, turismo, esportes recreativos, games, passeios, ingressos para eventos, exposições, museus, teatro, parques, clubes, assinatura de revistas, festas temáticas. Palavras-chave: cinema, show, bar, festa, viagem, restaurante, passeio, ingresso, parque, game, streaming, clube.',
    transaction_type: 'expense',
  },
  {
    id: '206b9595-4929-4cc9-8bd9-8ec2aa73a27a',
    name: '💰 Investimentos',
    code: '7',
    description:
      'Poupança, aplicações financeiras, compra de ações, fundos de investimento, aportes, previdência privada, criptomoedas, tesouro direto, CDB, investimentos diversos, compra de cotas, aporte mensal. Palavras-chave: investimento, aporte, ação, fundo, previdência, poupança, tesouro, criptomoeda, aplicação.',
    transaction_type: 'expense',
  },
  {
    id: '3562366d-861c-46de-a1f3-2d468134ec7f',
    name: '👪 Família & Pets',
    code: '8',
    description:
      'Filhos, creche, escola, roupas infantis, brinquedos, mesada, despesas com pais ou parentes, pets (ração, veterinário, banho, remédio para pet, acessórios), cuidados com idosos, presentes para familiares, plano de saúde pet, babá. Palavras-chave: filho, creche, brinquedo, ração, pet, veterinário, remédio pet, babá, família, idoso.',
    transaction_type: 'expense',
  },
  {
    id: 'ee5bc836-ca4c-432e-afeb-fc8728f54350',
    name: '🎁 Presentes',
    code: '9',
    description:
      'Presentes para familiares, amigos ou colegas, lembrancinhas, datas comemorativas (aniversário, Natal, Páscoa, Dia das Mães/Pais, casamento, formatura), amigo secreto, presentes de agradecimento, cartões, flores, brindes para outras pessoas. Palavras-chave: presente, aniversário, Natal, Páscoa, amigo secreto, lembrança, flor, cartão, brinde, datas comemorativas.',
    transaction_type: 'expense',
  },
  {
    id: 'd9837314-2262-4ff1-a74c-a1a64deedd34',
    name: '📦 Outros',
    code: '10',
    description:
      'Despesas ou receitas diversas, pontuais, não recorrentes ou não encaixadas nas outras categorias. Exemplos de despesas: taxas extras, multas, pagamentos avulsos, serviços eventuais, burocracias, ajustes, despesas desconhecidas, consertos inesperados, imprevistos. Exemplos de receitas: reembolso, prêmio, restituição, ressarcimento, venda avulsa, recebimento eventual, devolução, transferência inesperada, acerto de contas. Palavras-chave: taxa, multa, ajuste, serviço, cartório, pontual, avulso, burocracia, extra, conserto, imprevisto, reembolso, restituição, prêmio, ressarcimento, venda, devolução, transferência, recebimento, acerto.',
    transaction_type: 'both',
  },
  {
    id: 'd17708cd-dac1-4b3f-a647-c79840d67ee5',
    name: '💼 Trabalho',
    code: '11',
    description:
      'Salário, freelance, bônus, comissão, décimo terceiro, férias recebidas, pagamento por serviços, renda extra, remuneração, prêmios, horas extras, recebimentos de trabalho, job, consultoria. Palavras-chave: salário, freelance, bônus, comissão, prêmio, hora extra, job, consultoria, remuneração, férias, renda.',
    transaction_type: 'income',
  },
];
